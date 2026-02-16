var OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

const { appendApiLog } = require("./db");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

function formatExample(example) {
  const ex = example || { input: [], output: [] };
  const inputLines = Array.isArray(ex.input)
    ? ex.input.map(String).join("\n")
    : "";
  const outputLines = Array.isArray(ex.output)
    ? ex.output.map(String).join("\n")
    : "";
  return `Входные данные\n${inputLines}\n\nВыходные данные\n${outputLines}`;
}

function extractOutputText(json) {
  // Часто приходит output_text (в SDK), но на всякий случай парсим output[]
  if (typeof json.output_text === "string" && json.output_text.trim())
    return json.output_text;

  const out = json.output;
  if (!Array.isArray(out)) return "";

  let text = "";
  for (const item of out) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string")
          text += c.text;
        if (c?.type === "text" && typeof c.text === "string") text += c.text;
      }
    }
  }
  return text.trim();
}

async function callOpenAIForHint({ level, task, code }) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL;

  const taskBlock =
    `ЗАДАНИЕ:\n${task.text}\n\n` + `ПРИМЕР:\n${formatExample(task.example)}\n`;

  // Жёсткие правила: не выдавать готовое решение
  const policy =
    `ВАЖНО:\n` +
    `- НИКОГДА не выдавай полностью готовое решение задачи.\n` +
    `- Не пиши полный код функции/программы целиком.\n` +
    `- Можно давать только подсказки, пояснения, и небольшие фрагменты (для Подсказки 2).\n` +
    `- Пиши простым человеческим языком, без заумных формулировок.\n` +
    `- НЕ НАДО предлагать решения, использующие блоки try-catch, функции или цикл for. Исходи из стиля программирования ученика.`;

  const hintStyle =
    level === 1
      ? `Подсказка 1: Аккуратно укажи, где логическая ошибка/пропуск, и в каком направлении исправлять. НЕ показывай код решения.`
      : `Подсказка 2: Явная помощь. Можно привести 1-2 небольших фрагмента кода, но НЕ полный алгоритм целиком и НЕ полный ответ. Можно написать "вставь это в цикл/в ветвление" и оставить что-то с пометкой "доделать".`;

  const userPrompt =
    `${taskBlock}\n` +
    `ТЕКСТ ПРОГРАММЫ УЧЕНИКА:\n` +
    "```txt\n" +
    `${code}\n` +
    "```\n\n" +
    `${policy}\n` +
    `${hintStyle}\n\n` +
    `Ответ дай на русском.`;

  const startedAt = Date.now();

  const requestPayload = {
    model,
    input: [
      {
        role: "developer",
        content:
          "Ты помощник для обучения программированию на Python. Твоя цель — давать подсказки без готовых решений. " +
          "Если ученик просит полный ответ, откажись и предложи следующую подсказку/намёк.",
      },
      { role: "user", content: userPrompt },
    ],
    max_output_tokens: 400,
  };

  await appendApiLog({
    type: "request",
    api: "openai.responses.create",
    hint_level: level,
    endpoint: "/v1/responses",
    object: requestPayload, // ВАЖНО: здесь нет API ключа
  });

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error?.message || "Ошибка OpenAI API";
    throw new Error(msg);
  }

  const duration_ms = Date.now() - startedAt;

  await appendApiLog({
    type: "response",
    api: "openai.responses.create",
    hint_level: level,
    endpoint: "/v1/responses",
    status: resp.status,
    ok: resp.ok,
    request_id: resp.headers.get("x-request-id") || null,
    duration_ms,
    usage: json?.usage || null,
    object: json,
  });

  const text = extractOutputText(json);
  return text || "Пустой ответ от виртуального помощника (попробуйте ещё раз).";
}

async function callOpenAIForAnswerVerdict({ task, code }) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL;

  const taskBlock =
    `ЗАДАНИЕ:\n${task.text}\n\n` + `ПРИМЕР:\n${formatExample(task.example)}\n`;

  const userPrompt =
    `${taskBlock}\n` +
    `КОД РЕШЕНИЯ УЧЕНИКА:\n` +
    "```txt\n" +
    `${code}\n` +
    "```\n\n" +
    `Требования:\n` +
    `- Проверь, соответствует ли программа заданию.\n` +
    `- Выполни мысленный прогон на разных тестах, включая крайние значения (пустые/минимальные/максимальные, отрицательные, повторяющиеся, большие числа — по смыслу задачи).\n` +
    `- Если код не компилируется/имеет синтаксические ошибки/логические ошибки/не проходит хотя бы часть тестов — считаем, что ответ НЕ принят.\n\n` +
    `ОЧЕНЬ ВАЖНО:\n` +
    `- Ответь СТРОГО ОДНОЙ фразой (без точек, пояснений, подсказок и добавочного текста):\n` +
    `  1) Отлично, ответ принят\n` +
    `  2) Найдены ошибки при автоматической проверке решения\n`;

  const startedAt = Date.now();

  const requestPayload = {
    model,
    input: [
      {
        role: "developer",
        content:
          "Ты автоматический валидатор решений по программированию. " +
          "Никаких подсказок. Никаких объяснений. " +
          "Возвращай строго одну из двух допустимых фраз и ничего больше.",
      },
      { role: "user", content: userPrompt },
    ],
    max_output_tokens: 20,
  };

  await appendApiLog({
    type: "request",
    api: "openai.responses.create",
    action: "answer",
    endpoint: "/v1/responses",
    object: requestPayload,
  });

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error?.message || "Ошибка OpenAI API";
    throw new Error(msg);
  }

  const duration_ms = Date.now() - startedAt;

  await appendApiLog({
    type: "response",
    api: "openai.responses.create",
    action: "answer",
    endpoint: "/v1/responses",
    status: resp.status,
    ok: resp.ok,
    request_id: resp.headers.get("x-request-id") || null,
    duration_ms,
    usage: json?.usage || null,
    object: json,
  });

  const text = extractOutputText(json).trim();

  // Жёсткая нормализация: клиент должен получить ТОЛЬКО одну из двух фраз.
  const OK = "Отлично, ответ принят";
  const BAD = "Найдены ошибки при автоматической проверке решения";

  if (text === OK) return OK;
  if (text === BAD) return BAD;

  // Если модель нарушила формат — считаем, что проверка не пройдена
  return BAD;
}

module.exports = {
  callOpenAIForHint,
  callOpenAIForAnswerVerdict,
};
