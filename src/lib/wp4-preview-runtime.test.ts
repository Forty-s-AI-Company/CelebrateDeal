import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "./wp4-preview-runtime";

afterEach(() => vi.unstubAllEnvs());

describe("WP4 Preview source identity", () => {
  it("uses the Vercel system SHA when available", () => {
    const sha = "a".repeat(40);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sha);
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", undefined);
    expect(resolveWp4ExpectedSourceSha()).toBe(sha);
  });

  it("uses an explicitly bound public SHA when the system SHA is unavailable", () => {
    const sha = "b".repeat(40);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", sha);
    expect(resolveWp4ExpectedSourceSha()).toBe(sha);
  });

  it("fails closed for invalid or conflicting server-owned identities", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "b".repeat(40));
    expect(resolveWp4ExpectedSourceSha()).toBeNull();
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "main");
    expect(resolveWp4ExpectedSourceSha()).toBeNull();
  });

  it("compares the caller claim to the server-owned SHA", () => {
    const sha = "c".repeat(40);
    const request = new Request("https://preview.example.test", {
      headers: { "x-celebratedeal-source-sha": sha },
    });
    expect(wp4SourceMatchesRequest(request, sha)).toBe(true);
    expect(wp4SourceMatchesRequest(request, "d".repeat(40))).toBe(false);
  });
});
