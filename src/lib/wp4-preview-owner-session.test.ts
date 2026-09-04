import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWp4PreviewOwnerSession, WP4_OWNER_SESSION_TTL } from "./wp4-preview-owner-session";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";

const tx = {
  vendorMember: { findFirst: vi.fn() },
  userMfaFactor: { findUnique: vi.fn(), create: vi.fn() },
  userSession: { create: vi.fn() },
};
const db = { $transaction: vi.fn(async (fn) => fn(tx)) };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40)); vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "");
  tx.vendorMember.findFirst.mockResolvedValue({ id: "fixed-owner-membership" });
  tx.userMfaFactor.findUnique.mockResolvedValue({ id: "existing-factor" });
});
afterEach(() => vi.unstubAllEnvs());

it.each([["VERCEL_ENV", "production"], ["PAYUNI_ENV", "production"],
  ["WP4_SANDBOX_EXECUTOR_ENABLED", "false"], ["VERCEL_GIT_COMMIT_SHA", "invalid"]])(
  "rejects unsafe %s without database access", async (key, value) => {
    vi.stubEnv(key, value);
    await expect(createWp4PreviewOwnerSession(db as unknown as PrismaClient)).rejects.toThrow("unavailable");
    expect(db.$transaction).not.toHaveBeenCalled();
  },
);
it("creates only a short-lived hashed session for the fixed non-admin owner", async () => {
  const result = await createWp4PreviewOwnerSession(db as unknown as PrismaClient);
  expect(tx.vendorMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    vendorId: WP4_SANDBOX_FIXTURE.vendorId, userId: WP4_SANDBOX_FIXTURE.userId,
    role: "owner", status: "active", user: expect.objectContaining({ platformRole: "none" }),
  }) }));
  const data = tx.userSession.create.mock.calls[0]?.[0].data;
  expect(data.tokenHash).toBe(createHash("sha256").update(result.token).digest("hex"));
  expect(data).not.toHaveProperty("token");
  expect(data.expiresAt.getTime() - data.mfaVerifiedAt.getTime()).toBe(WP4_OWNER_SESSION_TTL * 1000);
  expect(data.userId).toBe(WP4_SANDBOX_FIXTURE.userId);
  expect(data.vendorId).toBe(WP4_SANDBOX_FIXTURE.vendorId);
  expect(tx.userMfaFactor.findUnique).toHaveBeenCalledWith({
    where: { userId: WP4_SANDBOX_FIXTURE.userId }, select: { id: true },
  });
  expect(tx.userMfaFactor.create).not.toHaveBeenCalled();
});
it("creates an encrypted synthetic TOTP factor only when the fixed owner lacks one", async () => {
  tx.userMfaFactor.findUnique.mockResolvedValue(null);
  vi.stubEnv("JOB_SECRET", "test-job-secret-long-enough-for-encryption");

  await createWp4PreviewOwnerSession(db as unknown as PrismaClient);

  expect(tx.userMfaFactor.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    userId: WP4_SANDBOX_FIXTURE.userId,
    factorType: "totp",
    label: "WP4 synthetic owner",
  }) });
  const factor = tx.userMfaFactor.create.mock.calls[0]?.[0].data;
  expect(factor.secretEncrypted).toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);
  expect(factor.secretEncrypted).not.toMatch(/[A-Z2-7]{16,}/u);
  expect(tx.userSession.create).toHaveBeenCalledOnce();
});
it("fails closed when synthetic factor encryption is unavailable", async () => {
  tx.userMfaFactor.findUnique.mockResolvedValue(null);
  vi.stubEnv("JOB_SECRET", undefined);
  vi.stubEnv("CSRF_SECRET", undefined);

  await expect(createWp4PreviewOwnerSession(db as unknown as PrismaClient)).rejects.toThrow("encryption key");
  expect(tx.userMfaFactor.create).not.toHaveBeenCalled();
  expect(tx.userSession.create).not.toHaveBeenCalled();
});
it("fails closed on factor lookup errors before creating a session", async () => {
  tx.userMfaFactor.findUnique.mockRejectedValue(new Error("synthetic factor lookup failure"));

  await expect(createWp4PreviewOwnerSession(db as unknown as PrismaClient)).rejects.toThrow("synthetic factor lookup failure");
  expect(tx.userMfaFactor.create).not.toHaveBeenCalled();
  expect(tx.userSession.create).not.toHaveBeenCalled();
});
it("rejects missing or inactive synthetic ownership without creating a session", async () => {
  tx.vendorMember.findFirst.mockResolvedValue(null);
  await expect(createWp4PreviewOwnerSession(db as unknown as PrismaClient)).rejects.toThrow("unavailable");
  expect(tx.userSession.create).not.toHaveBeenCalled();
  expect(tx.userMfaFactor.findUnique).not.toHaveBeenCalled();
  expect(tx.userMfaFactor.create).not.toHaveBeenCalled();
});
