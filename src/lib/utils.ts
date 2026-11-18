import type { Region, Finger, Box, Found } from "../main";
const M = 12;
const THRESHOLD = 25;

export function toOuterRegion(r: Region) {
  return { x: r.x - M, y: r.y - M, w: r.w + 2 * M, h: r.h + 2 * M };
}

export function getMedian(arr: number[]) {
  if (!arr.length) return 0;

  const sorted = arr.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function isInside(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function isOutside(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
) {
  return p.x < r.x || p.x >= r.x + r.w || p.y < r.y || p.y >= r.y + r.h;
}

export function toIndex(
  row: number,
  col: number,
  width: number,
  pixels: number,
) {
  return (row * width + col) * 4;
}

function shadowCounting(
  regions: Region[],
  fingers: Finger[],
  ctx: CanvasRenderingContext2D,
) {
  for (const r of regions) {
    let shadowCount = 0;
    const values: number[] = [];
    const outer = toOuterRegion(r);
    let imageData = ctx.getImageData(outer.x, outer.y, outer.w, outer.h);

    for (let px = 0; px < outer.w; px++) {
      for (let py = 0; py < outer.h; py++) {
        const p = { x: outer.x + px, y: outer.y + py };
        if (!isOutside(p, r)) continue;
        const index = toIndex(py, px, outer.w, 4);
        values.push(imageData.data[index]);
      }
    }

    if (fingers.some(({ tip }) => !isOutside(tip, outer)))
      r.baseline = getMedian(values);
    const cutoff = (r.baseline ?? getMedian(values)) * 0.8;

    for (const finger of fingers) {
      const { tip, joint } = finger;
      const tx = Math.round(tip.x);
      const ty = Math.round(tip.y);
      const jx = Math.round(joint.x);
      const jy = Math.round(joint.y);

      for (let dx = -3; dx <= 3; dx++) {
        const column = tx + dx;
        let ix = column - outer.x;
        for (let dy = -3; dy <= 3; dy++) {
          if ((jx - tx) * dx + (jy - ty) * dy > 0) continue;
          const row = ty + dy;
          let iy = row - outer.y;
          if (!isOutside({ x: column, y: row }, toOuterRegion(r))) {
            const index = toIndex(iy, ix, outer.w, 4);
            if (imageData.data[index] < cutoff) shadowCount += 1;
          }
        }
      }
    }

    ctx.font = "20px Arial";
    ctx.fillStyle = "black";
    ctx.fillText(`${shadowCount}`, r.x, r.y - 10);
    const inside = fingers.some(({ tip }) => isInside(tip, r));
    if (inside) {
      ctx.strokeStyle = "green";
    } else ctx.strokeStyle = "red";
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    if (inside && !r.touching && shadowCount >= THRESHOLD) {
      console.log("touch");
    }
    r.touching = shadowCount >= THRESHOLD && inside;
  }
}

const MERGE_GAP = 50;
function gapBetween(a: Box, b: Box) {
  const gapX = Math.max(
    0,
    Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)),
  );
  const gapY = Math.max(
    0,
    Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)),
  );
  return Math.hypot(gapX, gapY);
}

function _mergeBoundingBoxes(found: Found[]): Found[] {
  let unassigned = [...found];
  const merged: Found[] = [];

  while (unassigned.length > 0) {
    const group: Found[] = [unassigned.shift()!];

    let grew = true;
    while (grew) {
      grew = false;
      const rest: Found[] = [];
      for (const candidate of unassigned) {
        if (group.some((m) => gapBetween(m.box, candidate.box) < MERGE_GAP)) {
          group.push(candidate);
          grew = true;
        } else {
          rest.push(candidate);
        }
      }
      unassigned = rest;
    }

    const left = Math.min(...group.map((g) => g.box.x));
    const top = Math.min(...group.map((g) => g.box.y));
    const right = Math.max(...group.map((g) => g.box.x + g.box.width));
    const bottom = Math.max(...group.map((g) => g.box.y + g.box.height));

    const areaByColor = new Map<string, number>();
    for (const g of group) {
      areaByColor.set(g.color, (areaByColor.get(g.color) ?? 0) + g.area);
    }
    let color = group[0].color;
    let best = 0;
    for (const [name, area] of areaByColor) {
      if (area > best) {
        best = area;
        color = name;
      }
    }

    merged.push({
      box: { x: left, y: top, width: right - left, height: bottom - top },
      color,
      area: group.reduce((sum, g) => sum + g.area, 0),
    });
  }

  return merged;
}
