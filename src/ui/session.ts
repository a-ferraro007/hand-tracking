import { COLORS } from "../lib/colors";

export type GoalType = "point" | "grab";
export type TargetKind = "color" | "object";
export type Target = { tag: string; kind: TargetKind; swatch?: string };
export type SessionEvent = { at: number; tag: string };
export type Prompt = {
  target: Target;
  shownAt: number;
  completedAt?: number;
  misses: SessionEvent[];
};
export type Session = {
  goal: GoalType;
  startedAt: number;
  endedAt?: number;
  prompts: Prompt[];
};
export type Attempt = { correct: boolean; prompt: Prompt };
export type SessionResult = {
  goal: GoalType;
  durationMs: number;
  completed: number;
  misses: number;
  accuracy: number;
  prompts: Prompt[];
};

export const GOALS: Record<
  GoalType,
  { label: string; verb: string; description: string }
> = {
  point: {
    label: "Point at objects",
    verb: "Point at",
    description: "Count each time a finger points at a detected object.",
  },
  grab: {
    label: "Grab objects",
    verb: "Grab",
    description: "Count each time an object is moved out of view.",
  },
};

// A tag joins the scene once seen for SCENE_STABLE_MS and leaves after
// SCENE_ABSENT_MS unseen, so prompts only use things reliably in view.
const SCENE_STABLE_MS = 500;
const SCENE_ABSENT_MS = 800;

let active: Session | undefined;
let scene: Target[] = [];
const sceneTracks = new Map<string, { firstSeen: number; lastSeen: number }>();
const listeners = new Set<(attempt?: Attempt) => void>();

// Fires on attempts, prompt changes, and scene changes.
export function onSessionChange(fn: (attempt?: Attempt) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify<T extends Attempt | undefined>(attempt?: T) {
  listeners.forEach((fn) => fn(attempt));
  return attempt;
}

export function toTarget(tag: string): Target {
  const color = COLORS.find((c) => c.name === tag);
  return color
    ? { tag, kind: "color", swatch: color.stroke }
    : { tag, kind: "object" };
}

export function getScene() {
  return scene;
}

// Hook for the CV loop: call every frame with all tags currently detected.
export function updateScene(present: Set<string>, now: number) {
  for (const tag of present) {
    if (tag === "mint") continue;
    const t = sceneTracks.get(tag);
    if (t) t.lastSeen = now;
    else sceneTracks.set(tag, { firstSeen: now, lastSeen: now });
  }
  for (const [tag, t] of sceneTracks) {
    if (now - t.lastSeen >= SCENE_ABSENT_MS) sceneTracks.delete(tag);
  }
  const stable = [...sceneTracks]
    .filter(([, t]) => t.lastSeen - t.firstSeen >= SCENE_STABLE_MS)
    .map(([tag]) => tag)
    .sort();
  if (stable.join() === scene.map((t) => t.tag).join()) return;
  scene = stable.map(toTarget);
  if (active && !getCurrentPrompt()) openPrompt();
  notify();
}

export function getActiveSession() {
  return active;
}

// The open prompt, or undefined while waiting for something in view.
export function getCurrentPrompt() {
  const last = active?.prompts.at(-1);
  return last && !last.completedAt ? last : undefined;
}

// Picks a new target from the scene, avoiding an immediate repeat. A grabbed
// target is gone, so grab sessions never fall back to repeating it.
function openPrompt(previous?: Target) {
  if (!active) return;
  let pool = scene.filter((t) => t.tag !== previous?.tag);
  if (!pool.length && active.goal === "point") pool = scene;
  if (!pool.length) return;
  const target = pool[Math.floor(Math.random() * pool.length)];
  active.prompts.push({ target, shownAt: Date.now(), misses: [] });
}

export function startSession(goal: GoalType) {
  active = { goal, startedAt: Date.now(), prompts: [] };
  openPrompt();
  return active;
}

// Hook for the CV loop: call with the detected tag when a goal event occurs.
// The prompt stays until the matching tag is reported; mismatches are misses.
export function recordEvent(tag: string): Attempt | undefined {
  const prompt = getCurrentPrompt();
  if (!active || !prompt) return undefined;

  const at = Date.now();
  if (tag !== prompt.target.tag) {
    prompt.misses.push({ at, tag });
    return notify({ correct: false, prompt });
  }
  prompt.completedAt = at;
  openPrompt(prompt.target);
  return notify({ correct: true, prompt });
}

export function endSession(): SessionResult | undefined {
  if (!active) return undefined;
  active.endedAt = Date.now();
  const completed = active.prompts.filter((p) => p.completedAt).length;
  const misses = active.prompts.reduce((n, p) => n + p.misses.length, 0);
  const attempts = completed + misses;
  const result = {
    goal: active.goal,
    durationMs: active.endedAt - active.startedAt,
    completed,
    misses,
    accuracy: attempts ? completed / attempts : 0,
    // Drop the trailing prompt if nothing was attempted against it.
    prompts: active.prompts.filter((p) => p.completedAt || p.misses.length),
  };
  active = undefined;
  return result;
}
