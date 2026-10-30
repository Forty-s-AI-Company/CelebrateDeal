import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  security: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  release: vi.fn(),
  remove: vi.fn(),
  find: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/audit", () => ({ requestAuditMeta: async () => ({ ipAddress: "203.0.113.9", userAgent: "synthetic-agent" }) }));
vi.mock("@/lib/account-security-hold", async (importOriginal) => ({
  ACCOUNT_SECURITY_HOLDS_PATH: "/admin/account-holds",
  normalizeMfaRemovalReason: (await importOriginal<typeof import("@/lib/account-security-hold")>()).normalizeMfaRemovalReason,
  releaseAccountSecurityHold: mocks.release,
  removeAccountMfaBySupport: mocks.remove,
  findAccountIdByLoginEmail: mocks.find,
}));

import { lookupAccountForMfaRemovalAction, releaseAccountSecurityHoldAction, removeAccountMfaAction } from "./account-security-hold-actions";

function admin(mfaVerifiedAt: Date | null = new Date()) {
  return { user: { id: "admin-1", mfaFactor: { id: "factor-admin" } }, session: { id: "session-admin", mfaVerifiedAt } };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue(admin());
  mocks.release.mockResolvedValue({ status: "released" });
  mocks.remove.mockResolvedValue({ status: "removed" });
  mocks.find.mockResolvedValue("user-1");
});

