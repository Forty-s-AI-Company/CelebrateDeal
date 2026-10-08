import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ origin: vi.fn(), token: vi.fn(), limit: vi.fn(), list: vi.fn(), db: {} }));
vi.mock("@/lib/api-security", () => ({ requireSameOriginRequest: mocks.origin }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/live-quota-admission", () => ({ liveViewerTokenFromRequest: mocks.token }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/live-purchase-broadcasts", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/live-purchase-broadcasts")>(), listLivePurchaseBroadcasts: mocks.list }));
import { GET } from "./route";
import { LivePurchaseBroadcastAccessDenied } from "@/lib/live-purchase-broadcasts";
const request = (query = "vendorId=vendor-1&liveId=live-1") => new Request(`http://localhost:3000/api/live-purchase-broadcasts?${query}`);
beforeEach(() => { vi.resetAllMocks(); mocks.origin.mockReturnValue(null); mocks.token.mockReturnValue("a".repeat(43)); mocks.limit.mockResolvedValue(null); mocks.list.mockResolvedValue([]); });
afterEach(() => vi.unstubAllEnvs());
describe("GET exact live purchase broadcasts", () => {
  it("uses same-origin client protection and emits private no-store responses", async () => {
    const req = request(); const result = await GET(req);
    expect(mocks.origin).toHaveBeenCalledWith(req, { requireClientHeader: true });
    expect(mocks.list).toHaveBeenCalledWith(mocks.db, { vendorId: "vendor-1", liveId: "live-1", admissionToken: "a".repeat(43) });
    expect(await result.json()).toEqual({ broadcasts: [] });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("cdn-cache-control")).toBe("no-store");
    expect(result.headers.get("vary")).toBe("Cookie");
  });
  it("rejects duplicate, unknown and malformed scope parameters", async () => {
    for (const query of ["vendorId=vendor-1&vendorId=vendor-2&liveId=live-1", "vendorId=vendor-1&liveId=live-1&all=true", "vendorId=vendor-1&liveId=.."]) expect((await GET(request(query))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("rejects absent admission before reading or returning purchase data", async () => {
    mocks.token.mockReturnValue(null); expect((await GET(request())).status).toBe(401); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("denies revoked, expired or foreign admission without resource disclosure", async () => {
    mocks.list.mockRejectedValue(new LivePurchaseBroadcastAccessDenied());
    const result = await GET(request()); expect(result.status).toBe(401); expect(await result.json()).toEqual({ error: "Viewer admission required" });
  });
  it("preserves no-store on origin denial and rate limiting", async () => {
    mocks.origin.mockReturnValue(new Response(null, { status: 403 })); let result = await GET(request()); expect(result.status).toBe(403); expect(result.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.list).not.toHaveBeenCalled();
    mocks.origin.mockReturnValue(null); mocks.limit.mockResolvedValue(new Response(null, { status: 429 })); result = await GET(request()); expect(result.status).toBe(429); expect(result.headers.get("cdn-cache-control")).toBe("no-store"); expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(["runtime", "untrusted"])("keeps forged forwarding headers in one %s bucket through the real memory limiter", async mode => {
    vi.stubEnv("RATE_LIMIT_PROVIDER", "memory"); vi.stubEnv("NODE_ENV", "test");
    const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
    mocks.limit.mockImplementation(actual.checkRateLimit);
    for (let index = 0; index < 121; index++) {
      const req = request();
      req.headers.set("cf-connecting-ip", `198.51.100.${index + 1}`);
      req.headers.set("x-forwarded-for", `203.0.113.${index + 1}`);
      req.headers.set("x-celebratedeal-live-chat-ingress", "forged");
      if (mode === "runtime") Object.defineProperty(req, "ip", { value: "192.0.2.19" });
      expect((await GET(req)).status).toBe(index < 120 ? 200 : 429);
      const limited = mocks.limit.mock.calls.at(-1)![0] as Request;
      expect(limited.headers.get("cf-connecting-ip")).toBe(mode === "runtime" ? "192.0.2.19" : "unknown");
      expect(limited.headers.get("x-forwarded-for")).toBeNull();
    }
    expect(mocks.list).toHaveBeenCalledTimes(120);
  });
});
