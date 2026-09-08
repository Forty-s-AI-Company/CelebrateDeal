import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  checkRateLimit: vi.fn(),
  createSession: vi.fn(),
  cookieSet: vi.fn(),
  redirect: vi.fn(),
  security: vi.fn(),
  writeAuditLog: vi.fn(),
  requirePortal: vi.fn(),
  requestPayout: vi.fn(),
  requestAuditMeta: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet, delete: vi.fn() }),
  headers: async () => ({ get: (name: string) => name === "x-forwarded-for" ? "203.0.113.5" : null }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "test-session",
  createUserSession: mocks.createSession,
  revokeCurrentSession: vi.fn(),
  sessionCookieOptions: () => ({ httpOnly: true }),
}));
vi.mock("@/lib/affiliate-portal-auth", () => ({
  authenticateAffiliatePortal: mocks.authenticate,
  requireAffiliatePortal: mocks.requirePortal,
}));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/audit", () => ({ requestAuditMeta: mocks.requestAuditMeta, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/bank-account", () => ({ encryptBankAccount: vi.fn() }));
vi.mock("@/lib/tax-identity", () => ({ encryptTaxIdentity: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/affiliate-portal-payout", () => ({ requestAffiliatePayout: mocks.requestPayout }));

import { affiliatePortalLoginAction, requestAffiliatePayoutAction } from "@/app/actions/affiliate-portal-actions";

function loginForm() {
  const form = new FormData();
  form.set("email", "affiliate@example.test");
  form.set("password", "password");
  form.set("code", "partner");
  return form;
}

describe("affiliate portal login action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.createSession.mockResolvedValue({ token: "opaque", expiresAt: new Date("2026-09-10") });
  });

  it("enforces a source-wide limiter before credential verification", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(affiliatePortalLoginAction(loginForm())).rejects.toThrow("redirect:/affiliate-portal/login?error=rate_limited");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "affiliate-portal-login-source", 20, 15 * 60 * 1000);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("audits invalid credentials without creating a session", async () => {
    mocks.authenticate.mockResolvedValue(null);
    await expect(affiliatePortalLoginAction(loginForm())).rejects.toThrow("redirect:/affiliate-portal/login?error=invalid");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "affiliate_portal_login_failed" }));
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("creates a tenant-bound session and audits a successful promoter login", async () => {
    mocks.authenticate.mockResolvedValue({
      user: { id: "user-a" },
      affiliate: { id: "affiliate-a", vendorId: "vendor-a" },
    });
    await expect(affiliatePortalLoginAction(loginForm())).rejects.toThrow("redirect:/affiliate-portal");
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", vendorId: "vendor-a" }));
    expect(mocks.cookieSet).toHaveBeenCalledWith("test-session", "opaque", { httpOnly: true });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "affiliate_portal_login_success", vendorId: "vendor-a" }));
  });
});

describe("affiliate payout remuneration signing action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
    mocks.requirePortal.mockResolvedValue({
      auth: { user: { id: "user-a" } },
      affiliate: { id: "affiliate-a", vendorId: "vendor-a", bankAccountEncrypted: "bank-envelope", taxIdentityEncrypted: "tax-envelope" },
    });
    mocks.requestAuditMeta.mockResolvedValue({ ipAddress: null, userAgent: "test" });
    mocks.requestPayout.mockResolvedValue("requested");
    mocks.getDb.mockReturnValue({});
  });

  function payoutForm(consent = "accepted") {
    const form = new FormData();
    form.set("payoutId", "payout-a");
    form.set("remunerationConsent", consent);
    return form;
  }

  it("requires explicit consent before writing a signed snapshot", async () => {
    await expect(requestAffiliatePayoutAction(payoutForm(""))).rejects.toThrow("redirect:/affiliate-portal?error=consent_required");
    expect(mocks.requestPayout).not.toHaveBeenCalled();
  });

  it("derives tenant, affiliate and encrypted PII snapshots from server-owned state", async () => {
    await expect(requestAffiliatePayoutAction(payoutForm())).rejects.toThrow("redirect:/affiliate-portal?payout=requested");
    expect(mocks.security).toHaveBeenCalled();
    expect(mocks.requestPayout).toHaveBeenCalledWith({}, expect.objectContaining({
      payoutId: "payout-a",
      vendorId: "vendor-a",
      affiliateId: "affiliate-a",
      bankAccountEncrypted: "bank-envelope",
      taxIdentityEncrypted: "tax-envelope",
    }));
  });
});
