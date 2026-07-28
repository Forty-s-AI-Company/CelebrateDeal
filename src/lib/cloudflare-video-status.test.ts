import { describe, expect, it } from "vitest";
import { resolveCloudflareVideoStatusTransition } from "@/lib/cloudflare-video-status";

describe("resolveCloudflareVideoStatusTransition", () => {
  it.each([
    ["processing", "processing", "processing"],
    ["processing", "ready", "ready"],
    ["processing", "error", "error"],
    ["error", "ready", "ready"],
    ["ready", "ready", "ready"],
  ] as const)("allows %s -> %s", (current, incoming, expected) => {
    expect(resolveCloudflareVideoStatusTransition(current, incoming)).toBe(expected);
  });

  it.each([
    ["ready", "processing"],
    ["ready", "error"],
    ["error", "processing"],
  ] as const)("rejects stale %s -> %s", (current, incoming) => {
    expect(resolveCloudflareVideoStatusTransition(current, incoming)).toBeNull();
  });
});
