import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";

const mocks = vi.hoisted(() => ({ sendPasswordResetEmail: vi.fn() }));

vi.mock("@/lib/email", () => ({ sendPasswordResetEmail: mocks.sendPasswordResetEmail }));

import { consumePasswordResetToken, createPasswordResetToken, sendPasswordResetLink } from "@/lib/password-reset";

const createdUserIds: string[] = [];

afterEach(async () => {
  await getDb().user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } });
  vi.clearAllMocks();
});

describe("password reset flow", () => {
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

  it("revokes a newly created token when email delivery fails", async () => {
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
  });
});
