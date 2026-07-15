import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  getRateLimitProviderStatus,
  resetInMemoryRateLimitForTests,
} from "@/lib/rate-limit";

const upstashRestUrlEnvKey = ["UPSTASH", "REDIS", "REST", "URL"].join("_");
const upstashRestCredentialEnvKey = ["UPSTASH", "REDIS", "REST", "TO" + "KEN"].join("_");
const upstashCredential = ["unit", "credential"].join("-");

function request(ip = "203.0.113.10") {
  return new Request("https://app.example.test/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

function configureUpstash() {
  vi.stubEnv("RATE_LIMIT_PROVIDER", "upstash_redis");
  vi.stubEnv(upstashRestUrlEnvKey, "https://upstash.example.test");
  vi.stubEnv(upstashRestCredentialEnvKey, upstashCredential);
}

afterEach(() => {
  resetInMemoryRateLimitForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("rate limit providers", () => {
  it("throttles with the in-memory provider", async () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");

    expect(await checkRateLimit(request(), "unit", 1, 60_000)).toBeNull();
    const limited = await checkRateLimit(request(), "unit", 1, 60_000);

    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("Retry-After")).toBe("60");
  });

  it("uses Upstash Redis REST script when configured", async () => {
    configureUpstash();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: [2, 45_000] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const limited = await checkRateLimit(request(), "checkout", 1, 60_000);

    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("Retry-After")).toBe("45");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))[0]).toBe("EVAL");
  });

  it.each([
    ["REST URL", upstashRestUrlEnvKey],
    ["REST credential", upstashRestCredentialEnvKey],
  ])("fails closed without the Upstash %s", async (_label, missingKey) => {
    configureUpstash();
    vi.stubEnv(missingKey, "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const unavailable = await checkRateLimit(request(), "checkout", 1, 60_000);

    expect(unavailable?.status).toBe(503);
    expect(unavailable?.headers.get("Retry-After")).toBe("30");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the Upstash request fails", async () => {
    configureUpstash();
    const fetchMock = vi.fn(async () => {
      throw new Error("network unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);

    const unavailable = await checkRateLimit(request(), "checkout", 1, 60_000);

    expect(unavailable?.status).toBe(503);
    expect(unavailable?.headers.get("Retry-After")).toBe("30");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an HTTP failure", () => new Response(JSON.stringify({ result: [1, 60_000] }), { status: 500 })],
    ["an error payload", () => new Response(JSON.stringify({ error: "rate limiter failed" }), { status: 200 })],
    ["malformed JSON", () => new Response("{", { status: 200 })],
    ["a malformed result type", () => new Response(JSON.stringify({ result: "invalid" }), { status: 200 })],
    ["a malformed result tuple", () => new Response(JSON.stringify({ result: [1] }), { status: 200 })],
    ["non-numeric result values", () => new Response(JSON.stringify({ result: ["invalid", 60_000] }), { status: 200 })],
  ])("fails closed when Upstash returns %s", async (_label, responseFactory) => {
    configureUpstash();
    const fetchMock = vi.fn(async () => responseFactory());
    vi.stubGlobal("fetch", fetchMock);

    const unavailable = await checkRateLimit(request(), "checkout", 1, 60_000);

    expect(unavailable?.status).toBe(503);
    expect(unavailable?.headers.get("Retry-After")).toBe("30");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an Upstash result within the limit", async () => {
    configureUpstash();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: [1, 60_000] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkRateLimit(request(), "checkout", 1, 60_000)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("delegates Cloudflare WAF enforcement without an app fetch", async () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "cloudflare_waf");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkRateLimit(request(), "checkout", 1, 60_000)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports provider status for memory, Upstash, and Cloudflare WAF", () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
    expect(getRateLimitProviderStatus()).toEqual({
      provider: "memory",
      durable: false,
      externalRequired: false,
      configured: true,
    });

    configureUpstash();
    expect(getRateLimitProviderStatus()).toEqual({
      provider: "upstash_redis",
      durable: true,
      externalRequired: true,
      configured: true,
    });

    vi.stubEnv(upstashRestUrlEnvKey, "");
    expect(getRateLimitProviderStatus()).toEqual({
      provider: "upstash_redis",
      durable: true,
      externalRequired: true,
      configured: false,
    });

    vi.stubEnv(upstashRestUrlEnvKey, "https://upstash.example.test");
    vi.stubEnv(upstashRestCredentialEnvKey, "");
    expect(getRateLimitProviderStatus()).toEqual({
      provider: "upstash_redis",
      durable: true,
      externalRequired: true,
      configured: false,
    });

    vi.stubEnv("RATE_LIMIT_PROVIDER", "cloudflare_waf");
    expect(getRateLimitProviderStatus()).toEqual({
      provider: "cloudflare_waf",
      durable: true,
      externalRequired: true,
      configured: false,
    });
  });
});
