import "./style.css";
import { loadOpenCv } from "./lib/opencv";
import { createHandLandmarker } from "./lib/handLandmarker";
import { createObjectDetector } from "./lib/objectDetector";
import { FilesetResolver } from "@mediapipe/tasks-vision";
import type { Detection, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { isInside } from "./lib/utils";
import { COLORS } from "./lib/colors";
import { mountSessionPanel } from "./ui/sessionPanel";
import {
  getActiveSession,
  getCurrentPrompt,
  recordEvent,
  updateScene,
} from "./ui/session";
import { createPointGate } from "./lib/pointGate";
import { createGrabGate } from "./lib/grabGate";

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
export type NormalizedObject = { box: Box; tag: string };

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

function colorDetection(
  cv: any,
  src: any,
  ctx: CanvasRenderingContext2D,
  objects: NormalizedObject[],
) {
  const vMin = 140;
  const found: Found[] = [];
  const hsv = new cv.Mat();
  const rgb = new cv.Mat();

  // src frame comes through as RGBA -> converts HSV
  // RGBA2RGB and RGB2HSV are 3 bytes per pixel
  // i = (row * cols + col) * 3 gives the index of the row/column with the pixel data
  cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
  cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

  for (const color of COLORS) {
    // mask starts as a black mask -> nothing selected
    let mask = cv.Mat.zeros(hsv.rows, hsv.cols, cv.CV_8UC1);
    const hierarchy = new cv.Mat();
    const contours = new cv.MatVector();

    for (const range of color.range) {
      // Build two mats at the extreme ends of the color we're looking for
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

      // if the hsv value of the frame is with in the high / low range, write 255 into partial as CV_8UC1
      // CV8UC1 is 1 byte per pixel.
      const partial = new cv.Mat();
      cv.inRange(hsv, low, high, partial);
      // bitwise_or on the mask and partial. If partial is inRange it's 255.
      // Essentially creates a mask where white is the matching color and black is not matching
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

    // Writes a list of points tracing the outline of one connected white blob ( the matching color ) into
    // the contours MatVector
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
      const box = cv.boundingRect(c);
      c.delete();
      if (area < MIN_AREA) continue;
      const covered = objects.some(({ box: o }) =>
        isInside(
          { x: box.x, y: box.y },
          { x: o.x, y: o.y, w: o.width, h: o.height },
        ),
      );
      if (covered) continue;
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

  const MAX_D = Math.hypot(canvas.width, canvas.height);
  let tick = 0;
  let ts = 0;

  if (!ctx || !video) return;
  let globalHit: string | undefined = undefined;
  const pointGate = createPointGate();
  const grabGate = createGrabGate();
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
    let gray = new cv.Mat();
    ctx.drawImage(video, 0, 0);
    let src = cv.imread("canvas");

    let present: Set<string> | undefined;
    let handVisible = false;
    try {
      if (tick % 5 === 0) {
        const tmp: Detection[] = [];
        const objectDetection = objectDetector.detectForVideo(video, now);
        for (const obj of objectDetection.detections) {
          if (Math.round(obj.categories[0].score * 10) / 10 < 0.6) continue;
          tmp.push(obj);
        }
        const filtered = [...tmp].filter(
          (o) => !BLACK_LIST.includes(o.categories[0].categoryName),
        );
        objects = [...filtered];
      }
      const handDetection = handLandmarker.detectForVideo(video, now);
      handVisible = handDetection.landmarks.length > 0;
      const fingers = buildFingers(handDetection.landmarks, ctx, canvas);
      const normalizedObjects = objects
        .filter((o) => o.boundingBox)
        .map((o) => ({
          box: {
            x: o.boundingBox?.originX!,
            y: o.boundingBox?.originY!,
            width: o.boundingBox?.width!,
            height: o.boundingBox?.height!,
          },
          tag: o.categories[0].categoryName,
        }));
      drawObjectDetection(objects, ctx, canvas);
      const detectedColors = colorDetection(cv, src, ctx, normalizedObjects);
      const boundingBoxes = [
        ...detectedColors.map((dc) => ({ box: dc.box, tag: dc.color })),
        ...normalizedObjects,
      ];
      present = new Set(boundingBoxes.map((b) => b.tag));

      const hit = pointingHit(fingers, boundingBoxes, MAX_D);
      if (hit) {
        globalHit = hit.tag;
      }
    } catch (e) {
      console.error(typeof e === "number" ? cv.exceptionFromPtr(e) : e);
    } finally {
      src.delete();
      gray.delete();
      if (present) updateScene(present, performance.now());
      const pointed = pointGate(globalHit, performance.now());
      if (pointed && getActiveSession()?.goal === "point") {
        recordEvent(pointed);
      }
      const grabbed = present
        ? grabGate(present, handVisible, performance.now())
        : [];
      if (grabbed.length && getActiveSession()?.goal === "grab") {
        const target = getCurrentPrompt()?.target.tag;
        recordEvent(grabbed.find((g) => g === target) ?? grabbed[0]);
      }
      globalHit = undefined;
      tick++;
      requestAnimationFrame(render);
    }
  };
}
main();