describe("releaseAccountSecurityHoldAction", () => {
  it("releases the named account as the signed-in platform admin, removing the factor only when asked", async () => {
    await expect(releaseAccountSecurityHoldAction(form({ userId: "user-1" }))).rejects.toThrow("redirect:/admin/account-holds?released=1");
    expect(mocks.release).toHaveBeenCalledWith({ userId: "user-1", actorId: "admin-1", removeMfaFactor: false, ipAddress: "203.0.113.9", userAgent: "synthetic-agent" });
    await expect(releaseAccountSecurityHoldAction(form({ userId: "user-1", removeMfaFactor: "on", actorId: "forged" }))).rejects.toThrow("redirect:/admin/account-holds?released=1");
    expect(mocks.release).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: "admin-1", removeMfaFactor: true }));
  });

  it("checks CSRF and the platform-admin guard before anything else", async () => {
    mocks.security.mockRejectedValue(new Error("csrf"));
    await expect(releaseAccountSecurityHoldAction(form({ userId: "user-1" }))).rejects.toThrow("csrf");
    expect(mocks.requireFinanceAdmin).not.toHaveBeenCalled();
    mocks.security.mockResolvedValue(undefined);
    mocks.requireFinanceAdmin.mockRejectedValue(new Error("redirect:/dashboard"));
    await expect(releaseAccountSecurityHoldAction(form({ userId: "user-1" }))).rejects.toThrow("redirect:/dashboard");
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("requires a recent MFA step-up", async () => {
    mocks.requireFinanceAdmin.mockResolvedValue(admin(new Date(Date.now() - 60 * 60_000)));
    await expect(releaseAccountSecurityHoldAction(form({ userId: "user-1" }))).rejects.toThrow("redirect:/mfa/verify?reason=step_up&next=%2Fadmin%2Faccount-holds");
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("refuses malformed ids and reports an account that is not on hold", async () => {
    await expect(releaseAccountSecurityHoldAction(form({ userId: "../../x" }))).rejects.toThrow("redirect:/admin/account-holds?error=not_held");
    expect(mocks.release).not.toHaveBeenCalled();
    mocks.release.mockResolvedValue({ status: "not_held" });
    await expect(releaseAccountSecurityHoldAction(form({ userId: "user-2" }))).rejects.toThrow("redirect:/admin/account-holds?error=not_held");
  });
});

const REASON = "Owner verified by phone callback; lost authenticator device.";

function removal(fields: Record<string, string> = {}) {
  return form({ userId: "user-1", confirmation: "o***@example.test", reason: REASON, ...fields });
}

describe("removeAccountMfaAction", () => {
  it("removes MFA from the named account as the signed-in platform admin, passing the confirmation and trimmed reason", async () => {
    await expect(removeAccountMfaAction(removal({ reason: `  ${REASON}  `, actorId: "forged" }))).rejects.toThrow("redirect:/admin/account-holds?mfaRemoved=1#mfa-removal");
    expect(mocks.remove).toHaveBeenCalledWith({
      userId: "user-1",
      actorId: "admin-1",
      confirmation: "o***@example.test",
      reason: REASON,
      ipAddress: "203.0.113.9",
      userAgent: "synthetic-agent",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/account-holds");
  });

  it("checks CSRF, then the platform-admin guard, before reading the form", async () => {
    mocks.security.mockRejectedValue(new Error("csrf"));
    await expect(removeAccountMfaAction(removal())).rejects.toThrow("csrf");
    expect(mocks.requireFinanceAdmin).not.toHaveBeenCalled();
    mocks.security.mockResolvedValue(undefined);
    // A merchant owner (not a platform admin) is sent away by the guard.
    mocks.requireFinanceAdmin.mockRejectedValue(new Error("redirect:/dashboard"));
    await expect(removeAccountMfaAction(removal())).rejects.toThrow("redirect:/dashboard");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("requires a recent MFA step-up", async () => {
    mocks.requireFinanceAdmin.mockResolvedValue(admin(new Date(Date.now() - 60 * 60_000)));
    await expect(removeAccountMfaAction(removal())).rejects.toThrow("redirect:/mfa/verify?reason=step_up&next=%2Fadmin%2Faccount-holds");
    mocks.requireFinanceAdmin.mockResolvedValue(admin(null));
    await expect(removeAccountMfaAction(removal())).rejects.toThrow("redirect:/mfa/verify?reason=step_up");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("refuses the admin's own account", async () => {
    await expect(removeAccountMfaAction(removal({ userId: "admin-1" }))).rejects.toThrow("redirect:/admin/account-holds?mfaUser=admin-1&mfaError=self#mfa-removal");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", { reason: "" }],
    ["blank", { reason: "     " }],
    ["too short", { reason: "too short" }],
    ["too long", { reason: "x".repeat(501) }],
  ])("refuses a %s reason", async (_label, fields) => {
    await expect(removeAccountMfaAction(removal(fields))).rejects.toThrow("redirect:/admin/account-holds?mfaUser=user-1&mfaError=invalid_reason#mfa-removal");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("refuses a missing confirmation and reports a wrong one from the database check", async () => {
    await expect(removeAccountMfaAction(removal({ confirmation: "  " }))).rejects.toThrow("redirect:/admin/account-holds?mfaUser=user-1&mfaError=confirmation_mismatch#mfa-removal");
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.remove.mockResolvedValue({ status: "confirmation_mismatch" });
    await expect(removeAccountMfaAction(removal({ confirmation: "x***@example.test" }))).rejects.toThrow("redirect:/admin/account-holds?mfaUser=user-1&mfaError=confirmation_mismatch#mfa-removal");
  });

  it.each(["not_found", "not_active", "self", "nothing_to_remove"] as const)("reports %s from the database check", async (status) => {
    mocks.remove.mockResolvedValue({ status });
    await expect(removeAccountMfaAction(removal())).rejects.toThrow(`redirect:/admin/account-holds?mfaUser=user-1&mfaError=${status}#mfa-removal`);
  });

  it("refuses malformed ids", async () => {
    await expect(removeAccountMfaAction(removal({ userId: "../../x" }))).rejects.toThrow("redirect:/admin/account-holds?mfaError=not_found#mfa-removal");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe("lookupAccountForMfaRemovalAction", () => {
  it("finds the account by email and puts only its id in the URL", async () => {
    await expect(lookupAccountForMfaRemovalAction(form({ email: "owner@example.test" }))).rejects.toThrow("redirect:/admin/account-holds?mfaUser=user-1#mfa-removal");
    expect(mocks.find).toHaveBeenCalledWith("owner@example.test");
    mocks.find.mockResolvedValue(null);
    await expect(lookupAccountForMfaRemovalAction(form({ email: "nobody@example.test" }))).rejects.toThrow("redirect:/admin/account-holds?mfaError=not_found#mfa-removal");
  });

  it("is guarded like the removal itself", async () => {
    mocks.security.mockRejectedValue(new Error("csrf"));
    await expect(lookupAccountForMfaRemovalAction(form({ email: "owner@example.test" }))).rejects.toThrow("csrf");
    mocks.security.mockResolvedValue(undefined);
    mocks.requireFinanceAdmin.mockRejectedValue(new Error("redirect:/dashboard"));
    await expect(lookupAccountForMfaRemovalAction(form({ email: "owner@example.test" }))).rejects.toThrow("redirect:/dashboard");
    mocks.requireFinanceAdmin.mockResolvedValue(admin(null));
    await expect(lookupAccountForMfaRemovalAction(form({ email: "owner@example.test" }))).rejects.toThrow("redirect:/mfa/verify?reason=step_up");
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
