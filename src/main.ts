import "./style.css";
import { loadOpenCv } from "./lib/opencv";
import { createHandLandmarker } from "./lib/handLandmarker";

type Region = {
  x: number;
  y: number;
  w: number;
  h: number;
  touching: boolean;
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

// index = (y * cols + x) * channels + c   // gray scale formula   // c: 0=R, 1=G, 2=B, 3=A gray
async function main() {
  const cv = await loadOpenCv();
  const handLandmarker = await createHandLandmarker();
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const video = document.getElementById("video") as HTMLVideoElement;
  const ctx = canvas.getContext("2d");
  const pointingAt = document.getElementById("pointing");

  let touchLoc: Region;

  if (!ctx || !video) return;
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

  let currMouse;
  canvas.addEventListener("mousemove", (evt) => {});
  ctx.fillStyle = "yellow";
  const render = () => {
    ctx.drawImage(video, 0, 0);
    let imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    let src = cv.imread("canvas"); // turn imageData into a Mat
    let gray = new cv.Mat(); // empty Mat for for the result

    const fingerTips: {
      x: number;
      y: number;
    }[] = [];

    try {
      // cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); // writes into gray
      // cv.imshow(canvas, gray); // draws gray onto canvas
      const handDetection = handLandmarker.detectForVideo(
        video,
        performance.now(),
      );
      ctx.fillStyle = "yellow";

      for (const hand of handDetection.landmarks) {
        const x = hand[8].x * canvas.width;
        const y = hand[8].y * canvas.height;
        ctx.beginPath(); // start a new shape
        ctx.arc(x, y, 2, 0, Math.PI * 2); // full circle at (px, py)
        ctx.fill();
        fingerTips.push({ x, y });
      }
      for (const r of regions) {
        const inside = fingerTips.some(({ x, y }) => isInside({ x, y }, r));
        if (inside) {
          ctx.strokeStyle = "green";
        } else ctx.strokeStyle = "red";
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        if (inside && !r.touching) {
          console.log("touch");
          touchLoc = r;
        }
        r.touching = inside;
      }
    } catch (error) {
      console.error(error);
    } finally {
      src.delete();
      gray.delete();
      if (pointingAt)
        pointingAt.textContent = `Pointing at: ${JSON.stringify(touchLoc) ?? ""}`;
      requestAnimationFrame(render);
    }
  };
}
main();
