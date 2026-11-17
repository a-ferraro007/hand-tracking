import "./style.css";
import { loadOpenCv } from "./lib/opencv";
import { createHandLandmarker } from "./lib/handLandmarker";
import { createObjectDetector } from "./lib/objectDetector";
import type { Detection } from "@mediapipe/tasks-vision";

const M = 12;
const THRESHOLD = 25;

type Region = {
  x: number;
  y: number;
  w: number;
  h: number;
  touching: boolean;
  baseline?: number;
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<section> 
    <div style="padding-top:100px;">
    <canvas id="canvas" width="640" height="480" ></canvas>
    <video id="video" autoplay  playsInline muted class="hidden" ></video>
      <p id="pointing">Pointing at: </p>
    </div>
</section>
`;

function isInside(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
) {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

function isOutside(
  p: { x: number; y: number },
  r: { x: number; y: number; w: number; h: number },
) {
  return p.x < r.x || p.x >= r.x + r.w || p.y < r.y || p.y >= r.y + r.h;
}

function toIndex(row: number, col: number, width: number, pixels: number) {
  return (row * width + col) * 4;
}

async function startWebcam(video: HTMLVideoElement) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    video.srcObject = stream;
  } catch (error) {
    console.error(error);
  }
}

function toCanvasXY(evt: MouseEvent, canvas: HTMLCanvasElement) {
  return {
    x: evt.offsetX * (canvas.width / canvas.clientWidth),
    y: evt.offsetY * (canvas.height / canvas.clientHeight),
  };
}

function toOuterRegion(r: Region) {
  return { x: r.x - M, y: r.y - M, w: r.w + 2 * M, h: r.h + 2 * M };
}

function getMedian(arr: number[]) {
  if (!arr.length) return 0;

  const sorted = arr.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function drawHands(
  hand: any,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
) {
  ctx.fillStyle = "green";
  for (const h of hand) {
    const x = h.x * canvas.width;
    const y = h.y * canvas.height;
    ctx.beginPath(); // start a new shape
    ctx.arc(x, y, 2, 0, Math.PI * 2); // full circle at (px, py)
    ctx.fill();
  }
}

function drawObjectDetection(
  objects: Detection[],
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
) {
  ctx.font = "15px Arial";
  ctx.strokeStyle = "black";
  ctx.fillStyle = "black";
  for (const obj of objects) {
    console.log(obj);
    if (!obj) continue;
    const { originX, originY, width, height } = obj.boundingBox;
    ctx.fillText(
      `${obj.categories[0].categoryName} ${obj.categories[0].score}`,
      originX,
      originY - 10,
    );
    ctx.strokeRect(originX, originY, width, height);
  }
}

// index = (y * cols + x) * channels + c   // gray scale formula   // c: 0=R, 1=G, 2=B, 3=A gray
async function main() {
  const cv = await loadOpenCv();
  const handLandmarker = await createHandLandmarker();
  const objectDetector = await createObjectDetector();
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const video = document.getElementById("video") as HTMLVideoElement;
  const ctx = canvas.getContext("2d");
  const pointingAt = document.getElementById("pointing");
  let tick = 0;

  if (!ctx || !video) return;
  let touchLoc: Region;
  await startWebcam(video);

  video.addEventListener("loadedmetadata", (event) => {
    ctx.canvas.height = video.videoHeight;
    ctx.canvas.width = video.videoWidth;
    render();
  });

  let start: { x: number; y: number };
  const regions: Region[] = [];

  canvas.addEventListener("mousedown", (evt) => {
    start = toCanvasXY(evt, canvas);
  });

  canvas.addEventListener("mouseup", (evt) => {
    let end = toCanvasXY(evt, canvas);
    regions.push({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x),
      h: Math.abs(end.y - start.y),
      touching: false,
    });
  });

  canvas.addEventListener("mousemove", (evt) => {});

  let objects: Detection[] = [];
  const render = () => {
    ctx.drawImage(video, 0, 0);
    let src = cv.imread("canvas"); // turn imageData into a Mat
    let gray = new cv.Mat(); // empty Mat for for the result
    const fingers: {
      tip: { x: number; y: number };
      joint: { x: number; y: number };
    }[] = [];

    try {
      // cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); // writes into gray
      // cv.imshow(canvas, gray); // draws gray onto canvas
      if (tick % 5 === 0) {
        const tmp: Detection[] = [];
        const objectDetection = objectDetector.detectForVideo(
          video,
          performance.now(),
        );
        for (const obj of objectDetection.detections) {
          if (obj.categories[0].score < 0.5) continue;
          tmp.push(obj);
        }
        objects = [...tmp];
      }
      drawObjectDetection(objects, ctx, canvas);
      const handDetection = handLandmarker.detectForVideo(
        video,
        performance.now(),
      );

      ctx.fillStyle = "yellow";
      for (const hand of handDetection.landmarks) {
        const x = hand[8].x * canvas.width;
        const y = hand[8].y * canvas.height;
        const jx = hand[7].x * canvas.width;
        const jy = hand[7].y * canvas.height;

        drawHands(hand, ctx, canvas);
        fingers.push({ tip: { x, y }, joint: { x: jx, y: jy } });
      }

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
          touchLoc = r;
        }
        r.touching = shadowCount >= THRESHOLD && inside;
      }
    } catch (error) {
      console.error(error);
    } finally {
      src.delete();
      gray.delete();
      if (pointingAt)
        pointingAt.textContent = `Pointing at: ${JSON.stringify(touchLoc) ?? ""}`;
      tick++;
      requestAnimationFrame(render);
    }
  };
}
main();
