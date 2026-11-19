const PRESENT_MS = 500;
const ABSENT_MS = 800;
const HAND_WINDOW_MS = 1000;

type Track = { firstSeen: number; lastSeen: number };

// Turns per-frame detections into grab events: a tag fires once when it was
// visible for PRESENT_MS, then stays gone for ABSENT_MS (so hand occlusion and
// detector flicker don't count), and a hand was seen within HAND_WINDOW_MS of
// it disappearing. It must be visible again for PRESENT_MS before it can refire.
export function createGrabGate(
  presentMs = PRESENT_MS,
  absentMs = ABSENT_MS,
  handWindowMs = HAND_WINDOW_MS,
) {
  const tracks = new Map<string, Track>();
  let lastHand = -Infinity;

  return (
    present: Set<string>,
    handVisible: boolean,
    now: number,
  ): string[] => {
    if (handVisible) lastHand = now;
    for (const tag of present) {
      const t = tracks.get(tag);
      if (t) t.lastSeen = now;
      else tracks.set(tag, { firstSeen: now, lastSeen: now });
    }

    const grabbed: string[] = [];
    for (const [tag, t] of tracks) {
      if (present.has(tag) || now - t.lastSeen < absentMs) continue;
      tracks.delete(tag);
      const wasStable = t.lastSeen - t.firstSeen >= presentMs;
      const handNear = lastHand >= t.lastSeen - handWindowMs;
      if (wasStable && handNear) grabbed.push(tag);
    }
    return grabbed;
  };
}
