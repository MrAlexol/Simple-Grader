// public/app.js

const els = {
  docId: document.getElementById("docId"),
  loadBtn: document.getElementById("loadBtn"),
  status: document.getElementById("status"),
  workspace: document.getElementById("workspace"),
  taskNav: document.getElementById("taskNav"),
  taskTitle: document.getElementById("taskTitle"),
  taskText: document.getElementById("taskText"),
  taskExample: document.getElementById("taskExample"),
  code: document.getElementById("code"),
  hint1Btn: document.getElementById("hint1Btn"),
  hint2Btn: document.getElementById("hint2Btn"),
  answerBtn: document.getElementById("answerBtn"),
  resultBox: document.getElementById("resultBox"),
};

let state = {
  user: null,
  tasks: [],
  activeIndex: 0,
};

function setBusy(isBusy, activeAction = null) {
  const btns = [els.hint1Btn, els.hint2Btn, els.answerBtn];
  btns.forEach((b) => (b.disabled = isBusy));

  // Текст “загрузки” только на нажатой кнопке
  if (activeAction) {
    const map = {
      hint1: els.hint1Btn,
      hint2: els.hint2Btn,
      answer: els.answerBtn,
    };
    const btn = map[activeAction];
    if (btn) {
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
      btn.textContent = "Загрузка...";
    }
  }

  // Вернуть исходные тексты, когда загрузка закончилась
  if (!isBusy) {
    btns.forEach((b) => {
      if (b.dataset.originalText) {
        b.textContent = b.dataset.originalText;
        delete b.dataset.originalText;
      }
    });
  }
}

function showStatus(message, kind = "info") {
  els.status.classList.remove("hidden", "error");
  els.status.textContent = message;
  if (kind === "error") els.status.classList.add("error");
}

function hideStatus() {
  els.status.classList.add("hidden");
}

function showWorkspace() {
  els.workspace.classList.remove("hidden");
}

function hideWorkspace() {
  els.workspace.classList.add("hidden");
}

function showResult(message, kind = "ok") {
  els.resultBox.classList.remove("hidden", "ok");
  if (kind === "ok") els.resultBox.classList.add("ok");

  const safe = String(message ?? "");

  // Если marked не загрузился — fallback на plain text
  if (window.marked && typeof window.marked.parse === "function") {
    els.resultBox.innerHTML = window.marked.parse(safe);
  } else {
    els.resultBox.textContent = safe;
  }
}

function hideResult() {
  els.resultBox.classList.add("hidden");
}

function renderNav() {
  els.taskNav.innerHTML = "";

  state.tasks.forEach((t, idx) => {
    const pill = document.createElement("div");
    pill.className = "pill" + (idx === state.activeIndex ? " active" : "");
    pill.textContent = String(idx + 1);
    pill.title = `Задание #${t.id}`;
    pill.addEventListener("click", () => {
      state.activeIndex = idx;
      hideResult();
      renderNav();
      renderTask();
    });
    els.taskNav.appendChild(pill);
  });
}

function renderTask() {
  const task = state.tasks[state.activeIndex];
  if (!task) return;

  els.taskTitle.textContent = `Задание #${task.id}`;
  els.taskText.textContent = task.text || "";

  const ex = task.example || { input: [], output: [] };

  const inputLines = Array.isArray(ex.input)
    ? ex.input.map(String).join("\n")
    : "";
  const outputLines = Array.isArray(ex.output)
    ? ex.output.map(String).join("\n")
    : "";

  els.taskExample.textContent =
    `Входные данные\n` +
    `${inputLines}\n\n` +
    `Выходные данные\n` +
    `${outputLines}`;
}

async function loadTasks() {
  const docId = els.docId.value.trim();
  hideResult();

  if (!docId) {
    showStatus("Введите doc_id и нажмите «Загрузить».", "error");
    hideWorkspace();
    return;
  }

  showStatus("Загружаю задания…");
  hideWorkspace();

  try {
    const resp = await fetch(`/api/tasks?doc_id=${encodeURIComponent(docId)}`);
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data?.error || "Неизвестная ошибка");
    }

    state.user = data.user;
    state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    state.activeIndex = 0;

    if (state.tasks.length === 0) {
      showStatus("Для этого пользователя нет заданий.", "error");
      hideWorkspace();
      return;
    }

    hideStatus();
    showWorkspace();
    renderNav();
    renderTask();
  } catch (e) {
    console.log("loadTasks error:", e);
    showStatus(`Ошибка загрузки: ${e.message}. Попробуйте ещё раз.`, "error");
    hideWorkspace();
  }
}

async function submit(action) {
  hideResult();

  const docId = els.docId.value.trim();
  const task = state.tasks[state.activeIndex];
  const code = els.code.value || "";

  if (!docId || !task) {
    console.log("submit: missing docId or task");
    showResult("Сначала загрузите задания (doc_id).", "error");
    return;
  }

  if (!code.trim()) {
    showResult(
      "Код пустой. Вставьте решение в поле и попробуйте снова.",
      "error",
    );
    return;
  }

  setBusy(true, action);

  try {
    const resp = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doc_id: Number(docId),
        task_id: task.id,
        action,
        code,
      }),
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error || "Неизвестная ошибка");

    showResult(data.message || "OK", "ok");
  } catch (e) {
    console.log("submit error:", e);
    showResult(`Ошибка: ${e.message}`, "error");
  } finally {
    setBusy(false);
  }
}

els.loadBtn.addEventListener("click", loadTasks);
els.docId.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadTasks();
});

els.hint1Btn.addEventListener("click", () => submit("hint1"));
els.hint2Btn.addEventListener("click", () => submit("hint2"));
els.answerBtn.addEventListener("click", () => submit("answer"));

// стартовое состояние
showStatus("Введите свой идентификатор и нажмите «Загрузить».");
