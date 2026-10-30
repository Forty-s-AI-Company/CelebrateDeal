import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACCOUNT_MFA_REMOVED_AUDIT_ACTION,
  ACCOUNT_SECURITY_HOLD_STATUS,
  describeAccountForMfaRemoval,
  findAccountIdByLoginEmail,
  removeAccountMfaBySupport,
} from "@/lib/account-security-hold";
import { getDb } from "@/lib/db";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";

/**
 * Support MFA removal against PostgreSQL: only an active account other than
 * the admin's own, only with the masked address retyped and a reason, and
 * then the factor, every recovery code and every session go in one
 * transaction with an audit entry. Synthetic data only.
 */
const createdUserIds: string[] = [];
const REASON = "Owner verified by phone callback; lost authenticator device.";

async function createUser(data: { status?: string; platformRole?: string } = {}) {
  const user = await getDb().user.create({
    data: { name: "Synthetic account", email: `mfa-support-${randomUUID()}@example.test`, passwordHash: "synthetic-only", ...data },
  });
  createdUserIds.push(user.id);
  return user;
}

async function withMfa(userId: string, codes = 2) {
  const factor = await getDb().userMfaFactor.create({ data: { userId, secretEncrypted: "synthetic-support-secret" } });
  if (codes > 0) await getDb().userRecoveryCode.createMany({ data: Array.from({ length: codes }, (_, index) => ({ userId, codeHash: `synthetic-support-code-${index}` })) });
  return factor;
}

async function createSession(userId: string) {
  return getDb().userSession.create({ data: { userId, tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60_000) } });
}

afterEach(async () => {
  const ids = createdUserIds.splice(0);
  await getDb().auditLog.deleteMany({ where: { OR: [{ targetId: { in: ids } }, { actorId: { in: ids } }] } });
  // Factors, codes and sessions cascade with the user.
  await getDb().user.deleteMany({ where: { id: { in: ids } } });
});

