import { describe, expect, it } from "vitest";
import { productEventBeyondVideoSec } from "./live-video-timing";

const spotlight = (triggerSec: number) => ({ eventType: "product_spotlight", triggerSec });

describe("productEventBeyondVideoSec", () => {
  it("warns when the first product spotlight is at or past the video end", () => {
    expect(productEventBeyondVideoSec(5, [spotlight(45), spotlight(180)])).toBe(45);
    expect(productEventBeyondVideoSec(5, [spotlight(5)])).toBe(5);
  });

  it("does not warn when the first product appears inside the video", () => {
    expect(productEventBeyondVideoSec(5, [spotlight(2), spotlight(45)])).toBeNull();
  });

  it("ignores non-product events and unknown durations", () => {
    expect(productEventBeyondVideoSec(5, [{ eventType: "chat_message", triggerSec: 80 }])).toBeNull();
    expect(productEventBeyondVideoSec(0, [spotlight(45)])).toBeNull();
    expect(productEventBeyondVideoSec(null, [spotlight(45)])).toBeNull();
  });
});
