import "./style.css";
import { loadOpenCv } from "./lib/opencv";
import { createHandLandmarker } from "./lib/handLandmarker";
import { createObjectDetector } from "./lib/objectDetector";
import { FilesetResolver } from "@mediapipe/tasks-vision";
import type { Detection, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { isInside } from "./lib/utils";
import { COLORS } from "./lib/colors";
import { mountSessionPanel } from "./ui/sessionPanel";

export type Box = { x: number; y: number; width: number; height: number };
export type Found = { box: Box; color: string; area: number; stroke: string };
export type Region = {
  x: number;
  y: number;
  w: number;
  h: number;
  touching: boolean;
  baseline?: number;
};
export type Finger = {
  tip: { x: number; y: number };
  joint: { x: number; y: number };
  knuckle: { x: number; y: number };
};

const STEP = 2;
const MIN_AREA = 1000;
const BLACK_LIST = [
  "person",
  "chair",
  "dining table",
  "bed",
  "toothbrush",
  "knife",
];
let probe: { x: number; y: number } | null = null;

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<section> 
    <div style="padding-top:100px;">
    <canvas id="canvas" width="640" height="480" ></canvas>
    <video id="video" autoplay  playsInline muted class="hidden" ></video>
      <p id="pointing">Pointing at: </p>
    </div>
</section>
<div id="session-panel"></div>
`;
mountSessionPanel(document.getElementById("session-panel")!);

async function startWebcam(video: HTMLVideoElement) {
  try {
    const initialStream = await navigator.mediaDevices.getUserMedia({
      video: true,
    });
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.label.includes("Logi Webcam"),
    );
    initialStream.getTracks().forEach((track) => track.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: {
          exact: devices[0].deviceId,
          ideal: devices[0].deviceId,
        },
      },
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

function drawHand(
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
    if (!obj.boundingBox) continue;
    const { originX, originY, width, height } = obj.boundingBox;
    ctx.fillText(
      `${obj.categories[0].categoryName} ${obj.categories[0].score.toFixed(3)}`,
      originX,
      originY - 10,
    );
    ctx.strokeRect(originX, originY, width, height);
  }
}

function buildFingers(
  landmarks: NormalizedLandmark[][],
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
) {
  const fingers: Finger[] = [];
  for (const hand of landmarks) {
    const kx = hand[5].x * canvas.width;
    const ky = hand[5].y * canvas.height;
    const jx = hand[7].x * canvas.width;
    const jy = hand[7].y * canvas.height;
    const tx = hand[8].x * canvas.width;
    const ty = hand[8].y * canvas.height;

    drawHand(hand, ctx, canvas);
    fingers.push({
      tip: { x: tx, y: ty },
      joint: { x: jx, y: jy },
      knuckle: { x: kx, y: ky },
    });
  }
  return fingers;
}

function pointingHit(
  fingers: Finger[],
  objects: { box: Box; tag: string }[],
  MAX_D: number,
) {
  for (const { tip: t, knuckle: k } of fingers) {
    const dirX = t.x - k.x;
    const dirY = t.y - k.y;
    const len = Math.hypot(dirX, dirY);
    if (len <= 0) continue;
    const nx = dirX / len;
    const ny = dirY / len;
    for (let d = 0; d <= MAX_D; d += STEP) {
      const point = { x: t.x + d * nx, y: t.y + d * ny };
      for (const obj of objects) {
        const { box } = obj;
        if (!box) continue;
        if (
          isInside(point, {
            x: box.x,
            y: box.y,
            w: box.width,
            h: box.height,
          })
        )
          return obj;
      }
    }
  }
  return undefined;
}

function colorDetection(cv: any, src: any, ctx: CanvasRenderingContext2D) {
  const vMin = 140;
  const found: Found[] = [];
  const hsv = new cv.Mat();
  const rgb = new cv.Mat();

  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

  for (const color of COLORS) {
    let mask = new cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8UC1);
    const hierarchy = new cv.Mat();
    const contours = new cv.MatVector();

    for (const range of color.range) {
      const low = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, [
        range[0],
        color.sMin,
        vMin,
        0,
      ]);
      const high = new cv.Mat(hsv.rows, hsv.cols, cv.CV_8UC3, [
        range[1],
        color.sMax ?? 255,
        255,
        0,
      ]);
      const partial = new cv.Mat();
      cv.inRange(hsv, low, high, partial);
      cv.bitwise_or(mask, partial, mask);

      if (probe) {
        const x = Math.round(probe.x);
        const y = Math.round(probe.y);
        const i = (y * hsv.cols + x) * 3;
        console.log("HSV", hsv.data[i], hsv.data[i + 1], hsv.data[i + 2]);
        probe = null;
      }
      partial.delete();
      low.delete();
      high.delete();
    }
    cv.findContours(
      mask,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < MIN_AREA) continue;
      const box = cv.boundingRect(c);
      found.push({ box, color: color.name, area, stroke: color.stroke });
    }
    hierarchy.delete();
    contours.delete();
    mask.delete();
  }
  hsv.delete();
  rgb.delete();

  for (const { box, color, stroke } of found) {
    const { x, y, width, height } = box;
    ctx.strokeStyle = stroke;
    ctx.strokeRect(x, y, width, height);
  }

  return found;
}

async function main() {
  const cv = await loadOpenCv();
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm",
  );
  const handLandmarker = await createHandLandmarker(vision);
  const objectDetector = await createObjectDetector(vision);
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const video = document.getElementById("video") as HTMLVideoElement;
  const ctx = canvas.getContext("2d");
  const pointingAt = document.getElementById("pointing");
  const MAX_D = Math.hypot(canvas.width, canvas.height);
  let tick = 0;
  let ts = 0;

  if (!ctx || !video) return;
  let touchLoc: string | undefined = undefined;
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
    probe = toCanvasXY(evt, canvas);
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
    const now = ++ts;
    ctx.drawImage(video, 0, 0);

    let src = cv.imread("canvas");
    let gray = new cv.Mat();

    try {
      const detectedColors = colorDetection(cv, src, ctx);
      if (tick % 10 === 0) {
        const tmp: Detection[] = [];
        const objectDetection = objectDetector.detectForVideo(video, now);
        for (const obj of objectDetection.detections) {
          if (Math.round(obj.categories[0].score * 10) / 10 < 0.6) continue;
          tmp.push(obj);
        }
        objects = [...tmp].filter(
          (o) => !BLACK_LIST.includes(o.categories[0].categoryName),
        );
      }
      const handDetection = handLandmarker.detectForVideo(video, now);
      drawObjectDetection(objects, ctx, canvas);
      const fingers = buildFingers(handDetection.landmarks, ctx, canvas);

      const boundingBoxes = [
        ...detectedColors.map((dc) => ({ box: dc.box, tag: dc.color })),
        ...objects
          .filter((o) => o.boundingBox)
          .map((o) => ({
            box: {
              x: o.boundingBox?.originX!,
              y: o.boundingBox?.originY!,
              width: o.boundingBox?.width!,
              height: o.boundingBox?.height!,
            },
            tag: o.categories[0].categoryName,
          })),
      ];

      const hit = pointingHit(fingers, boundingBoxes, MAX_D);
      if (hit) {
        touchLoc = hit.tag;
      }
    } catch (e) {
      console.error(typeof e === "number" ? cv.exceptionFromPtr(e) : e);
    } finally {
      src.delete();
      gray.delete();
      if (pointingAt)
        pointingAt.textContent = `Pointing at: ${JSON.stringify(touchLoc) ?? ""}`;
      touchLoc = undefined;
      tick++;
      requestAnimationFrame(render);
    }
  };
}
main();
