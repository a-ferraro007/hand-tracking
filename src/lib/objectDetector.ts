import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";

export const createObjectDetector = async () => {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
  );
  const objectDetector = await ObjectDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
    },
    runningMode: "VIDEO",
    scoreThreshold: 0.5,
    maxResults: 5,
  });

  return objectDetector;
};
