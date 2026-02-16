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
  refreshResultsBtn: document.getElementById("refreshResultsBtn"),
  resultsTable: document.getElementById("resultsTable"),
  openResultsBtn: document.getElementById("openResultsBtn"),
  resultsOverlay: document.getElementById("resultsOverlay"),
  closeResultsBtn: document.getElementById("closeResultsBtn"),
  resultsBackdrop: document.getElementById("resultsBackdrop"),
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

function renderResultsTable(view) {
  const table = els.resultsTable;
  const taskIds = Array.isArray(view.task_ids) ? view.task_ids : [];
  const rows = Array.isArray(view.rows) ? view.rows : [];

  // header
  const thead =
    `<thead><tr>` +
    `<th>doc_id</th>` +
    taskIds
      .map(
        (tid) =>
          `<th>Задание #${tid}<br/><span style="font-weight:400;">подсказки, результат</span></th>`,
      )
      .join("") +
    `</tr></thead>`;

  // body
  const tbodyRows = rows
    .map((r) => {
      const tds = taskIds.map((tid) => {
        // показываем значение только если это задание относится к пользователю
        const belongs = Array.isArray(r.tasks) && r.tasks.includes(tid);
        if (!belongs) return `<td></td>`;

        const cell = r.cells?.[tid];
        const hints = cell ? Number(cell.hints_used || 0) : 0;
        const ok = cell ? Boolean(cell.check) : false;

        const cls = ok ? "cellOk" : "cellBad";
        const resultText = ok ? "принято" : "не принято";

        return `<td class="${cls}">${hints}, ${resultText}</td>`;
      });

      return `<tr><td>${r.doc_id}</td>${tds.join("")}</tr>`;
    })
    .join("");

  table.innerHTML = thead + `<tbody>${tbodyRows}</tbody>`;
}

async function loadResultsView() {
  try {
    const resp = await fetch("/api/results");
    const data = await resp.json();
    if (!resp.ok)
      throw new Error(data?.error || "Не удалось загрузить results");
    renderResultsTable(data);
  } catch (e) {
    console.log("loadResultsView error:", e);
    // мягко: не ломаем страницу
    els.resultsTable.innerHTML =
      `<thead><tr><th>Results</th></tr></thead>` +
      `<tbody><tr><td>Ошибка загрузки результатов: ${String(e.message)}</td></tr></tbody>`;
  }
}

function openResults() {
  els.resultsOverlay.classList.remove("hidden");
  // Загружаем таблицу при открытии (чтобы не дергать API всегда)
  loadResultsView();
}

function closeResults() {
  els.resultsOverlay.classList.add("hidden");
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
els.refreshResultsBtn.addEventListener("click", loadResultsView);
els.openResultsBtn.addEventListener("click", openResults);
els.closeResultsBtn.addEventListener("click", closeResults);
els.resultsBackdrop.addEventListener("click", closeResults);

// Закрытие по Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.resultsOverlay.classList.contains("hidden")) {
    closeResults();
  }
});

// стартовое состояние
showStatus("Введите свой идентификатор и нажмите «Загрузить».");
