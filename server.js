// server.js
const http = require("http");
const path = require("path");
const fs = require("fs/promises");
const { URL } = require("url");

const {
  ensureDbFiles,
  findUserByDocId,
  findTasksByIds,
  appendLog,
  findTaskById,
} = require("./db");
const {
  callOpenAIForHint,
  callOpenAIForAnswerVerdict,
} = require("./openAiHelpers");

const PUBLIC_DIR = path.join(__dirname, "public");

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function contentTypeByExt(ext) {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  // Простая защита от выхода из public/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": contentTypeByExt(ext) });
    res.end(data);
  } catch {
    sendText(res, 404, "Not Found");
  }
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // на всякий случай ограничим размер
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        if (!raw) return resolve({});
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Некорректный JSON в теле запроса"));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  // GET /api/tasks?doc_id=123
  if (req.method === "GET" && url.pathname === "/api/tasks") {
    const docIdStr = url.searchParams.get("doc_id");
    const docId = Number(docIdStr);

    if (!docIdStr || Number.isNaN(docId)) {
      return sendJson(res, 400, {
        error: "Идентификатор обязателен и должен быть числом.",
      });
    }

    const user = await findUserByDocId(docId);
    if (!user) {
      return sendJson(res, 404, {
        error: `Пользователь с идентификатором "${docId}" не найден.`,
      });
    }

    const tasks = await findTasksByIds(user.tasks || []);
    return sendJson(res, 200, {
      user: { id: user.id, doc_id: user.doc_id, tasks: user.tasks || [] },
      tasks,
    });
  }

  // POST /api/submit  { doc_id, task_id, action: "hint1"|"hint2"|"answer", code: "..." }
  if (req.method === "POST" && url.pathname === "/api/submit") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }

    const docId = Number(body.doc_id);
    const taskId = Number(body.task_id);
    const action = String(body.action || "");
    const code = String(body.code || "");

    if (Number.isNaN(docId) || Number.isNaN(taskId) || !action) {
      return sendJson(res, 400, {
        error: "Нужны поля doc_id (number), task_id (number), action (string).",
      });
    }

    const user = await findUserByDocId(docId);
    if (!user) {
      return sendJson(res, 404, {
        error: `Пользователь с идентификатором "${docId}" не найден.`,
      });
    }

    console.log("[SUBMIT]", { docId, taskId, action, codeLen: code.length });

    const task = await findTaskById(taskId);
    if (!task) {
      return sendJson(res, 404, {
        error: `Задание task_id=${taskId} не найдено.`,
      });
    }

    let message;

    try {
      if (action === "hint1") {
        message = await callOpenAIForHint({ level: 1, task, code });
      } else if (action === "hint2") {
        message = await callOpenAIForHint({ level: 2, task, code });
      } else if (action === "answer") {
        message = await callOpenAIForAnswerVerdict({ task, code });
      } else {
        console.log("[UNKNOWN ACTION]", action);
        message = "Найдены ошибки при автоматической проверке решения";
      }
    } catch (e) {
      message = "Ошибка сервера!";
      await appendLog({
        user_id: user.id,
        body: `action=${action}; task_id=${taskId}\n` + `CODE:\n` + `${code}`,
        response: message,
      });
      return sendJson(res, 500, {
        ok: false,
        message: "",
        error: "Ошибка внешнего сервиса!",
      });
    }

    await appendLog({
      user_id: user.id,
      body: `action=${action}; task_id=${taskId}\n` + `CODE:\n` + `${code}`,
      response: message,
    });

    return sendJson(res, 200, { ok: true, message });
  }

  return sendJson(res, 404, { error: "API endpoint not found" });
}

async function main() {
  await ensureDbFiles();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname.startsWith("/api/")) {
        return await handleApi(req, res, url);
      }

      return await serveStatic(req, res, url.pathname);
    } catch (e) {
      console.error("Server error:", e);
      return sendJson(res, 500, { error: "Internal server error" });
    }
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running: http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
