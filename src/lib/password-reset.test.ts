import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { consumePasswordResetToken, createPasswordResetToken } from "@/lib/password-reset";

const createdUserIds: string[] = [];

afterEach(async () => {
  await getDb().user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } });
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
});
