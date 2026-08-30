import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  markCurrentSessionMfaVerified: vi.fn(),
  requireAuth: vi.fn(),
  writeAuditLog: vi.fn(),
  checkRateLimit: vi.fn(),
  decryptMfaSecret: vi.fn(),
  verifyRecoveryCodeAsync: vi.fn(),
  verifyTotpCode: vi.fn(),
}));

let database: PrismaClient;
let readBarrier: (() => void) | undefined;
let readBarrierPromise: Promise<void> | undefined;
let rejectReadBarrier: ((reason?: unknown) => void) | undefined;
let readBarrierTimeout: ReturnType<typeof setTimeout> | undefined;
let recoveryCodeReads = 0;

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE: "test-session",
  LEGACY_VENDOR_COOKIE: "test-vendor",
  authenticateUser: vi.fn(),
  createUserSession: vi.fn(),
  markCurrentSessionMfaVerified: mocks.markCurrentSessionMfaVerified,
  requireAuth: mocks.requireAuth,
  requireFinanceAdmin: vi.fn(),
  requireVendorManager: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  revokeCurrentSession: vi.fn(),
  sessionCookieOptions: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://wp17.invalid" }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/mfa", () => ({
  decryptMfaSecret: mocks.decryptMfaSecret,
  encryptMfaSecret: vi.fn(),
  generateRecoveryCodes: vi.fn(),
  generateTotpSecret: vi.fn(),
  hashRecoveryCodeAsync: vi.fn(),
  MFA_RECOVERY_COOKIE: "mfa_recovery",
  MFA_SETUP_COOKIE: "mfa_setup",
  parsePendingMfaSetup: vi.fn(),
  serializePendingMfaSetup: vi.fn(),
  serializeRecoveryCodes: vi.fn(),
  verifyRecoveryCodeAsync: mocks.verifyRecoveryCodeAsync,
  verifyTotpCode: mocks.verifyTotpCode,
}));
vi.mock("@/lib/db", () => ({
  // The recovery-code delegate remains a real Prisma/PostgreSQL delegate. Only
  // findMany is wrapped to prove both Server Actions read before either claim.
  getDb: () => ({
    userRecoveryCode: {
      findMany: async (...args: Parameters<PrismaClient["userRecoveryCode"]["findMany"]>) => {
        const rows = await database.userRecoveryCode.findMany(...args);
        recoveryCodeReads += 1;
        if (recoveryCodeReads === 2) {
          if (readBarrierTimeout) clearTimeout(readBarrierTimeout);
          readBarrier?.();
        }
        await readBarrierPromise;
        return rows;
      },
      updateMany: database.userRecoveryCode.updateMany.bind(database.userRecoveryCode),
    },
  }),
}));

import { verifyMfaAction } from "./actions";

const createdUserIds: string[] = [];

function mfaFormData() {
  const formData = new FormData();
  formData.set("code", "wp17-synthetic-recovery-code");
  formData.set("next", "/admin/billing/dashboard");
  return formData;
}

function getRedirectUrl(result: PromiseSettledResult<unknown>) {
  expect(result.status).toBe("rejected");
  const reason = (result as PromiseRejectedResult).reason;
  expect(reason).toBeInstanceOf(Error);
  return (reason as Error).message.replace(/^redirect:/, "");
}

describe("verifyMfaAction recovery-code PostgreSQL conditional claim", () => {
  beforeAll(() => {
    expect(process.env.WP17_DISPOSABLE_SCHEMA).toMatch(/^wp17_[a-z0-9_]+$/);
    database = new PrismaClient({ log: [] });
  });

  afterEach(async () => {
    if (createdUserIds.length > 0) {
      await database.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } });
    }
    vi.clearAllMocks();
    if (readBarrierTimeout) clearTimeout(readBarrierTimeout);
    readBarrier = undefined;
    readBarrierPromise = undefined;
    rejectReadBarrier = undefined;
    readBarrierTimeout = undefined;
    recoveryCodeReads = 0;
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it("allows exactly one of two readers to consume the same recovery code", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await database.user.create({
      data: {
        email: `wp17-mfa-${suffix}@invalid.test`,
        name: "WP17 Synthetic MFA User",
        passwordHash: "synthetic-password-hash",
      },
    });
    createdUserIds.push(user.id);
    const factor = await database.userMfaFactor.create({
      data: { userId: user.id, factorType: "totp", secretEncrypted: "synthetic-secret" },
    });
    const recoveryCode = await database.userRecoveryCode.create({
      data: { userId: user.id, codeHash: "synthetic-recovery-hash" },
    });

    mocks.requireAuth.mockResolvedValue({
      user: { id: user.id, mfaFactor: factor, platformRole: "admin" },
      vendor: null,
      member: null,
    });
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.decryptMfaSecret.mockReturnValue("synthetic-totp-secret");
    mocks.verifyTotpCode.mockReturnValue(false);
    mocks.verifyRecoveryCodeAsync.mockResolvedValue(true);
    mocks.markCurrentSessionMfaVerified.mockResolvedValue(undefined);
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.assertServerActionSecurity.mockResolvedValue(undefined);

    readBarrierPromise = new Promise<void>((resolve, reject) => {
      readBarrier = resolve;
      rejectReadBarrier = reject;
    });
    // A separate fail-fast timer makes a broken second reader fail cleanly
    // instead of leaving either Server Action waiting for the test timeout.
    readBarrierTimeout = setTimeout(() => {
      rejectReadBarrier?.(new Error("WP-17 recovery-code read barrier timed out"));
    }, 2_000);
    const outcomes = await Promise.allSettled([verifyMfaAction(mfaFormData()), verifyMfaAction(mfaFormData())]);

    // A real barrier makes this an actual claim race, not merely two serial reads.
    expect(recoveryCodeReads).toBe(2);
    expect(outcomes.map(getRedirectUrl).sort()).toEqual([
      "/admin/billing/dashboard",
      "/mfa/verify?error=invalid&next=%2Fadmin%2Fbilling%2Fdashboard",
    ]);
    expect(mocks.markCurrentSessionMfaVerified).toHaveBeenCalledTimes(1);
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(2);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa_verify_failed" }));

    const claimedCode = await database.userRecoveryCode.findUniqueOrThrow({ where: { id: recoveryCode.id } });
    expect(claimedCode.usedAt).toBeInstanceOf(Date);
    expect(await database.userRecoveryCode.count({ where: { userId: user.id, usedAt: { not: null } } })).toBe(1);
  }, 15_000);
});
