import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shareImageUrl } from "@/lib/public-share-metadata";

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"));
afterEach(() => vi.unstubAllEnvs());

describe("shareImageUrl", () => {
  it("resolves same-origin paths against the public app URL and keeps absolute http(s) images", () => {
    expect(shareImageUrl("/images/og.png")).toBe("https://app.example.test/images/og.png");
    expect(shareImageUrl(" /images/og.png?v=2 ")).toBe("https://app.example.test/images/og.png?v=2");
    expect(shareImageUrl("https://cdn.example.test/og.png")).toBe("https://cdn.example.test/og.png");
  });

  it.each(["/\\evil.example/og.png", "/\\\\evil.example/og.png", "/\t/evil.example/og.png", "/.//evil.example/og.png", "//evil.example/og.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "og.png", ""])("drops %s instead of resolving it to another origin", (value) => {
    expect(shareImageUrl(value)).toBeUndefined();
  });
});
