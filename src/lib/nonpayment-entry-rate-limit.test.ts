import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInMemoryRateLimitForTests } from "@/lib/rate-limit";

const sideEffects = vi.hoisted(() => ({ db: vi.fn(() => { throw new Error("Unexpected database access"); }), auth: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({ getDb: sideEffects.db }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: sideEffects.auth }));

// Exercise real route -> trusted resolver -> actual memory limiter. No limiter mock.
const cases = [
  { path: "api/affiliate-attribution/direct-entry", method: "POST", limit: 60, load: () => import("@/app/api/affiliate-attribution/direct-entry/route") },
  { path: "api/affiliate-clicks", method: "POST", limit: 60, load: () => import("@/app/api/affiliate-clicks/route") },
  { path: "api/analytics", method: "POST", limit: 120, load: () => import("@/app/api/analytics/route") },
  { path: "api/auth/line/callback", method: "GET", limit: 30, load: () => import("@/app/api/auth/line/callback/route") },
  { path: "api/auth/line/start", method: "POST", limit: 15, load: () => import("@/app/api/auth/line/start/route") },
  { path: "api/auth/password-reset/confirm", method: "POST", limit: 10, load: () => import("@/app/api/auth/password-reset/confirm/route") },
  { path: "api/auth/password-reset/request", method: "POST", limit: 5, load: () => import("@/app/api/auth/password-reset/request/route") },
  { path: "api/form-submissions", method: "POST", limit: 10, load: () => import("@/app/api/form-submissions/route") },
  { path: "api/form-submissions/verify", method: "POST", limit: 20, load: () => import("@/app/api/form-submissions/verify/route") },
  { path: "api/live-danmaku", method: "GET", limit: 120, load: () => import("@/app/api/live-danmaku/route") },
  { path: "api/live-danmaku", method: "POST", limit: 120, load: () => import("@/app/api/live-danmaku/route") },
  { path: "api/live-danmaku/scripted", method: "GET", limit: 90, load: () => import("@/app/api/live-danmaku/scripted/route") },
  { path: "api/live-danmaku/scripted", method: "POST", limit: 90, load: () => import("@/app/api/live-danmaku/scripted/route") },
  { path: "api/live-interactions", method: "GET", limit: 1200, load: () => import("@/app/api/live-interactions/route") },
  { path: "api/live-interactions", method: "POST", limit: 60, load: () => import("@/app/api/live-interactions/route") },
  { path: "api/live-interactions/cards", method: "GET", limit: 120, load: () => import("@/app/api/live-interactions/cards/route") },
  { path: "api/live-interactions/cards", method: "POST", limit: 120, load: () => import("@/app/api/live-interactions/cards/route") },
  { path: "api/live-media", method: "POST", limit: 90, load: () => import("@/app/api/live-media/route") },
  { path: "api/live-playback-source", method: "GET", limit: 120, load: () => import("@/app/api/live-playback-source/route") },
  { path: "api/live-presenter", method: "GET", limit: 60, load: () => import("@/app/api/live-presenter/route") },
  { path: "api/live-presenter", method: "POST", limit: 60, load: () => import("@/app/api/live-presenter/route") },
  { path: "api/security/csp-report", method: "POST", limit: 120, load: () => import("@/app/api/security/csp-report/route") },
  { path: "api/stream-usage", method: "POST", limit: 120, load: () => import("@/app/api/stream-usage/route") },
] as const;

function request(path: string, method: string, attempt: number, trusted: boolean) {
  const value = new Request(`https://app.example.test/${path}`, {
    method,
    headers: {
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      "content-type": "application/json",
      "cf-connecting-ip": `203.0.113.${attempt % 250 + 1}`,
      "x-forwarded-for": `198.51.100.${attempt % 250 + 1}`,
      "x-real-ip": `192.0.2.${attempt % 250 + 1}`,
      "x-vercel-forwarded-for": `192.0.2.${attempt % 250 + 1}`,
    },
    ...(method === "POST" ? { body: "{}" } : {}),
  });
  // An adapter-provided property, never a browser-controlled header.
  if (trusted) Object.defineProperty(value, "ip", { value: "192.0.2.200" });
  return value;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
  vi.stubEnv("ENTRY_CLIENT_IP_TRUST_MODE", "runtime");
  vi.stubEnv("ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE", "node");
  resetInMemoryRateLimitForTests();
  vi.clearAllMocks();
});
afterEach(() => { resetInMemoryRateLimitForTests(); vi.unstubAllEnvs(); });

describe.each(cases)("nonpayment source boundary $method $path", ({ path, method, limit, load }) => {
  it("rejects forged forwarding metadata before auth or database effects", async () => {
    const route = await load();
    const handler = (route as Record<string, (r: Request) => Promise<Response>>)[method];
    const response = await handler(request(path, method, 1, false));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Request source unavailable" });
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(sideEffects.db).not.toHaveBeenCalled();
    expect(sideEffects.auth).not.toHaveBeenCalled();
  });

  it("keeps the original threshold with trusted identity despite forged header rotation", async () => {
    const route = await load();
    const handler = (route as Record<string, (r: Request) => Promise<Response>>)[method];
    for (let index = 0; index < limit; index++) {
      const response = await handler(request(path, method, index, true));
      expect([429, 503]).not.toContain(response.status);
    }
    vi.clearAllMocks();
    const response = await handler(request(path, method, limit, true));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests" });
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(sideEffects.db).not.toHaveBeenCalled();
    expect(sideEffects.auth).not.toHaveBeenCalled();
  });
});

// Capacity contract: 32 independent viewers sharing one trusted source, 2s polling.
it("allows a minute of 32-viewer polling on one source without exhausting the read bucket", async () => {
  const { GET } = await import("@/app/api/live-interactions/route");
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const start = Date.now();
    for (let tick = 0; tick < 30; tick++) {
      vi.setSystemTime(start + tick * 2_000);
      const responses = await Promise.all(Array.from({ length: 32 }, (_, viewer) =>
        GET(request("api/live-interactions", "GET", viewer, true))));
      // Invalid synthetic scopes exit after admission limiting, before database work.
      // 400 proves the source limiter allowed all 32 calls in each polling round.
      expect(responses.every(response => response.status === 400)).toBe(true);
    }
    expect(sideEffects.db).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
