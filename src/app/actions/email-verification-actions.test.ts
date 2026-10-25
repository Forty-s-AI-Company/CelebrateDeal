import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ security: vi.fn(), auth: vi.fn(), limit: vi.fn(), turnstile: vi.fn(), send: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": "203.0.113.9" }) }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "http://127.0.0.1:31027" }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/merchant-email-verification", () => ({ sendMerchantEmailVerification: mocks.send }));
vi.mock("@/lib/turnstile", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/turnstile")>(), verifyTurnstileToken: mocks.turnstile }));

import { resendMerchantEmailVerificationAction } from "./email-verification-actions";

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user-1", email: "owner@example.test", emailVerifiedAt: null }, vendor: { id: "vendor-1" } });
  mocks.limit.mockResolvedValue(null);
  mocks.turnstile.mockResolvedValue({ ok: true, skipped: false });
  mocks.send.mockResolvedValue({ status: "sent", expiresAt: new Date() });
});

describe("resending the merchant verification email", () => {
  it("sends to the signed-in user only, whatever the form says", async () => {
    await expect(resendMerchantEmailVerificationAction(form({ userId: "someone-else", email: "attacker@example.test", "cf-turnstile-response": "widget-token" }))).rejects.toThrow("redirect:/verify-email?status=sent");
    expect(mocks.auth).toHaveBeenCalledWith({ nextPath: "/verify-email" });
    expect(mocks.turnstile).toHaveBeenCalledWith({ token: "widget-token", action: "merchant_verify_email_resend", remoteIp: "203.0.113.9" });
    expect(mocks.send).toHaveBeenCalledWith({ userId: "user-1", vendorId: "vendor-1", source: "resend" });
  });

  it("checks CSRF before anything else", async () => {
    mocks.security.mockRejectedValue(new Error("csrf"));
    await expect(resendMerchantEmailVerificationAction(form())).rejects.toThrow("csrf");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does nothing for an already verified account", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1", emailVerifiedAt: new Date() }, vendor: null });
    await expect(resendMerchantEmailVerificationAction(form())).rejects.toThrow("redirect:/verify-email?status=already_verified");
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([[429, "rate_limited"], [503, "temporarily_unavailable"]])("fails closed on IP rate-limit status %s before Turnstile or sending", async (status, code) => {
    mocks.limit.mockResolvedValue(new Response(null, { status }));
    await expect(resendMerchantEmailVerificationAction(form())).rejects.toThrow(`redirect:/verify-email?error=${code}`);
    expect(mocks.turnstile).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([["rejected", "turnstile_failed"], ["unavailable", "turnstile_unavailable"]] as const)("refuses a %s Turnstile check without sending", async (reason, code) => {
    mocks.turnstile.mockResolvedValue({ ok: false, reason });
    await expect(resendMerchantEmailVerificationAction(form())).rejects.toThrow(`redirect:/verify-email?error=${code}`);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "rate_limited", retryAfterSeconds: 60 }, "error=rate_limited"],
    [{ status: "failed" }, "error=send_failed"],
    [{ status: "ineligible" }, "error=send_failed"],
    [{ status: "already_verified" }, "status=already_verified"],
  ])("reports the send result %j", async (result, query) => {
    mocks.send.mockResolvedValue(result);
    await expect(resendMerchantEmailVerificationAction(form())).rejects.toThrow(`redirect:/verify-email?${query}`);
  });
});
