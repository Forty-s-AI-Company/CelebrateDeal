import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveViewerPass,
  LIVE_VIEWER_PASS_COOKIE,
  LIVE_VIEWER_PASS_TTL_SECONDS,
  liveViewerPassCookieOptions,
  liveViewerPassFromRequest,
  verifyLiveViewerPass,
} from "@/lib/live-viewer-pass";

const now = new Date("2026-10-21T08:00:00.000Z");
const admissionToken = "A".repeat(43);
const scope = { vendorId: "vendor-1", liveId: "live-1", admissionToken, now };

function issue(overrides: Partial<Parameters<typeof createLiveViewerPass>[0]> = {}) {
  const issuedAt = overrides.now ?? now;
  return createLiveViewerPass({
    vendorId: "vendor-1",
    liveId: "live-1",
    viewerSessionId: "session-1",
    admissionToken,
    now,
    sessionExpiresAt: new Date(issuedAt.getTime() + 90_000),
    ...overrides,
  });
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "live-viewer-pass-test-secret-longer-than-32-bytes");
});

afterEach(() => vi.unstubAllEnvs());

describe("signed live viewer pass", () => {
  it("verifies for the exact vendor, live and admission cookie and expires with the viewer session", () => {
    const pass = issue();
    expect(pass.startsWith("lvp1.")).toBe(true);
    expect(pass).not.toContain(admissionToken);
    expect(verifyLiveViewerPass(pass, scope)).toEqual({
      vendorId: "vendor-1",
      liveId: "live-1",
      viewerSessionId: "session-1",
      expiresAt: new Date(now.getTime() + 90_000),
    });
    expect(verifyLiveViewerPass(pass, { ...scope, now: new Date(now.getTime() + 89_000) })).not.toBeNull();
    expect(verifyLiveViewerPass(pass, { ...scope, now: new Date(now.getTime() + 90_000) })).toBeNull();
  });

  it("never outlives the session and caps any expiry at two minutes", () => {
    expect(LIVE_VIEWER_PASS_TTL_SECONDS).toBe(120);
    const capped = issue({ sessionExpiresAt: new Date(now.getTime() + 60 * 60_000) });
    expect(verifyLiveViewerPass(capped, scope)?.expiresAt).toEqual(new Date(now.getTime() + 120_000));
    expect(() => issue({ sessionExpiresAt: now })).toThrow();
  });

  it.each([
    ["another live", { liveId: "live-2" }],
    ["another tenant", { vendorId: "vendor-2" }],
    ["another admission cookie", { admissionToken: "B".repeat(43) }],
    ["a missing admission cookie", { admissionToken: null }],
  ])("rejects a pass presented for %s", (_label, overrides) => {
    expect(verifyLiveViewerPass(issue(), { ...scope, ...overrides })).toBeNull();
  });

  it("rejects tampered, re-signed-elsewhere, far-future and malformed passes", () => {
    const pass = issue();
    const [version, payload, signature] = pass.split(".");
    const forged = Buffer.from(JSON.stringify({ v: "vendor-2", l: "live-1", s: "session-1", a: "0".repeat(32), e: 1 }), "utf8").toString("base64url");
    expect(verifyLiveViewerPass(`${version}.${forged}.${signature}`, scope)).toBeNull();
    expect(verifyLiveViewerPass(`${version}.${payload}.${"A".repeat(43)}`, scope)).toBeNull();
    expect(verifyLiveViewerPass(`${pass}.extra`, scope)).toBeNull();
    expect(verifyLiveViewerPass("lvp2" + pass.slice(4), scope)).toBeNull();
    expect(verifyLiveViewerPass("", scope)).toBeNull();
    expect(verifyLiveViewerPass(null, scope)).toBeNull();
    expect(verifyLiveViewerPass("x".repeat(2_000), scope)).toBeNull();

    // A pass from a deployment with another secret does not verify here.
    vi.stubEnv("CSRF_SECRET", "another-deployment-secret-longer-than-32-bytes");
    expect(verifyLiveViewerPass(pass, scope)).toBeNull();
    vi.stubEnv("CSRF_SECRET", "live-viewer-pass-test-secret-longer-than-32-bytes");

    // Issued "in the future" beyond the TTL window (clock skew or forgery).
    expect(verifyLiveViewerPass(issue({ now: new Date(now.getTime() + 60_000) }), scope)).toBeNull();
  });

  it("refuses to issue a pass without a complete binding", () => {
    expect(() => issue({ viewerSessionId: "" })).toThrow();
    expect(() => issue({ vendorId: "v".repeat(129) })).toThrow();
    expect(() => issue({ admissionToken: "" })).toThrow();
  });

  it("reads only its own cookie and sets httpOnly, lax, secure-on-https options", () => {
    const pass = issue();
    const request = new Request("https://app.example.test/api/live-chat/messages", {
      headers: { cookie: `other=1; ${LIVE_VIEWER_PASS_COOKIE}=${encodeURIComponent(pass)}` },
    });
    expect(liveViewerPassFromRequest(request)).toBe(pass);
    expect(liveViewerPassFromRequest(new Request("https://app.example.test/"))).toBeNull();
    expect(liveViewerPassCookieOptions(request)).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 120 });
    expect(liveViewerPassCookieOptions(new Request("http://localhost/"), 0)).toMatchObject({ secure: false, maxAge: 0 });
  });
});
