import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, resetInMemoryRateLimitForTests } from "@/lib/rate-limit";
import {
  clientIpTrustConfig,
  copyTrustedClientIpHeaders,
  getTrustedClientIp,
  isVercelDeployment,
  rateLimitIpBucket,
  resetUnresolvedClientIpLogForTests,
} from "@/lib/request-client-ip";
import { liveChatIpTrustConfig } from "@/lib/live-chat-request-security";

/**
 * A4-03 / D-20: the production domain does not go through Cloudflare (O-7), so
 * headers a client can set must never pick the rate-limit bucket or the IP
 * that is recorded.
 */
const SPOOFABLE = ["cf-connecting-ip", "true-client-ip", "x-client-ip", "forwarded", "fastly-client-ip", "x-cluster-client-ip"];

const vercelProduction = { NODE_ENV: "production", VERCEL_ENV: "production" } as NodeJS.ProcessEnv;
const vercelPreview = { NODE_ENV: "production", VERCEL_ENV: "preview" } as NodeJS.ProcessEnv;
const localDev = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
const test = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
const otherProduction = { NODE_ENV: "production", RATE_LIMIT_PROVIDER: "cloudflare_waf" } as NodeJS.ProcessEnv;

function forged(index: number) {
  return Object.fromEntries(SPOOFABLE.map((name) => [name, name === "forwarded" ? `for=192.0.2.${index}` : `192.0.2.${index}`]));
}

function request(headers: Record<string, string>) {
  return new Request("https://app.example.test/api/test", { method: "POST", headers });
}

afterEach(() => {
  resetInMemoryRateLimitForTests();
  vi.unstubAllEnvs();
});

