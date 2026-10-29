import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  security: vi.fn(),
  auth: vi.fn(),
  ipLimit: vi.fn(),
  accountLimit: vi.fn(),
  verifyPassword: vi.fn(),
  schedule: vi.fn(),
  audit: vi.fn(),
  lockedUntil: vi.fn(),
  voidLinks: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "http://127.0.0.1:31027" }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.ipLimit }));
vi.mock("@/lib/account-rate-limit", () => ({ checkAccountRateLimit: mocks.accountLimit }));
vi.mock("@/lib/password", () => ({ verifyPasswordAsync: mocks.verifyPassword }));
vi.mock("@/lib/account-email-change", () => ({ scheduleAccountEmailChangeRequest: mocks.schedule, accountEmailChangeLockedUntil: mocks.lockedUntil, voidAccountEmailRevertLinks: mocks.voidLinks }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ synthetic: "db" }) }));

import { requestAccountEmailChangeAction, voidAccountEmailRevertLinksAction } from "./account-email-change-actions";

const NOW = Date.now();

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  data.set("newEmail", "  New.Owner@Example.TEST ");
  data.set("currentPassword", "synthetic-current-password");
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}

function signedIn(overrides: { mfaFactor?: unknown; mfaVerifiedAt?: Date | null; platformRole?: string } = {}) {
  return {
    user: { id: "user-1", email: "owner@example.test", passwordHash: "scrypt:synthetic", platformRole: overrides.platformRole ?? "none", mfaFactor: overrides.mfaFactor ?? null },
    session: { id: "session-1", mfaVerifiedAt: overrides.mfaVerifiedAt ?? null },
    vendor: { id: "vendor-1" },
    member: { role: "owner" },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(signedIn());
  mocks.ipLimit.mockResolvedValue(null);
  mocks.accountLimit.mockResolvedValue(null);
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.audit.mockResolvedValue(undefined);
  mocks.lockedUntil.mockResolvedValue(null);
  mocks.voidLinks.mockResolvedValue({ status: "voided", voided: 1 });
});

