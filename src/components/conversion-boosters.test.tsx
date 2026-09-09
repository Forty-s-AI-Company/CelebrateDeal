import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExitIntentPopup } from "./exit-intent-popup";
import { StickyAnnouncementBar, formatRemaining } from "./sticky-announcement-bar";

describe("conversion boosters", () => {
  it("does not open the exit dialog during SSR", () => {
    const html = renderToStaticMarkup(<ExitIntentPopup />);
    expect(html).toBe("");
  });

  it("renders a hydration-safe sticky countdown contract", () => {
    const html = renderToStaticMarkup(<StickyAnnouncementBar endsAt="2030-01-01T00:00:00.000Z" />);
    expect(html).toContain("限時優惠，即將結束");
    expect(html).toContain("查看價格");
    expect(html).toContain('role="status"');
    expect(formatRemaining(0)).toBe("00:00:00");
  });

  it("keeps exit-intent triggers, cookie suppression, and accessibility safeguards", async () => {
    const source = await readFile(new URL("./exit-intent-popup.tsx", import.meta.url), "utf8");
    for (const required of [
      '"use client"',
      "document.cookie",
      "Max-Age=86400",
      "document.addEventListener(\"mouseleave\"",
      "touchstart",
      "touchend",
      "delta < -100",
      "role=\"dialog\"",
      "aria-modal=\"true\"",
      "aria-labelledby",
      "event.key === \"Escape\"",
      "document.querySelector('[role=\"dialog\"]')",
    ]) expect(source).toContain(required);
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  it("keeps countdown updates bounded and cleans its timer", async () => {
    const source = await readFile(new URL("./sticky-announcement-bar.tsx", import.meta.url), "utf8");
    expect(source).toContain("window.setInterval");
    expect(source).toContain("window.clearInterval");
    expect(source).toContain("Math.max(0");
  });
});
