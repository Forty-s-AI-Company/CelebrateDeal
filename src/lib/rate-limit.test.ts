import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, resetInMemoryRateLimitForTests } from "@/lib/rate-limit";

function request(ip = "203.0.113.10") {
  return new Request("https://app.example.test/api/test", {
    headers: { "x-forwarded-for": ip },
  });
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
    vi.stubEnv("RATE_LIMIT_PROVIDER", "upstash_redis");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.example.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: [2, 45_000] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const limited = await checkRateLimit(request(), "checkout", 1, 60_000);

    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("Retry-After")).toBe("45");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(JSON.parse(String(init?.body))[0]).toBe("EVAL");
  });
});
