// db.js
const fs = require("fs/promises");
const path = require("path");

const DB_DIR = path.join(__dirname, "db");
const USERS_FILE = path.join(DB_DIR, "users.txt");
const TASKS_FILE = path.join(DB_DIR, "tasks.txt");
const LOGS_FILE = path.join(DB_DIR, "logs.txt");

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
}

async function ensureFile(filePath, defaultContent = "") {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, defaultContent, "utf-8");
  }
}

// Формат "таблицы": JSON-per-line (каждая строка — одна запись)
async function readJsonLines(filePath) {
  const text = await fs.readFile(filePath, "utf-8");
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // если вдруг битая строка — пропускаем (можно ужесточить)
    }
  }
  return rows;
}

async function appendJsonLine(filePath, obj) {
  const line = JSON.stringify(obj);
  await fs.appendFile(filePath, line + "\n", "utf-8");
}

function nextId(rows) {
  let max = 0;
  for (const r of rows) {
    if (typeof r.id === "number" && r.id > max) max = r.id;
  }
  return max + 1;
}

async function ensureDbFiles() {
  await ensureDir(DB_DIR);

  // Небольшие демо-данные (можешь удалить/поменять)
  const demoUsers =
    [
      { id: 1, doc_id: 111, tasks: [1, 2, 3] },
      { id: 2, doc_id: 222, tasks: [2] },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n";

  const demoTasks =
    [
      {
        id: 1,
        text: "Задача 1: Даны числа. Верните массив их квадратов.",
        example: { input: [1, 2, 3], output: [1, 4, 9] },
        tests: [
          { input: [0], output: [0] },
          { input: [-2, 5], output: [4, 25] },
        ],
      },
      {
        id: 2,
        text: "Задача 2: Найдите сумму массива чисел.",
        example: { input: [1, 2, 3], output: [6] },
        tests: [
          { input: [10], output: [10] },
          { input: [], output: [0] },
        ],
      },
      {
        id: 3,
        text: "Задача 3: Верните массив только чётных чисел.",
        example: { input: [1, 2, 3, 4], output: [2, 4] },
        tests: [{ input: [7, 9], output: [] }],
      },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n";

  await ensureFile(USERS_FILE, demoUsers);
  await ensureFile(TASKS_FILE, demoTasks);
  await ensureFile(LOGS_FILE, "");
}

async function findUserByDocId(docId) {
  const users = await readJsonLines(USERS_FILE);
  return users.find((u) => u.doc_id === docId) || null;
}

async function findTasksByIds(ids) {
  const tasks = await readJsonLines(TASKS_FILE);
  const set = new Set(ids.map(Number));
  // сохраняем порядок ids
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return ids
    .map((id) => byId.get(Number(id)))
    .filter(Boolean)
    .map((t) => ({
      id: t.id,
      text: t.text,
      example: t.example,
      // tests пока не отдаём на фронт (по желанию можешь отдать)
    }));
}

async function appendLog({ user_id, body, response }) {
  const logs = await readJsonLines(LOGS_FILE);
  const id = nextId(logs);

  await appendJsonLine(LOGS_FILE, {
    id,
    user_id,
    body: String(body || ""),
    response: String(response || ""),
    ts: new Date().toISOString(),
  });
}

async function findTaskById(taskId) {
  const tasks = await readJsonLines(TASKS_FILE);
  return tasks.find((t) => t.id === taskId) || null;
}

module.exports = {
  ensureDbFiles,
  findUserByDocId,
  findTasksByIds,
  appendLog,
  findTaskById,
};
