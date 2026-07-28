import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: mocks.sendPasswordResetEmail }));
vi.mock("next/server", () => ({ after: mocks.after }));

import {
  consumePasswordResetToken,
  createPasswordResetToken,
  schedulePasswordResetLink,
  sendPasswordResetLink,
} from "@/lib/password-reset";

const createdUserIds: string[] = [];

afterEach(async () => {
  const userIds = createdUserIds.splice(0);
  // AuditLog 沒有 User foreign key；先依 synthetic actor 清除，避免 targeted
  // disposable DB 測試留下跨案例可見的 password-reset audit rows。
  if (userIds.length > 0) {
    await getDb().auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await getDb().user.deleteMany({ where: { id: { in: userIds } } });
  }
  vi.clearAllMocks();
});

describe("password reset flow", () => {
  it("defers anonymous account lookup, token creation, and delivery until after the response", async () => {
    const user = await getDb().user.create({
      data: {
        email: `reset-deferred-${Date.now()}@example.test`,
        name: "Deferred Reset User",
        passwordHash: hashPassword("old-password-123"),
      },
    });
    createdUserIds.push(user.id);
    mocks.sendPasswordResetEmail.mockResolvedValue(undefined);
    let deferredWork: (() => Promise<void>) | undefined;
    mocks.after.mockImplementationOnce((callback: () => Promise<void>) => {
      deferredWork = callback;
    });

    schedulePasswordResetLink({
      email: user.email,
      appUrl: "https://app.example.test",
    });

    expect(mocks.after).toHaveBeenCalledOnce();
    expect(await getDb().passwordResetToken.count({ where: { userId: user.id } })).toBe(0);

    await deferredWork?.();

    expect(await getDb().passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledOnce();
  });

  it("creates one active token and revokes sessions after consume", async () => {
    const user = await getDb().user.create({
      data: {
        email: `reset-${Date.now()}@example.test`,
        name: "Reset User",
        passwordHash: hashPassword("old-password-123"),
        sessions: {
          create: {
            tokenHash: `session-${Date.now()}`,
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
      },
      include: { sessions: true },
    });
    createdUserIds.push(user.id);

    const first = await createPasswordResetToken({ email: user.email });
    const second = await createPasswordResetToken({ email: user.email });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const tokens = await getDb().passwordResetToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].usedAt).not.toBeNull();
    expect(tokens[1].usedAt).toBeNull();

    const result = await consumePasswordResetToken(second!.token, "new-password-123");
    expect(result.ok).toBe(true);

    const refreshedUser = await getDb().user.findUniqueOrThrow({
      where: { id: user.id },
      include: { sessions: true, passwordResetTokens: true },
    });
    expect(refreshedUser.sessions.every((session) => session.revokedAt)).toBe(true);
    expect(refreshedUser.passwordResetTokens.some((token) => token.usedAt)).toBe(true);
  });

  it("consumes a reset token only once", async () => {
    const user = await getDb().user.create({
      data: {
        email: `reset-once-${Date.now()}@example.test`,
        name: "Reset Once User",
        passwordHash: hashPassword("old-password-123"),
      },
    });
    createdUserIds.push(user.id);

    const reset = await createPasswordResetToken({ email: user.email });
    expect(reset).not.toBeNull();

    const first = await consumePasswordResetToken(reset!.token, "first-password-123");
    const second = await consumePasswordResetToken(reset!.token, "second-password-456");

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "invalid_or_expired" });

    const consumedTokens = await getDb().passwordResetToken.count({
      where: {
        userId: user.id,
        usedAt: { not: null },
      },
    });
    expect(consumedTokens).toBe(1);
  });

  it("atomically allows only one concurrent consumer to change the password", async () => {
    const user = await getDb().user.create({
      data: {
        email: `reset-concurrent-${Date.now()}@example.test`,
        name: "Concurrent Reset User",
        passwordHash: hashPassword("old-password-123"),
      },
    });
    createdUserIds.push(user.id);

    const reset = await createPasswordResetToken({ email: user.email });
    expect(reset).not.toBeNull();

    const passwords = ["concurrent-password-a", "concurrent-password-b"];
    const results = await Promise.all(
      passwords.map((replacementPassword) => consumePasswordResetToken(reset!.token, replacementPassword)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "invalid_or_expired" },
    ]);

    const refreshedUser = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    const matchingPasswords = passwords.filter((candidate) => verifyPassword(candidate, refreshedUser.passwordHash));
    expect(matchingPasswords).toHaveLength(1);
    expect(await getDb().passwordResetToken.count({
      where: { userId: user.id, usedAt: { not: null } },
    })).toBe(1);
  });

  it("revokes a newly created token and records the failure audit contract when email delivery fails", async () => {
    const user = await getDb().user.create({
      data: {
        email: `reset-email-failure-${Date.now()}@example.test`,
        name: "Reset Email Failure User",
        passwordHash: hashPassword("old-password-123"),
      },
    });
    createdUserIds.push(user.id);
    mocks.sendPasswordResetEmail.mockRejectedValueOnce(new Error("provider failure with sensitive details"));

    await expect(sendPasswordResetLink({
      email: user.email,
      appUrl: "https://app.example.test",
    })).rejects.toThrow("provider failure");

    const tokens = await getDb().passwordResetToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.usedAt).not.toBeNull();

    const failedAudits = await getDb().auditLog.findMany({
      where: {
        actorId: user.id,
        actorLabel: "password_reset_request",
        action: "password_reset_email_failed",
        targetType: "PasswordResetToken",
        targetId: tokens[0]!.id,
        after: { path: ["email"], equals: user.email },
      },
      select: { actorId: true, actorLabel: true, action: true, targetType: true, targetId: true, after: true },
    });
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0]).toMatchObject({
      actorId: user.id,
      actorLabel: "password_reset_request",
      action: "password_reset_email_failed",
      targetType: "PasswordResetToken",
      targetId: tokens[0]!.id,
      // Token-related metadata is deliberately redacted by auditSnapshot.
      // The target token's usedAt assertion above remains the revoke proof.
      after: { email: user.email, tokenRevoked: "[redacted]" },
    });

    // The audit is diagnostic only: it must not persist the reset URL/token or
    // the provider error supplied by the mocked delivery adapter.
    const resetUrl = mocks.sendPasswordResetEmail.mock.calls[0]?.[0]?.resetUrl;
    const serializedAudit = JSON.stringify(failedAudits[0]);
    expect(serializedAudit).not.toContain("provider failure with sensitive details");
    expect(resetUrl).toBeTruthy();
    expect(serializedAudit).not.toContain(resetUrl!);
  });
});
