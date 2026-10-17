import { afterEach, expect, it, vi } from "vitest";
import { checkRateLimit } from "./trusted-entry-rate-limit";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("keeps native buckets isolated and stable through the real limiter's Redis HTTP protocol", async () => {
  const env = {
    ENTRY_CLIENT_IP_TRUST_MODE: "vercel-native", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "vercel",
    ENTRY_CLIENT_IP_TOPOLOGY: "direct-vercel", ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID: "synthetic-project",
    VERCEL: "1", VERCEL_ENV: "preview", VERCEL_PROJECT_ID: "synthetic-project",
    RATE_LIMIT_PROVIDER: "upstash_redis", UPSTASH_REDIS_REST_URL: "https://redis.synthetic.invalid",
    UPSTASH_REDIS_REST_TOKEN: "synthetic-not-a-real-credential",
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  // Protocol fixture only: exercise the real entry + limiter chain, never an external store.
  const buckets = new Map<string, number>();
  const fetcher = vi.fn(async (_url: unknown, options: RequestInit) => {
    const [operation, script, numberOfKeys, key, limit, window] = JSON.parse(String(options.body));
    expect(operation).toBe("EVAL"); expect(script).toContain('redis.call("INCR"');
    expect([numberOfKeys, limit, window]).toEqual([1, "2", "60000"]);
    const count = (buckets.get(key) ?? 0) + 1; buckets.set(key, count);
    return Response.json({result:[count,60000]});
  });
  vi.stubGlobal("fetch", fetcher);
  const hit = async (ip: string, forged: string) => checkRateLimit(new Request("https://synthetic.invalid/entry", {
    headers: {"x-vercel-forwarded-for":ip, "cf-connecting-ip":forged, "x-forwarded-for":forged, "x-real-ip":forged},
  }), "entry", 2, 60000);
  expect(await hit("192.0.2.1", "192.0.2.100")).toBeNull();
  expect(await hit("::ffff:192.0.2.1", "192.0.2.101")).toBeNull();
  expect((await hit("192.0.2.1", "192.0.2.102"))?.status).toBe(429);
  expect(await hit("192.0.2.2", "192.0.2.102")).toBeNull();
  expect(await hit("2001:db8:1:2::1", "192.0.2.100")).toBeNull();
  expect(await hit("2001:db8:1:2::2", "192.0.2.101")).toBeNull();
  expect((await hit("2001:db8:1:2::3", "192.0.2.102"))?.status).toBe(429);
  expect(await hit("2001:db8:1:3::3", "192.0.2.102")).toBeNull();
  expect(buckets.size).toBe(4);
  expect([...buckets.keys()].sort()).toEqual([
    "192.0.2.1", "192.0.2.2", "2001:db8:1:2::", "2001:db8:1:3::",
  ].map(ip=>`celebratedeal:rl:entry-vercel-native:entry:${ip}`).sort());
  // The real provider must fail closed before any HTTP call when its configuration is absent.
  for (const key of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
    for (const missing of [undefined, ""]) {
      vi.stubEnv(key, missing); fetcher.mockClear();
      expect((await hit("192.0.2.2", "192.0.2.103"))?.status).toBe(503);
      expect((await hit("192.0.2.2", "192.0.2.104"))?.status).toBe(503);
      expect(fetcher).not.toHaveBeenCalled();
    }
    vi.stubEnv(key, env[key as keyof typeof env]);
  }
  fetcher.mockClear();
  fetcher.mockImplementationOnce(async () => { throw new Error("synthetic network failure"); });
  expect((await hit("192.0.2.2", "192.0.2.103"))?.status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
