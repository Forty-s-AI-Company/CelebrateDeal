import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  cookies: vi.fn(),
  requireAuth: vi.fn(),
  markCurrentSessionMfaVerified: vi.fn(),
  writeAuditLog: vi.fn(),
  getDb: vi.fn(),
  parsePendingMfaSetup: vi.fn(),
  verifyTotpCode: vi.fn(),
  generateTotpSecret: vi.fn(),
  generateRecoveryCodes: vi.fn(),
  hashRecoveryCodeAsync: vi.fn(),
  encryptMfaSecret: vi.fn(),
  serializePendingMfaSetup: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth", () => ({
  markCurrentSessionMfaVerified: mocks.markCurrentSessionMfaVerified,
  requireAuth: mocks.requireAuth,
}));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/mfa", () => ({
  encryptMfaSecret: mocks.encryptMfaSecret,
  generateTotpSecret: mocks.generateTotpSecret,
  generateRecoveryCodes: mocks.generateRecoveryCodes,
  hashRecoveryCodeAsync: mocks.hashRecoveryCodeAsync,
  MFA_RECOVERY_COOKIE: "mfa_recovery_codes",
  MFA_SETUP_COOKIE: "mfa_setup",
  parsePendingMfaSetup: mocks.parsePendingMfaSetup,
  serializePendingMfaSetup: mocks.serializePendingMfaSetup,
  serializeRecoveryCodes: vi.fn((codes: string[]) => JSON.stringify(codes)),
  verifyTotpCode: mocks.verifyTotpCode,
}));

import { completeMfaEnrollment, startMfaEnrollment } from "./mfa-enrollment";

describe("completeMfaEnrollment", () => {
  const cookieStore = {
    delete: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  const database = {
    $transaction: vi.fn(),
    userMfaFactor: { upsert: vi.fn() },
    userRecoveryCode: { deleteMany: vi.fn(), createMany: vi.fn() },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.assertServerActionSecurity.mockResolvedValue(undefined);
    mocks.cookies.mockResolvedValue(cookieStore);
    mocks.requireAuth.mockResolvedValue({
      user: { id: "owner-1", mfaFactor: null },
      vendor: { id: "vendor-1" },
      member: { role: "owner" },
      isPlatformAdmin: false,
    });
    mocks.parsePendingMfaSetup.mockReturnValue({ userId: "owner-1", secret: "synthetic-totp-secret" });
    mocks.generateTotpSecret.mockReturnValue("new-synthetic-totp-secret");
    mocks.serializePendingMfaSetup.mockReturnValue("serialized-pending-cookie");
    mocks.verifyTotpCode.mockReturnValue(true);
    mocks.generateRecoveryCodes.mockReturnValue(["recovery-1", "recovery-2"]);
    mocks.hashRecoveryCodeAsync.mockImplementation(async (code: string) => `hash:${code}`);
    mocks.encryptMfaSecret.mockReturnValue("encrypted-secret");
    mocks.markCurrentSessionMfaVerified.mockResolvedValue(undefined);
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.getDb.mockReturnValue(database);
    database.$transaction.mockResolvedValue([]);
    cookieStore.get.mockReturnValue({ value: "synthetic-pending-cookie" });
  });

  it("returns a bounded success path after committing MFA state", async () => {
    const result = await completeMfaEnrollment(new FormData());

    expect(result).toEqual({ ok: true, destination: "/settings/security" });
    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(cookieStore.delete).toHaveBeenCalledWith("mfa_setup");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "mfa_recovery_codes",
      JSON.stringify(["recovery-1", "recovery-2"]),
      expect.any(Object),
    );
    expect(mocks.markCurrentSessionMfaVerified).toHaveBeenCalledOnce();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa_enabled" }));
  });

  it("starts owner enrollment through the shared security and cookie transition", async () => {
    const result = await startMfaEnrollment(new FormData());

    expect(result).toEqual({ destination: "/settings/security", updated: "mfa_started" });
    expect(mocks.generateTotpSecret).toHaveBeenCalledOnce();
    expect(mocks.serializePendingMfaSetup).toHaveBeenCalledWith("new-synthetic-totp-secret", "owner-1");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "mfa_setup",
      "serialized-pending-cookie",
      expect.any(Object),
    );
    expect(cookieStore.delete).toHaveBeenCalledWith("mfa_recovery_codes");
  });

  it("does not replace an existing factor and returns a bounded state", async () => {
    mocks.requireAuth.mockResolvedValue({
      user: { id: "owner-1", mfaFactor: { id: "factor-1" } },
      vendor: { id: "vendor-1" },
      member: { role: "owner" },
      isPlatformAdmin: false,
    });

    const result = await startMfaEnrollment(new FormData());

    expect(result).toEqual({ destination: "/settings/security", updated: "mfa_exists" });
    expect(mocks.generateTotpSecret).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("returns an error without mutating MFA state for an invalid code", async () => {
    mocks.verifyTotpCode.mockReturnValue(false);

    const result = await completeMfaEnrollment(new FormData());

    expect(result).toEqual({ ok: false, destination: "/settings/security", error: "mfa_code" });
    expect(database.$transaction).not.toHaveBeenCalled();
    expect(cookieStore.delete).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
    expect(mocks.markCurrentSessionMfaVerified).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