describe("clientIpTrustConfig", () => {
  it("selects the Vercel edge only on a deployed Vercel function", () => {
    expect(isVercelDeployment(vercelProduction)).toBe(true);
    expect(isVercelDeployment(vercelPreview)).toBe(true);
    expect(isVercelDeployment({ NODE_ENV: "development", VERCEL_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(clientIpTrustConfig(vercelProduction)).toEqual({ trustMode: "vercel-edge", deploymentSource: "vercel" });
    expect(clientIpTrustConfig(vercelPreview)).toEqual({ trustMode: "vercel-edge", deploymentSource: "vercel" });
  });

  it("uses an explicit local fallback outside production and trusts nothing in other production runtimes", () => {
    expect(clientIpTrustConfig(localDev)).toEqual({ trustMode: "local-forwarded", deploymentSource: "node" });
    expect(clientIpTrustConfig(test)).toEqual({ trustMode: "local-forwarded", deploymentSource: "node" });
    expect(clientIpTrustConfig(otherProduction)).toEqual({ trustMode: "none", deploymentSource: "none" });
    // RATE_LIMIT_PROVIDER never selects a header.
    expect(clientIpTrustConfig({ ...otherProduction, RATE_LIMIT_PROVIDER: "upstash_redis" })).toEqual({ trustMode: "none", deploymentSource: "none" });
  });

  it("treats only the explicit loopback E2E production runtime like local (MAJOR-1)", () => {
    const e2e = {
      NODE_ENV: "production",
      E2E_TEST_MODE: "true",
      E2E_BASE_URL: "http://127.0.0.1:31023",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31023",
    } as NodeJS.ProcessEnv;
    expect(clientIpTrustConfig(e2e)).toEqual({ trustMode: "local-forwarded", deploymentSource: "node" });
    expect(getTrustedClientIp(request({ "x-forwarded-for": "2001:db8:1:2::1", "cf-connecting-ip": "192.0.2.1" }), e2e)).toBe("2001:db8:1:2::1");
    for (const env of [
      { ...e2e, E2E_TEST_MODE: undefined },
      { ...e2e, E2E_BASE_URL: "http://127.0.0.1:31024" },
      { ...e2e, NEXT_PUBLIC_APP_URL: "https://app.example.test", E2E_BASE_URL: "https://app.example.test" },
      { ...e2e, NEXT_PUBLIC_APP_URL: "https://ci.celebratedeal.local", E2E_BASE_URL: "https://ci.celebratedeal.local" },
    ]) {
      expect(clientIpTrustConfig(env)).toEqual({ trustMode: "none", deploymentSource: "none" });
    }
  });

  it("gives live chat the same Vercel rule and keeps its stricter non-Vercel contract", () => {
    expect(liveChatIpTrustConfig({ ...vercelProduction, RATE_LIMIT_PROVIDER: "cloudflare_waf" })).toEqual({ trustMode: "vercel-edge", deploymentSource: "vercel" });
    expect(liveChatIpTrustConfig({ ...vercelPreview, RATE_LIMIT_PROVIDER: "upstash_redis" })).toEqual({ trustMode: "vercel-edge", deploymentSource: "vercel" });
    expect(liveChatIpTrustConfig(localDev)).toEqual({ trustMode: "runtime", deploymentSource: "node" });
  });
});

describe("getTrustedClientIp", () => {
  it("reads Vercel's x-real-ip, then x-forwarded-for, and ignores every spoofable alternate", () => {
    expect(getTrustedClientIp(request({ ...forged(1), "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10" }), vercelProduction)).toBe("203.0.113.10");
    expect(getTrustedClientIp(request({ ...forged(1), "x-forwarded-for": "203.0.113.11" }), vercelProduction)).toBe("203.0.113.11");
    expect(getTrustedClientIp(request(forged(1)), vercelProduction)).toBeNull();
  });

  it("accepts Headers and next/headers-style readers", () => {
    const headers = new Headers({ ...forged(2), "x-real-ip": "2001:0DB8::5" });
    expect(getTrustedClientIp(headers, vercelPreview)).toBe("2001:db8::5");
    expect(getTrustedClientIp({ get: (name: string) => headers.get(name) }, vercelPreview)).toBe("2001:db8::5");
  });

  it("returns null for a non-Vercel production runtime even with plausible headers", () => {
    expect(getTrustedClientIp(request({ "x-real-ip": "203.0.113.10", "x-forwarded-for": "203.0.113.10", ...forged(3) }), otherProduction)).toBeNull();
  });

  it("uses the local server's x-forwarded-for in development and still ignores spoofable alternates", () => {
    expect(getTrustedClientIp(request({ ...forged(4), "x-forwarded-for": "127.0.0.1" }), localDev)).toBe("127.0.0.1");
    expect(getTrustedClientIp(request(forged(4)), localDev)).toBeNull();
  });

  it("copies only the trusted headers for server-action limiter requests", () => {
    const copied = copyTrustedClientIpHeaders(new Headers({ ...forged(5), "x-real-ip": "203.0.113.12", "x-forwarded-for": "203.0.113.12", "user-agent": "agent" }));
    expect([...copied.keys()].sort()).toEqual(["x-forwarded-for", "x-real-ip"]);
  });
});

describe("unresolved production address (MAJOR-2)", () => {
  it("logs at most once a minute, with the trust mode only", () => {
    resetUnresolvedClientIpLogForTests();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const secretish = { "x-forwarded-for": "198.51.100.77", "cf-connecting-ip": "192.0.2.77" };
      expect(getTrustedClientIp(request(secretish), otherProduction)).toBeNull();
      expect(getTrustedClientIp(request(secretish), otherProduction)).toBeNull();
      expect(getTrustedClientIp(request({}), vercelProduction)).toBeNull();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith("client_ip_unresolved", JSON.stringify({ trustMode: "none" }));
      expect(JSON.stringify(error.mock.calls)).not.toContain("198.51.100.77");
      // Development never logs.
      resetUnresolvedClientIpLogForTests();
      expect(getTrustedClientIp(request({}), localDev)).toBeNull();
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      resetUnresolvedClientIpLogForTests();
    }
  });
});

describe("rateLimitIpBucket (MINOR-3)", () => {
  it("cuts IPv6 to its /64 and leaves IPv4 and labels alone", () => {
    expect(rateLimitIpBucket("2001:db8:aa:bb:1:2:3:4")).toBe("2001:db8:aa:bb::/64");
    expect(rateLimitIpBucket("2001:0DB8:00AA:00BB::9")).toBe("2001:db8:aa:bb::/64");
    expect(rateLimitIpBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitIpBucket("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitIpBucket("203.0.113.5")).toBe("203.0.113.5");
    // MINOR-A: IPv4-mapped addresses (::ffff:0:0/96) bucket as their IPv4 address.
    expect(rateLimitIpBucket("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(rateLimitIpBucket("::FFFF:cb00:7105")).toBe("203.0.113.5");
    expect(rateLimitIpBucket("::ffff:198.51.100.1")).not.toBe(rateLimitIpBucket("::ffff:198.51.100.2"));
    // Not mapped: ::ffff:0:x:y style prefixes outside /96 stay /64.
    expect(rateLimitIpBucket("64:ff9b::203.0.113.5")).toBe("64:ff9b:0:0::/64");
    expect(rateLimitIpBucket("authenticated-buyer")).toBe("authenticated-buyer");
    expect(rateLimitIpBucket("viewer-session:abc")).toBe("viewer-session:abc");
  });

  it("shares one limiter bucket across a /64 but keeps the full address for audit", async () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    const first = request({ "x-real-ip": "2001:db8:aa:bb::1" });
    expect(getTrustedClientIp(first)).toBe("2001:db8:aa:bb::1");
    expect(await checkRateLimit(first, "a4-03-v6", 1, 60_000)).toBeNull();
    expect((await checkRateLimit(request({ "x-real-ip": "2001:db8:aa:bb:ffff::2" }), "a4-03-v6", 1, 60_000))?.status).toBe(429);
    expect(await checkRateLimit(request({ "x-real-ip": "2001:db8:aa:bc::1" }), "a4-03-v6", 1, 60_000)).toBeNull();
    // An explicit IPv6 identity is bucketed the same way.
    expect((await checkRateLimit(request({}), "a4-03-v6", 1, 60_000, { clientIp: "2001:db8:aa:bb::77" }))?.status).toBe(429);
  });
});

describe("checkRateLimit bucket key", () => {
  it("cannot be rotated by forging cf-connecting-ip or true-client-ip on Vercel", async () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");

    const limit = 3;
    for (let index = 0; index < limit; index += 1) {
      expect(await checkRateLimit(request({ ...forged(index), "x-real-ip": "203.0.113.30" }), "a4-03", limit, 60_000)).toBeNull();
    }
    const limited = await checkRateLimit(request({ ...forged(99), "x-real-ip": "203.0.113.30" }), "a4-03", limit, 60_000);
    expect(limited?.status).toBe(429);
    // A genuinely different edge-resolved address has its own bucket.
    expect(await checkRateLimit(request({ ...forged(99), "x-real-ip": "203.0.113.31" }), "a4-03", limit, 60_000)).toBeNull();
  });

  it("cannot be rotated by forging cf-connecting-ip in local/test mode either", async () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
    expect(await checkRateLimit(request({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "198.51.100.30" }), "a4-03-local", 1, 60_000)).toBeNull();
    const limited = await checkRateLimit(request({ "cf-connecting-ip": "192.0.2.2", "x-forwarded-for": "198.51.100.30" }), "a4-03-local", 1, 60_000);
    expect(limited?.status).toBe(429);
  });

  it("uses an explicit caller identity instead of any header", async () => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
    expect(await checkRateLimit(request({ "x-forwarded-for": "198.51.100.40" }), "a4-03-identity", 1, 60_000, { clientIp: "authenticated-buyer" })).toBeNull();
    const limited = await checkRateLimit(request({ "x-forwarded-for": "198.51.100.41" }), "a4-03-identity", 1, 60_000, { clientIp: "authenticated-buyer" });
    expect(limited?.status).toBe(429);
    // null is the shared "unknown" bucket, not a fallback to headers.
    expect(await checkRateLimit(request({ "x-forwarded-for": "198.51.100.42" }), "a4-03-null", 1, 60_000, { clientIp: null })).toBeNull();
    expect((await checkRateLimit(request({ "x-forwarded-for": "198.51.100.43" }), "a4-03-null", 1, 60_000, { clientIp: null }))?.status).toBe(429);
  });
});
