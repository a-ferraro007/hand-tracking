const DWELL_MS = 800;
const GRACE_MS = 150;

// Turns per-frame pointing hits into discrete point events: a tag must be
// held for DWELL_MS to fire, fires once per hold, and brief dropouts under
// GRACE_MS don't break the hold.
export function createPointGate(dwellMs = DWELL_MS, graceMs = GRACE_MS) {
  let tag: string | undefined;
  let since = 0;
  let lastSeen = 0;
  let fired = false;

  return (hit: string | undefined, now: number): string | undefined => {
    if (hit === undefined) {
      if (tag && now - lastSeen > graceMs) tag = undefined;
      return undefined;
    }
    if (hit !== tag) {
      tag = hit;
      since = now;
      fired = false;
    }
    lastSeen = now;
    if (fired || now - since < dwellMs) return undefined;
    fired = true;
    return tag;
  };
}