describe("requesting a login email change", () => {
  it("schedules the change for the signed-in account only, with the normalized address, and answers the generic message", async () => {
    await expect(requestAccountEmailChangeAction(form({ userId: "someone-else", currentEmail: "victim@example.test" }))).rejects.toThrow("redirect:/settings/security?updated=email_change_sent");
    expect(mocks.auth).toHaveBeenCalledWith({ nextPath: "/settings/security" });
    expect(mocks.verifyPassword).toHaveBeenCalledWith("synthetic-current-password", "scrypt:synthetic");
    expect(mocks.accountLimit).toHaveBeenCalledWith("account_email_change_request", "user-1");
    expect(mocks.ipLimit).toHaveBeenCalledWith(expect.any(Request), "account-email-change-source", 10, 15 * 60 * 1000);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith({
      userId: "user-1",
      currentEmail: "owner@example.test",
      newEmail: "new.owner@example.test",
      vendorId: "vendor-1",
      actorLabel: "owner",
    });
  });

  it("checks CSRF before anything else", async () => {
    mocks.security.mockRejectedValue(new Error("csrf"));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("csrf");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("requires a recent MFA verification when the account has a factor", async () => {
    mocks.auth.mockResolvedValue(signedIn({ mfaFactor: { id: "factor-1" }, mfaVerifiedAt: new Date(NOW - 60 * 60_000) }));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/mfa/verify?reason=step_up&next=%2Fsettings%2Fsecurity");
    mocks.auth.mockResolvedValue(signedIn({ mfaFactor: { id: "factor-1" }, mfaVerifiedAt: null }));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/mfa/verify?reason=step_up&next=%2Fsettings%2Fsecurity");
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.accountLimit).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();

    // A fresh verification passes the step-up; the password is still required.
    mocks.auth.mockResolvedValue(signedIn({ mfaFactor: { id: "factor-1" }, mfaVerifiedAt: new Date(NOW - 60_000) }));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/settings/security?updated=email_change_sent");
    expect(mocks.verifyPassword).toHaveBeenCalledOnce();
    expect(mocks.schedule).toHaveBeenCalledOnce();
  });

  it("requires a recent MFA for any platform role, sending one without a factor to enrolment", async () => {
    mocks.auth.mockResolvedValue(signedIn({ platformRole: "platform_admin" }));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/mfa/setup?reason=step_up&next=%2Fsettings%2Fsecurity");
    mocks.auth.mockResolvedValue(signedIn({ platformRole: "platform_admin", mfaFactor: { id: "factor-1" }, mfaVerifiedAt: new Date(NOW - 60 * 60_000) }));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/mfa/verify?reason=step_up&next=%2Fsettings%2Fsecurity");
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue(signedIn({ platformRole: "platform_admin", mfaFactor: { id: "factor-1" }, mfaVerifiedAt: new Date(NOW - 60_000) }));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/settings/security?updated=email_change_sent");
    expect(mocks.schedule).toHaveBeenCalledOnce();
  });

  it("refuses during the seven-day lock after a used revert link, before the password check", async () => {
    mocks.lockedUntil.mockResolvedValue(new Date(NOW + 60_000));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/settings/security?error=email_change_locked");
    expect(mocks.lockedUntil).toHaveBeenCalledWith({ synthetic: "db" }, "user-1");
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    mocks.lockedUntil.mockRejectedValue(new Error("database down"));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/settings/security?error=email_change_unavailable");
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("does not force MFA enrolment on an account without a factor", async () => {
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/settings/security?updated=email_change_sent");
    expect(mocks.schedule).toHaveBeenCalledOnce();
  });

  it.each([[429, "email_change_rate_limited"], [503, "email_change_unavailable"]])("fails closed on IP limit status %s before the password check", async (status, code) => {
    mocks.ipLimit.mockResolvedValue(new Response(null, { status }));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow(`redirect:/settings/security?error=${code}`);
    expect(mocks.accountLimit).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it.each([[429, "email_change_rate_limited"], [503, "email_change_unavailable"]])("fails closed on account limit status %s before the password check", async (status, code) => {
    mocks.accountLimit.mockResolvedValue(new Response(null, { status }));
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow(`redirect:/settings/security?error=${code}`);
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("refuses a wrong or missing current password, audits it, and schedules nothing", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    await expect(requestAccountEmailChangeAction(form())).rejects.toThrow("redirect:/settings/security?error=email_change_password");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "user-1", action: "account_email_change_password_failed", targetId: "user-1" }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("synthetic-current-password");

    mocks.verifyPassword.mockClear();
    const missing = form();
    missing.delete("currentPassword");
    await expect(requestAccountEmailChangeAction(missing)).rejects.toThrow("redirect:/settings/security?error=email_change_password");
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it.each([
    ["an invalid address", "not-an-email"],
    ["an empty address", "   "],
    ["an over-long address", `${"a".repeat(64)}@${"b".repeat(300)}.test`],
  ])("refuses %s before the password check", async (_label, newEmail) => {
    await expect(requestAccountEmailChangeAction(form({ newEmail }))).rejects.toThrow("redirect:/settings/security?error=email_change_invalid");
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("refuses the current address, whatever its case or spacing", async () => {
    await expect(requestAccountEmailChangeAction(form({ newEmail: " OWNER@example.test " }))).rejects.toThrow("redirect:/settings/security?error=email_change_same");
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("answers the same way whether or not the address is free: the outcome is decided after the response", async () => {
    await expect(requestAccountEmailChangeAction(form({ newEmail: "taken@example.test" }))).rejects.toThrow("redirect:/settings/security?updated=email_change_sent");
    await expect(requestAccountEmailChangeAction(form({ newEmail: "free@example.test" }))).rejects.toThrow("redirect:/settings/security?updated=email_change_sent");
    // The action never looks up other accounts; it only hands the request on.
    expect(mocks.schedule.mock.calls.map(([input]) => input.newEmail)).toEqual(["taken@example.test", "free@example.test"]);
  });
});

describe("voiding the old mailbox's revert links", () => {
  const fresh = () => signedIn({ mfaFactor: { id: "factor-1" }, mfaVerifiedAt: new Date(Date.now() - 60_000) });

  it("voids only the signed-in user's own links, bound to the session and factor it checked, whatever the form says", async () => {
    mocks.auth.mockResolvedValue(fresh());
    const forged = new FormData();
    forged.set("userId", "someone-else");
    forged.set("requestId", "request-of-someone-else");
    await expect(voidAccountEmailRevertLinksAction(forged)).rejects.toThrow("redirect:/settings/security?updated=email_revert_links_voided");
    expect(mocks.auth).toHaveBeenCalledWith({ nextPath: "/settings/security" });
    expect(mocks.voidLinks).toHaveBeenCalledExactlyOnceWith({ userId: "user-1", sessionId: "session-1", factorId: "factor-1", vendorId: "vendor-1", actorLabel: "owner" });
  });

  it("answers the same when no link was outstanding", async () => {
    mocks.auth.mockResolvedValue(fresh());
    mocks.voidLinks.mockResolvedValue({ status: "voided", voided: 0 });
    await expect(voidAccountEmailRevertLinksAction(new FormData())).rejects.toThrow("redirect:/settings/security?updated=email_revert_links_voided");
  });

  it("checks CSRF before anything else", async () => {
    mocks.security.mockRejectedValue(new Error("csrf"));
    await expect(voidAccountEmailRevertLinksAction(new FormData())).rejects.toThrow("csrf");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.voidLinks).not.toHaveBeenCalled();
  });

  it("refuses an account without MFA and points it to support instead of enrolment", async () => {
    await expect(voidAccountEmailRevertLinksAction(new FormData())).rejects.toThrow("redirect:/settings/security?error=email_revert_void_mfa_required");
    mocks.auth.mockResolvedValue(signedIn({ platformRole: "platform_admin" }));
    await expect(voidAccountEmailRevertLinksAction(new FormData())).rejects.toThrow("redirect:/settings/security?error=email_revert_void_mfa_required");
    expect(mocks.voidLinks).not.toHaveBeenCalled();
  });

  it("requires a recent MFA step-up", async () => {
    for (const mfaVerifiedAt of [null, new Date(Date.now() - 60 * 60_000)]) {
      mocks.auth.mockResolvedValue(signedIn({ mfaFactor: { id: "factor-1" }, mfaVerifiedAt }));
      await expect(voidAccountEmailRevertLinksAction(new FormData())).rejects.toThrow("redirect:/mfa/verify?reason=step_up&next=%2Fsettings%2Fsecurity");
    }
    expect(mocks.voidLinks).not.toHaveBeenCalled();
  });

  it("fails closed when the session or factor changed meanwhile, or the database is unavailable", async () => {
    mocks.auth.mockResolvedValue(fresh());
    mocks.voidLinks.mockResolvedValue({ status: "stale", voided: 0 });
    await expect(voidAccountEmailRevertLinksAction(new FormData())).rejects.toThrow("redirect:/settings/security?error=email_revert_void_unavailable");
    mocks.voidLinks.mockRejectedValue(new Error("database down"));
    await expect(voidAccountEmailRevertLinksAction(new FormData())).rejects.toThrow("redirect:/settings/security?error=email_revert_void_unavailable");
  });
});