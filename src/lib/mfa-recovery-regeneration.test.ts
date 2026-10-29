import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireAuth: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
  getDb: vi.fn(),
  writeAuditLog: vi.fn(),
  checkRateLimit: vi.fn(),
  checkAccountRateLimit: vi.fn(),
  verifyTotpCode: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/account-rate-limit", () => ({ checkAccountRateLimit: mocks.checkAccountRateLimit }));
vi.mock("@/lib/mfa", () => ({
  decryptMfaSecret: () => "synthetic-secret",
  generateRecoveryCodes: () => ["recovery-1", "recovery-2"],
  hashRecoveryCodeAsync: async (code: string) => `hash:${code}`,
  MFA_RECOVERY_COOKIE: "mfa_recovery_codes",
  serializeRecoveryCodes: (codes: string[]) => JSON.stringify(codes),
  verifyTotpCode: mocks.verifyTotpCode,
}));

import { regenerateMfaRecoveryCodes } from "./mfa-recovery-regeneration";

const cookieStore = { set: vi.fn() };
const tx = {
  $queryRaw: vi.fn(),
  userSession: { findFirst: vi.fn() },
  userRecoveryCode: { deleteMany: vi.fn(), createMany: vi.fn() },
  userMfaFactor: { updateMany: vi.fn() },
};
const database = {
  $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
};

function actor(overrides: Record<string, unknown>) {
  return { user: { id: "user-1", platformRole: "none", mfaFactor: { id: "factor-1", secretEncrypted: "encrypted" } }, session: { id: "session-1" }, vendor: null, member: null, isPlatformAdmin: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.cookies.mockResolvedValue(cookieStore);
  mocks.headers.mockResolvedValue(new Headers());
  mocks.getDb.mockReturnValue(database);
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.checkAccountRateLimit.mockResolvedValue(null);
  mocks.verifyTotpCode.mockReturnValue(true);
  tx.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
  tx.userSession.findFirst.mockResolvedValue({ id: "session-1" });
  tx.userMfaFactor.updateMany.mockResolvedValue({ count: 1 });
});

describe("regenerateMfaRecoveryCodes destination", () => {
  it.each([
    ["a merchant member", actor({ vendor: { id: "vendor-1" }, member: { role: "owner" } }), "/settings/security"],
    ["a platform administrator", actor({ isPlatformAdmin: true }), "/mfa/setup"],
    // Partners never open /settings/security; the new codes must stay visible.
    ["a partner-only account", actor({ partnerPortalOnly: true }), "/mfa/setup"],
  ])("returns %s to the page that shows the new codes", async (_label, auth, destination) => {
    mocks.requireAuth.mockResolvedValue(auth);

    await expect(regenerateMfaRecoveryCodes(new FormData())).resolves.toEqual({ ok: true, destination });
    expect(cookieStore.set).toHaveBeenCalledWith("mfa_recovery_codes", JSON.stringify(["recovery-1", "recovery-2"]), expect.any(Object));
  });

  it("keeps a partner on the setup page for every failure as well", async () => {
    mocks.requireAuth.mockResolvedValue(actor({ partnerPortalOnly: true }));
    mocks.verifyTotpCode.mockReturnValue(false);
    await expect(regenerateMfaRecoveryCodes(new FormData())).resolves.toEqual({ ok: false, destination: "/mfa/setup", error: "mfa_code" });

    mocks.requireAuth.mockResolvedValue(actor({ partnerPortalOnly: true, user: { id: "user-1", platformRole: "none", mfaFactor: null } }));
    await expect(regenerateMfaRecoveryCodes(new FormData())).resolves.toEqual({ ok: false, destination: "/mfa/setup", error: "mfa_required" });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});

describe("regenerateMfaRecoveryCodes and a concurrent login email change revert", () => {
  it("replaces the codes only under the User row lock, for this session and this factor", async () => {
    mocks.requireAuth.mockResolvedValue(actor({ vendor: { id: "vendor-1" }, member: { role: "owner" } }));
    await expect(regenerateMfaRecoveryCodes(new FormData())).resolves.toEqual({ ok: true, destination: "/settings/security" });
    expect(String((tx.$queryRaw.mock.calls[0]![0] as TemplateStringsArray).join("?"))).toContain("FOR UPDATE");
    expect(tx.userSession.findFirst).toHaveBeenCalledWith({ where: { id: "session-1", userId: "user-1", revokedAt: null, expiresAt: { gt: expect.any(Date) } }, select: { id: true } });
    expect(tx.userMfaFactor.updateMany).toHaveBeenCalledWith({ where: { id: "factor-1", userId: "user-1" }, data: { lastUsedAt: expect.any(Date) } });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.userRecoveryCode.createMany.mock.invocationCallOrder[0]!);
  });

  it.each([
    ["the session was revoked", () => tx.userSession.findFirst.mockResolvedValue(null)],
    ["the factor was removed", () => tx.userMfaFactor.updateMany.mockResolvedValue({ count: 0 })],
    ["the account is suspended", () => tx.$queryRaw.mockResolvedValue([])],
  ])("writes no codes when %s", async (_label, arrange) => {
    mocks.requireAuth.mockResolvedValue(actor({ vendor: { id: "vendor-1" }, member: { role: "owner" } }));
    arrange();
    await expect(regenerateMfaRecoveryCodes(new FormData())).resolves.toEqual({ ok: false, destination: "/settings/security", error: "recovery_unavailable" });
    expect(tx.userRecoveryCode.createMany).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});