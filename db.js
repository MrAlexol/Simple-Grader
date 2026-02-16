// db.js
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const DB_DIR = path.join(__dirname, "db");
const USERS_FILE = path.join(DB_DIR, "users.txt");
const TASKS_FILE = path.join(DB_DIR, "tasks.txt");
const LOGS_FILE = path.join(DB_DIR, "logs.txt");
const APILOGS_FILE = path.join(DB_DIR, "apilogs.txt");
const RESULTS_FILE = path.join(DB_DIR, "results.txt");

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

async function writeJsonLines(filePath, rows) {
  const text =
    rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  await fs.writeFile(filePath, text, "utf-8");
}

function makeIntId() {
  // int (JS number) + минимальный риск коллизий без чтения файла
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
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
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n";

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
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n";

  await ensureFile(USERS_FILE, demoUsers);
  await ensureFile(TASKS_FILE, demoTasks);
  await ensureFile(LOGS_FILE, "");
  await ensureFile(APILOGS_FILE, "");
  await ensureFile(RESULTS_FILE, "");
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
    }));
}

async function appendLog({ user_id, body, response }) {
  await appendJsonLine(LOGS_FILE, {
    id: randomUUID(),
    ts: new Date().toISOString(),
    user_id,
    body: String(body || ""),
    response: String(response || ""),
  });
}

async function findTaskById(taskId) {
  const tasks = await readJsonLines(TASKS_FILE);
  return tasks.find((t) => t.id === taskId) || null;
}

async function appendApiLog(entry) {
  // entry: { type: "request"|"response"|"error", object: any, ...meta }
  await appendJsonLine(APILOGS_FILE, {
    id: Date.now(), // достаточно для простого логирования
    ts: new Date().toISOString(),
    ...entry,
  });
}

async function getOrCreateResult(user_id, task_id) {
  const rows = await readJsonLines(RESULTS_FILE);
  let row = rows.find((r) => r.user_id === user_id && r.task_id === task_id);

  if (!row) {
    row = {
      id: makeIntId(),
      user_id,
      task_id,
      hints_used: 0,
      check: false,
      ts_created: new Date().toISOString(),
      ts_updated: new Date().toISOString(),
    };
    rows.push(row);
    await writeJsonLines(RESULTS_FILE, rows);
  }

  return row;
}

async function incrementHintsUsed(user_id, task_id, delta = 1) {
  const rows = await readJsonLines(RESULTS_FILE);
  const idx = rows.findIndex(
    (r) => r.user_id === user_id && r.task_id === task_id,
  );
  if (idx === -1) return null;

  rows[idx].hints_used = Number(rows[idx].hints_used || 0) + delta;
  rows[idx].ts_updated = new Date().toISOString();

  await writeJsonLines(RESULTS_FILE, rows);
  return rows[idx];
}

async function setResultCheck(user_id, task_id, checkValue) {
  const rows = await readJsonLines(RESULTS_FILE);
  const idx = rows.findIndex(
    (r) => r.user_id === user_id && r.task_id === task_id,
  );
  if (idx === -1) return null;

  rows[idx].check = Boolean(checkValue);
  rows[idx].ts_updated = new Date().toISOString();

  await writeJsonLines(RESULTS_FILE, rows);
  return rows[idx];
}

async function readAllUsers() {
  return await readJsonLines(USERS_FILE);
}

async function readAllResults() {
  return await readJsonLines(RESULTS_FILE);
}

async function readAllTasks() {
  return await readJsonLines(TASKS_FILE);
}

module.exports = {
  ensureDbFiles,
  findUserByDocId,
  findTasksByIds,
  appendLog,
  findTaskById,
  appendApiLog,
  getOrCreateResult,
  incrementHintsUsed,
  setResultCheck,
  readAllUsers,
  readAllResults,
  readAllTasks,
};
