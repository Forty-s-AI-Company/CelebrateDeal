import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createLocalSupportRateLimitServer,
  LOCAL_SUPPORT_RATE_LIMIT_TOKEN,
} from "./local-support-rate-limit-fixture.mjs";

const server = createLocalSupportRateLimitServer();
let url = "";

describe("local support rate limit fixture protocol integration", () => {
  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("LOCAL_FIXTURE_ADDRESS_MISSING");
    url = `http://127.0.0.1:${address.port}`;
    vi.stubEnv("RATE_LIMIT_PROVIDER", "upstash_redis");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", url);
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", LOCAL_SUPPORT_RATE_LIMIT_TOKEN);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("uses the real Upstash client protocol over loopback", async () => {
    const request = new Request("http://app.example.test/support", {
      headers: { "x-forwarded-for": "198.51.100.77" },
    });
    expect(await checkRateLimit(request, "support-case", 2, 60_000)).toBeNull();
    expect(await checkRateLimit(request, "support-case", 2, 60_000)).toBeNull();
    const limited = await checkRateLimit(request, "support-case", 2, 60_000);
    expect(limited?.status).toBe(429);
    expect(Number(limited?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(Number(limited?.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
  });
});
