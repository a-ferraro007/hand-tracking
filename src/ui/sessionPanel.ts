import {
  GOALS,
  TARGETS,
  endSession,
  getActiveSession,
  getCurrentPrompt,
  recordEvent,
  startSession,
} from "./session";
import type { Attempt, GoalType, SessionResult, Target } from "./session";

type Phase = "choose" | "active" | "results";

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function targetLabel(target: Target) {
  const swatch = target.swatch
    ? `<span class="swatch" style="background:${target.swatch}"></span>`
    : "";
  return `${swatch}${target.tag}`;
}

export function mountSessionPanel(root: HTMLElement) {
  let phase: Phase = "choose";
  let selected: GoalType | undefined;
  let result: SessionResult | undefined;
  let timer: number | undefined;

  const render = () => {
    clearInterval(timer);
    if (phase === "choose") renderChoose();
    else if (phase === "active") renderActive();
    else renderResults();
  };

  const renderChoose = () => {
    root.innerHTML = `
      <h2>Choose a goal</h2>
      <div class="goal-options">
        ${(Object.keys(GOALS) as GoalType[])
          .map(
            (g) => `
          <button class="goal-card${selected === g ? " selected" : ""}" data-goal="${g}">
            <strong>${GOALS[g].label}</strong>
            <span>${GOALS[g].description}</span>
          </button>`,
          )
          .join("")}
      </div>
      <button id="start-session" class="primary" ${selected ? "" : "disabled"}>Start session</button>
    `;
    root.querySelectorAll<HTMLButtonElement>(".goal-card").forEach((btn) =>
      btn.addEventListener("click", () => {
        selected = btn.dataset.goal as GoalType;
        render();
      }),
    );
    document.getElementById("start-session")!.addEventListener("click", () => {
      if (!selected) return;
      startSession(selected);
      phase = "active";
      render();
    });
  };

  const renderActive = () => {
    const session = getActiveSession()!;
    root.innerHTML = `
      <h2>${GOALS[session.goal].label}</h2>
      <div class="prompt" id="session-prompt"></div>
      <div class="misses" id="session-misses"></div>
      <div class="session-stats">
        <div><span class="stat" id="session-elapsed">0:00</span><span>Elapsed</span></div>
        <div><span class="stat" id="session-correct">0</span><span>Correct</span></div>
        <div><span class="stat" id="session-missed">0</span><span>Incorrect</span></div>
      </div>
      <button id="end-session" class="primary">End session</button>
      <details class="simulate">
        <summary>Simulate CV event</summary>
        <div class="simulate-tags">
          ${TARGETS.map((t) => `<button data-tag="${t.tag}">${targetLabel(t)}</button>`).join("")}
        </div>
      </details>
    `;
    const promptEl = document.getElementById("session-prompt")!;
    const missesEl = document.getElementById("session-misses")!;
    const elapsed = document.getElementById("session-elapsed")!;
    const correct = document.getElementById("session-correct")!;
    const missed = document.getElementById("session-missed")!;

    const showPrompt = () => {
      const prompt = getCurrentPrompt()!;
      promptEl.innerHTML = `
        <span class="prompt-verb">${GOALS[session.goal].verb}</span>
        <span class="prompt-target">${targetLabel(prompt.target)}</span>
      `;
      missesEl.innerHTML = prompt.misses
        .map((m) => `<span class="miss">${m.tag}</span>`)
        .join("");
      correct.textContent = `${session.prompts.length - 1}`;
      missed.textContent = `${session.prompts.reduce((n, p) => n + p.misses.length, 0)}`;
    };

    const flash = (attempt: Attempt) => {
      const cls = attempt.correct ? "flash-correct" : "flash-incorrect";
      promptEl.classList.remove("flash-correct", "flash-incorrect");
      void promptEl.offsetWidth; // restart the animation
      promptEl.classList.add(cls);
    };

    showPrompt();
    timer = setInterval(() => {
      elapsed.textContent = formatDuration(Date.now() - session.startedAt);
    }, 250);

    root.querySelectorAll<HTMLButtonElement>(".simulate-tags button").forEach((btn) =>
      btn.addEventListener("click", () => {
        const attempt = recordEvent(btn.dataset.tag!);
        if (!attempt) return;
        showPrompt();
        flash(attempt);
      }),
    );
    document.getElementById("end-session")!.addEventListener("click", () => {
      result = endSession();
      phase = "results";
      render();
    });
  };

  const renderResults = () => {
    if (!result) return;
    const rows = result.prompts
      .map(
        (p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${targetLabel(p.target)}</td>
          <td>${p.misses.length ? p.misses.map((m) => m.tag).join(", ") : "—"}</td>
          <td>${p.completedAt ? formatDuration(p.completedAt - p.shownAt) : "Not completed"}</td>
        </tr>`,
      )
      .join("");
    root.innerHTML = `
      <h2>Results</h2>
      <p>${GOALS[result.goal].label}</p>
      <div class="session-stats">
        <div><span class="stat">${formatDuration(result.durationMs)}</span><span>Duration</span></div>
        <div><span class="stat">${result.completed}</span><span>Correct</span></div>
        <div><span class="stat">${result.misses}</span><span>Incorrect</span></div>
        <div><span class="stat">${Math.round(result.accuracy * 100)}%</span><span>Accuracy</span></div>
      </div>
      ${
        rows
          ? `<table class="session-table">
              <thead><tr><th>#</th><th>Prompt</th><th>Incorrect attempts</th><th>Time</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`
          : `<p class="empty">No events recorded</p>`
      }
      <button id="new-session" class="primary">New session</button>
    `;
    document.getElementById("new-session")!.addEventListener("click", () => {
      selected = undefined;
      result = undefined;
      phase = "choose";
      render();
    });
  };

  root.classList.add("session-panel");
  render();
}
