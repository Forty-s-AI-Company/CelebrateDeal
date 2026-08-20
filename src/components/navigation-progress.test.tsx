import { describe, expect, it } from "vitest";
import { shouldStartHistoryProgress, shouldStartNavigationProgress, type NavigationClickSnapshot } from "./navigation-progress";

const baseSnapshot: NavigationClickSnapshot = {
  button: 0,
  defaultPrevented: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  origin: "https://app.example.test",
  protocol: "https:",
  pathname: "/videos",
  currentOrigin: "https://app.example.test",
  currentPathname: "/dashboard",
  download: null,
  target: "",
};

function snapshot(overrides: Partial<NavigationClickSnapshot> = {}) {
  return { ...baseSnapshot, ...overrides };
}

describe("navigation progress click guard", () => {
  it("starts for a normal same-origin route transition", () => {
    expect(shouldStartNavigationProgress(snapshot())).toBe(true);
  });

  it.each([
    ["modifier click", { ctrlKey: true }],
    ["middle click", { button: 1 }],
    ["prevented click", { defaultPrevented: true }],
    ["external link", { origin: "https://external.example.test" }],
    ["download", { download: "video.mp4" }],
    ["new target", { target: "_blank" }],
    ["current page", { pathname: "/dashboard" }],
  ] as const)("does not start for %s", (_label, overrides) => {
    expect(shouldStartNavigationProgress(snapshot(overrides))).toBe(false);
  });

  it.each([
    ["mailto", { protocol: "mailto:" }],
    ["tel", { protocol: "tel:" }],
  ] as const)("does not start for %s links", (_label, overrides) => {
    expect(shouldStartNavigationProgress(snapshot(overrides))).toBe(false);
  });

  it.each([
    ["different path", "/dashboard", "/videos", true],
    ["same path", "/dashboard", "/dashboard", false],
    ["hash-only or unavailable path", "/dashboard", "", false],
  ] as const)("handles browser history navigation: %s", (_label, currentPathname, destinationPathname, expected) => {
    expect(shouldStartHistoryProgress(currentPathname, destinationPathname)).toBe(expected);
  });
});
