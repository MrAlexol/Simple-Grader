function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

function formatExample(example) {
  const ex = example || { input: [], output: [] };
  const inputLines = Array.isArray(ex.input) ? ex.input.map(String).join("\n") : "";
  const outputLines = Array.isArray(ex.output) ? ex.output.map(String).join("\n") : "";
  return `Входные данные\n${inputLines}\n\nВыходные данные\n${outputLines}`;
}

function extractOutputText(json) {
  // Часто приходит output_text (в SDK), но на всякий случай парсим output[]
  if (typeof json.output_text === "string" && json.output_text.trim()) return json.output_text;

  const out = json.output;
  if (!Array.isArray(out)) return "";

  let text = "";
  for (const item of out) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text" && typeof c.text === "string") text += c.text;
        if (c?.type === "text" && typeof c.text === "string") text += c.text;
      }
    }
  }
  return text.trim();
}

async function callOpenAIForHint({ level, task, code }) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL || "gpt-5-nano";

  const taskBlock =
    `ЗАДАНИЕ:\n${task.text}\n\n` +
    `ПРИМЕР:\n${formatExample(task.example)}\n`;

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

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
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
      // чтобы подсказки были стабильными и не “разъезжались”
      temperature: 0.4,
      max_output_tokens: 400,
    }),
  });

  const json = await resp.json();
  if (!resp.ok) {
    const msg = json?.error?.message || "Ошибка OpenAI API";
    throw new Error(msg);
  }

  const text = extractOutputText(json);
  return text || "Пустой ответ от виртуального помощника (попробуйте ещё раз).";
}

module.exports = {
  callOpenAIForHint,
};
