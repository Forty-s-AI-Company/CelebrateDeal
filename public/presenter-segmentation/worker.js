/*
 * The calling code owns the single-in-flight rule.  This worker still closes
 * every transferred resource so a failed frame cannot retain camera memory.
 */
"use strict";

const ASSET_ROOT = "/presenter-segmentation";
const MAX_FRAME_WIDTH = 640;
const MAX_FRAME_HEIGHT = 480;

let imageSegmenter = null;
let inferenceCanvas = null;
let outputCanvas = null;
let outputContext = null;
let maskCanvas = null;
let maskContext = null;
let initializing = null;

function postError(message) {
  self.postMessage({ type: "error", error: message });
}

function closeResult(result) {
  if (!result) return;

  if (typeof result.close === "function") {
    result.close();
    return;
  }

  for (const mask of result.confidenceMasks || []) mask.close();
  result.categoryMask?.close();
}

async function initialize() {
  if (imageSegmenter) return;
  if (initializing) return initializing;

  initializing = (async () => {
    importScripts(`${ASSET_ROOT}/vision_bundle.js`);

    const runtime = self.MediaPipeVision;
    if (!runtime?.FilesetResolver || !runtime?.ImageSegmenter) {
      throw new Error("MediaPipe runtime did not load");
    }

    const vision = await runtime.FilesetResolver.forVisionTasks(
      ASSET_ROOT,
    );
    // ImageSegmenter normally creates a DOM canvas. A dedicated Worker has no
    // document, so provide an OffscreenCanvas explicitly for the CPU runtime.
    inferenceCanvas = new OffscreenCanvas(1, 1);
    imageSegmenter = await runtime.ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `${ASSET_ROOT}/selfie_segmenter.tflite`,
        // CPU avoids a WebGL/WebGPU capability mismatch in a dedicated worker.
        delegate: "CPU",
      },
      canvas: inferenceCanvas,
      runningMode: "VIDEO",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  })();

  try {
    await initializing;
  } finally {
    initializing = null;
  }
}

function getCanvas(width, height) {
  if (!outputCanvas || outputCanvas.width !== width || outputCanvas.height !== height) {
    outputCanvas = new OffscreenCanvas(width, height);
    outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  }

  if (!outputContext) throw new Error("Canvas is unavailable");
  return outputContext;
}

function getMaskCanvas(width, height) {
  if (!maskCanvas || maskCanvas.width !== width || maskCanvas.height !== height) {
    maskCanvas = new OffscreenCanvas(width, height);
    maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  }

  if (!maskContext) throw new Error("Mask canvas is unavailable");
  return maskContext;
}

function renderCutout(bitmap, result) {
  const confidenceMasks = result.confidenceMasks || [];
  // The official selfie segmenter exposes [background, foreground].
  const foregroundMask = confidenceMasks[confidenceMasks.length - 1];
  if (!foregroundMask) throw new Error("Foreground mask is unavailable");

  const width = bitmap.width;
  const height = bitmap.height;
  const context = getCanvas(width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);

  const confidence = foregroundMask.getAsFloat32Array();
  const maskWidth = foregroundMask.width;
  const maskHeight = foregroundMask.height;
  const sourceMask = getMaskCanvas(maskWidth, maskHeight);
  const maskPixels = sourceMask.createImageData(maskWidth, maskHeight);

  for (let index = 0; index < confidence.length; index += 1) {
    // Retain the model's soft foreground confidence as the mask alpha.
    maskPixels.data[index * 4 + 3] = Math.round(
      Math.min(1, Math.max(0, confidence[index] || 0)) * 255,
    );
  }

  sourceMask.putImageData(maskPixels, 0, 0);
  context.save();
  context.globalCompositeOperation = "destination-in";
  // The browser rescales this low-resolution confidence mask with bilinear
  // filtering, preserving hair and shoulder edges at the output resolution.
  context.imageSmoothingEnabled = true;
  context.drawImage(maskCanvas, 0, 0, width, height);
  context.restore();
  return outputCanvas.transferToImageBitmap();
}

async function processFrame(bitmap, timestamp) {
  if (!imageSegmenter) throw new Error("Segmenter is not initialized");
  const startedAt = performance.now();
  let result;
  try {
    if (
      bitmap.width < 1 ||
      bitmap.height < 1 ||
      bitmap.width > MAX_FRAME_WIDTH ||
      bitmap.height > MAX_FRAME_HEIGHT
    ) {
      throw new Error("Frame exceeds the supported bounds");
    }

    result = imageSegmenter.segmentForVideo(bitmap, timestamp);
    const cutout = renderCutout(bitmap, result);
    self.postMessage(
      {
        type: "frame",
        bitmap: cutout,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      },
      [cutout],
    );
  } finally {
    closeResult(result);
    bitmap.close();
  }
}

self.onmessage = async ({ data }) => {
  if (!data || typeof data.type !== "string") return;

  if (data.type === "init") {
    try {
      await initialize();
      self.postMessage({ type: "ready" });
    } catch {
      postError("Unable to initialize background removal.");
    }
    return;
  }

  if (data.type === "frame") {
    const bitmap = data.bitmap;
    if (!(bitmap instanceof ImageBitmap) || !Number.isFinite(data.timestamp)) {
      bitmap?.close?.();
      postError("Background removal received an invalid frame.");
      return;
    }

    try {
      await processFrame(bitmap, data.timestamp);
    } catch {
      // Keep the public protocol free of browser/runtime paths and raw errors.
      postError("Background removal could not process this frame.");
    }
    return;
  }

  if (data.type === "dispose") {
    imageSegmenter?.close?.();
    imageSegmenter = null;
    inferenceCanvas = null;
    outputContext = null;
    outputCanvas = null;
    maskContext = null;
    maskCanvas = null;
    self.close();
  }
};
