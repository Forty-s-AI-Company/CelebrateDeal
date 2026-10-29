import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  security: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  release: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (path: string): never => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/audit", () => ({ requestAuditMeta: async () => ({ ipAddress: "203.0.113.9", userAgent: "synthetic-agent" }) }));
vi.mock("@/lib/account-security-hold", () => ({ ACCOUNT_SECURITY_HOLDS_PATH: "/admin/account-holds", releaseAccountSecurityHold: mocks.release }));

import { releaseAccountSecurityHoldAction } from "./account-security-hold-actions";

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
