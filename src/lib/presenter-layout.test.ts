import { describe, expect, it } from "vitest";
import { containPresenterRect, DEFAULT_PRESENTER_LAYOUT, PresenterLayoutSchema, presenterRegions, presenterDimensions, liveOrientation } from "./presenter-layout";

describe("presenter layout", () => {
  it("defaults legacy metadata to landscape and rejects unknown orientations", () => {
    expect(liveOrientation(null)).toBe("landscape");
    expect(liveOrientation(DEFAULT_PRESENTER_LAYOUT)).toBe("landscape");
    expect(PresenterLayoutSchema.safeParse({ ...DEFAULT_PRESENTER_LAYOUT, orientation: "square" }).success).toBe(false);
  });
  it("reflows portrait sources into non-overlapping regions without cropping slides", () => {
    const layout = { ...DEFAULT_PRESENTER_LAYOUT, orientation: "portrait" as const };
    expect(presenterDimensions(layout)).toEqual({ width: 1080, height: 1920 });
    for (const mode of ["side-by-side", "picture-in-picture"] as const) {
      const { screen, camera } = presenterRegions({ ...layout, mode });
      expect(screen.y + screen.height).toBe(camera.y);
      expect(camera.y + camera.height).toBe(1920);
      for (const [width, height] of [[1920,1080], [1024,768], [1080,1920]]) {
        const rect = containPresenterRect(width!, height!, screen);
        expect(rect.width / rect.height).toBeCloseTo(width! / height!);
        expect(rect.y + rect.height).toBeLessThanOrEqual(camera.y);
      }
    }
  });
  it("rejects unknown fields, fractional sizes and out-of-range sizes", () => {
    for (const patch of [{ unexpected: true }, { cameraPercent: 14 }, { cameraPercent: 36 }, { cameraPercent: 15.5 }, { version: 2 }]) {
      expect(PresenterLayoutSchema.safeParse({ ...DEFAULT_PRESENTER_LAYOUT, ...patch }).success).toBe(false);
    }
  });
  it("keeps slide left and camera right without overlapping", () => {
    const { screen, camera } = presenterRegions(DEFAULT_PRESENTER_LAYOUT);
    expect(screen.x).toBe(0);
    expect(screen.width).toBe(camera.x);
    expect(camera.x + camera.width).toBe(1920);
  });
  it("keeps all PiP corners and sizes inside the canvas", () => {
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
      for (const cameraPercent of [15, 25, 35]) {
        const { camera, screen } = presenterRegions({ ...DEFAULT_PRESENTER_LAYOUT, mode: "picture-in-picture", corner, cameraPercent });
        expect(screen).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
        expect(camera.x).toBeGreaterThan(0);
        expect(camera.y).toBeGreaterThan(0);
        expect(camera.x + camera.width).toBeLessThan(1920);
        expect(camera.y + camera.height).toBeLessThan(1080);
        expect(camera.x < 960).toBe(corner.endsWith("left"));
        expect(camera.y < 540).toBe(corner.startsWith("top"));
      }
    }
  });
  it("contains portrait and landscape content without distortion or cropping", () => {
    const box = { x: 100, y: 50, width: 600, height: 400 };
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      const result = containPresenterRect(width!, height!, box);
      expect(result.width / result.height).toBeCloseTo(width! / height!);
      expect(result.x).toBeGreaterThanOrEqual(box.x);
      expect(result.y).toBeGreaterThanOrEqual(box.y);
      expect(result.x + result.width).toBeLessThanOrEqual(box.x + box.width);
      expect(result.y + result.height).toBeLessThanOrEqual(box.y + box.height);
    }
    expect(containPresenterRect(0, 0, box).width).toBe(0);
  });
});
