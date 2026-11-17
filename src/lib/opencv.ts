let cvPromise: Promise<any> | null = null;

export function loadOpenCv(): Promise<any> {
  if (cvPromise) return cvPromise;

  cvPromise = new Promise((resolve, reject) => {
    const done = (cv: any) => {
      if (typeof cv.then === "function") delete cv.then;
      resolve(cv);
    };

    const onLoad = async () => {
      const w = window as any;
      if (w.cv instanceof Promise) w.cv = await w.cv;
      if (w.cv.Mat) done(w.cv);
      else w.cv.onRuntimeInitialized = () => done(w.cv);
    };

    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-opencv]",
    );
    if (existing) {
      if ((window as any).cv) onLoad();
      else existing.addEventListener("load", onLoad);
      return;
    }

    const script = document.createElement("script");
    script.src = "/opencv.js";
    script.async = true;
    script.dataset.opencv = "true";
    script.onload = onLoad;
    script.onerror = () => reject(new Error("Failed to load /opencv.js"));
    document.body.appendChild(script);
  });

  return cvPromise;
}
