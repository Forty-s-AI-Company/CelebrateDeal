import { z } from "zod";

export const PresenterLayoutSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["side-by-side", "picture-in-picture"]),
  corner: z.enum(["top-left", "bottom-left", "top-right", "bottom-right"]),
  cameraPercent: z.number().int().min(15).max(35),
  orientation: z.enum(["landscape", "portrait"]).optional(),
}).strict();

export type PresenterLayout = z.infer<typeof PresenterLayoutSchema>;
export const DEFAULT_PRESENTER_LAYOUT: PresenterLayout = {
  version: 1, mode: "side-by-side", corner: "bottom-right", cameraPercent: 25,
};
export type PresenterRect = { x: number; y: number; width: number; height: number };

/** 舊活動未設定方向時維持 16:9；方向與排版共用既有版本化 JSON。 */
export function liveOrientation(value: unknown): "landscape" | "portrait" {
  return PresenterLayoutSchema.safeParse(value).data?.orientation ?? "landscape";
}

export function presenterDimensions(layout: PresenterLayout) {
  return layout.orientation === "portrait" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

/** 所有來源等比例置中，保留完整投影片而不裁切。 */
export function containPresenterRect(width: number, height: number, box: PresenterRect): PresenterRect {
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height)) return { ...box, width: 0, height: 0 };
  const scale = Math.min(box.width / width, box.height / height);
  return { x: box.x + (box.width - width * scale) / 2, y: box.y + (box.height - height * scale) / 2, width: width * scale, height: height * scale };
}

export function presenterRegions(layout: PresenterLayout, width = presenterDimensions(layout).width, height = presenterDimensions(layout).height) {
  // 直式以獨立上下區域保全簡報，人像不疊在文字上。
  if (layout.orientation === "portrait") {
    const screenHeight = height * 0.45;
    return {
      screen: { x: 0, y: 0, width, height: screenHeight },
      camera: { x: 0, y: screenHeight, width, height: height - screenHeight },
    };
  }
  const cameraWidth = width * layout.cameraPercent / 100;
  if (layout.mode === "side-by-side") return {
    screen: { x: 0, y: 0, width: width - cameraWidth, height },
    camera: { x: width - cameraWidth, y: 0, width: cameraWidth, height },
  };
  const cameraHeight = cameraWidth * 9 / 16;
  const inset = Math.min(width, height) * 0.02;
  return {
    screen: { x: 0, y: 0, width, height },
    camera: { x: layout.corner.endsWith("left") ? inset : width - cameraWidth - inset, y: layout.corner.startsWith("top") ? inset : height - cameraHeight - inset, width: cameraWidth, height: cameraHeight },
  };
}
