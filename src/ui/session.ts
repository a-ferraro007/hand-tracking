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

export const GOALS: Record<GoalType, { label: string; verb: string; description: string }> = {
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

// Object tags are COCO labels the object detector can report.
const OBJECTS = ["cup", "bottle", "cell phone", "book", "remote", "scissors"];

export const TARGETS: Target[] = [
  ...COLORS.map((c) => ({ tag: c.name, kind: "color" as const, swatch: c.stroke })),
  ...OBJECTS.map((tag) => ({ tag, kind: "object" as const })),
];

let active: Session | undefined;

export function getActiveSession() {
  return active;
}

export function getCurrentPrompt() {
  return active?.prompts.at(-1);
}

function nextPrompt(previous?: Target): Prompt {
  const pool = TARGETS.filter((t) => t.tag !== previous?.tag);
  const target = pool[Math.floor(Math.random() * pool.length)];
  return { target, shownAt: Date.now(), misses: [] };
}

export function startSession(goal: GoalType) {
  active = { goal, startedAt: Date.now(), prompts: [nextPrompt()] };
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
    return { correct: false, prompt };
  }
  prompt.completedAt = at;
  active.prompts.push(nextPrompt(prompt.target));
  return { correct: true, prompt };
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