describe("support MFA removal (PostgreSQL)", () => {
  it("removes the factor and every recovery code, ends every session and audits the admin's reason", async () => {
    const admin = await createUser({ platformRole: "platform_admin" });
    const user = await createUser();
    await withMfa(user.id, 3);
    const sessions = [await createSession(user.id), await createSession(user.id)];
    const bystander = await createUser();
    await withMfa(bystander.id, 1);
    const bystanderSession = await createSession(bystander.id);

    await expect(removeAccountMfaBySupport({
      userId: user.id,
      actorId: admin.id,
      confirmation: `  ${maskEmailRecipient(user.email).toUpperCase()} `,
      reason: `  ${REASON}  `,
      ipAddress: "203.0.113.7",
      userAgent: "synthetic-agent",
    })).resolves.toEqual({ status: "removed" });

    expect(await getDb().userMfaFactor.count({ where: { userId: user.id } })).toBe(0);
    expect(await getDb().userRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    for (const session of sessions) expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeInstanceOf(Date);
    // The account stays active with its password; only MFA goes.
    expect(await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ status: "active", passwordHash: "synthetic-only", email: user.email });

    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION } });
    expect(audit).toMatchObject({ actorId: admin.id, actorLabel: "platform_admin", targetType: "User", ipAddress: "203.0.113.7", userAgent: "synthetic-agent" });
    expect(audit.after).toEqual({ reason: REASON, factorsRemoved: 1, recoveryCodesRemoved: 3, sessionsRevoked: 2, targetPlatformAdmin: false });
    expect(JSON.stringify(audit)).not.toContain(user.email);
    expect(JSON.stringify(audit)).not.toContain("synthetic-support-secret");

    // Nobody else changes.
    expect(await getDb().userMfaFactor.count({ where: { userId: bystander.id } })).toBe(1);
    expect(await getDb().userRecoveryCode.count({ where: { userId: bystander.id } })).toBe(1);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: bystanderSession.id } })).revokedAt).toBeNull();
  });

  it("refuses the admin's own account, a wrong confirmation and a missing reason, and changes nothing", async () => {
    const admin = await createUser({ platformRole: "platform_admin" });
    await withMfa(admin.id);
    const user = await createUser();
    await withMfa(user.id);
    const session = await createSession(user.id);
    const masked = maskEmailRecipient(user.email);

    await expect(removeAccountMfaBySupport({ userId: admin.id, actorId: admin.id, confirmation: maskEmailRecipient(admin.email), reason: REASON })).resolves.toEqual({ status: "self" });
    for (const confirmation of ["", "x***@example.test", user.email, user.id]) {
      await expect(removeAccountMfaBySupport({ userId: user.id, actorId: admin.id, confirmation, reason: REASON })).resolves.toEqual({ status: "confirmation_mismatch" });
    }
    for (const reason of ["", "   ", "too short", "x".repeat(501)]) {
      await expect(removeAccountMfaBySupport({ userId: user.id, actorId: admin.id, confirmation: masked, reason })).resolves.toEqual({ status: "invalid_reason" });
    }

    expect(await getDb().userMfaFactor.count({ where: { userId: { in: [admin.id, user.id] } } })).toBe(2);
    expect(await getDb().userRecoveryCode.count({ where: { userId: { in: [admin.id, user.id] } } })).toBe(4);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    expect(await getDb().auditLog.count({ where: { action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION, targetId: { in: [admin.id, user.id] } } })).toBe(0);
  });

  it("only acts on an active account that has something to remove", async () => {
    const admin = await createUser({ platformRole: "platform_admin" });
    const held = await createUser({ status: ACCOUNT_SECURITY_HOLD_STATUS });
    await withMfa(held.id);
    const suspended = await createUser({ status: "suspended" });
    await withMfa(suspended.id);
    const withoutMfa = await createUser();
    const withoutMfaSession = await createSession(withoutMfa.id);

    for (const target of [held, suspended]) {
      await expect(removeAccountMfaBySupport({ userId: target.id, actorId: admin.id, confirmation: maskEmailRecipient(target.email), reason: REASON })).resolves.toEqual({ status: "not_active" });
      expect(await getDb().userMfaFactor.count({ where: { userId: target.id } })).toBe(1);
    }
    await expect(removeAccountMfaBySupport({ userId: withoutMfa.id, actorId: admin.id, confirmation: maskEmailRecipient(withoutMfa.email), reason: REASON })).resolves.toEqual({ status: "nothing_to_remove" });
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: withoutMfaSession.id } })).revokedAt).toBeNull();
    await expect(removeAccountMfaBySupport({ userId: `missing-${randomUUID()}`, actorId: admin.id, confirmation: "a***@example.test", reason: REASON })).resolves.toEqual({ status: "not_found" });
    expect(await getDb().auditLog.count({ where: { action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION, actorId: admin.id } })).toBe(0);
  });

  it("records when the target is another platform admin", async () => {
    const admin = await createUser({ platformRole: "platform_admin" });
    const peer = await createUser({ platformRole: "platform_admin" });
    await withMfa(peer.id, 0);
    await expect(removeAccountMfaBySupport({ userId: peer.id, actorId: admin.id, confirmation: maskEmailRecipient(peer.email), reason: REASON })).resolves.toEqual({ status: "removed" });
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: peer.id, action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION } });
    expect(audit.after).toMatchObject({ factorsRemoved: 1, recoveryCodesRemoved: 0, targetPlatformAdmin: true });
  });

  it("finds an account by its normalized login email and describes it masked", async () => {
    const user = await createUser();
    await withMfa(user.id, 2);
    await expect(findAccountIdByLoginEmail(`  ${user.email.toUpperCase()} `)).resolves.toBe(user.id);
    await expect(findAccountIdByLoginEmail(`nobody-${randomUUID()}@example.test`)).resolves.toBeNull();
    for (const value of [undefined, "", "not-an-email", 42]) await expect(findAccountIdByLoginEmail(value)).resolves.toBeNull();

    const described = await describeAccountForMfaRemoval(user.id);
    expect(described).toEqual({ userId: user.id, maskedEmail: maskEmailRecipient(user.email), status: "active", hasMfaFactor: true, recoveryCodeCount: 2, isPlatformAdmin: false });
    expect(JSON.stringify(described)).not.toContain(user.email);
    await expect(describeAccountForMfaRemoval(`missing-${randomUUID()}`)).resolves.toBeNull();
  });
});
