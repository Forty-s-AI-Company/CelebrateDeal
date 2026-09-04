import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createWp4PreviewOwnerSession } from "./wp4-preview-owner-session";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixture } from "./wp4-sandbox-fixture";

const db = new PrismaClient();
let ownsFixture = false;

beforeAll(async () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40));
  vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "");
  vi.stubEnv("CSRF_SECRET", "wp4-session-disposable-synthetic-key-material-only");
  vi.stubEnv("JOB_SECRET", "");
  // Never take ownership of a fixture left by another test or an operator.
  const existing = await Promise.all([
    db.vendor.findUnique({ where: { id: fixture.vendorId }, select: { id: true } }),
    db.user.findUnique({ where: { id: fixture.userId }, select: { id: true } }),
    db.billingPlan.findUnique({ where: { id: fixture.planId }, select: { id: true } }),
  ]);
  if (existing.some(Boolean)) throw new Error("WP4_SESSION_TEST_FIXTURE_EXISTS");
  await ensureWp4SandboxFixture(db);
  ownsFixture = true;
});

afterAll(async () => {
  try {
    if (ownsFixture) {
      await db.userSession.deleteMany({ where: { userId: fixture.userId, vendorId: fixture.vendorId } });
      await db.vendor.delete({ where: { id: fixture.vendorId } });
      await db.user.delete({ where: { id: fixture.userId } });
      await db.billingPlan.delete({ where: { id: fixture.planId } });
    }
  } finally {
    vi.unstubAllEnvs();
    await db.$disconnect();
  }
});

it("prepares the fixed owner factor and verified short-lived session without replacing enrollment", async () => {
  await createWp4PreviewOwnerSession(db);
  // Read only enrollment/session state, never the encrypted secret or token hash.
  const factor = await db.userMfaFactor.findUniqueOrThrow({
    where: { userId: fixture.userId }, select: { id: true, factorType: true, updatedAt: true },
  });
  expect(factor.factorType).toBe("totp");
  const session = await db.userSession.findFirstOrThrow({
    where: { userId: fixture.userId, vendorId: fixture.vendorId },
    select: { mfaVerifiedAt: true, expiresAt: true },
  });
  expect(session.mfaVerifiedAt).not.toBeNull();
  expect(session.expiresAt.getTime() - session.mfaVerifiedAt!.getTime()).toBe(15 * 60 * 1000);
  await createWp4PreviewOwnerSession(db);
  expect(await db.userMfaFactor.findUniqueOrThrow({
    where: { userId: fixture.userId }, select: { id: true, factorType: true, updatedAt: true },
  })).toEqual(factor);
  expect(await db.userMfaFactor.count({ where: { userId: fixture.userId } })).toBe(1);
  expect(await db.userSession.count({ where: { userId: fixture.userId, vendorId: fixture.vendorId } })).toBe(2);
});
