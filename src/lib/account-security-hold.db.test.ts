import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })),
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })),
}));

import { accountRateLimitKeyHash } from "@/lib/account-rate-limit";
import {
  ACCOUNT_MFA_REMOVAL_LOOKUP_AUDIT_ACTION,
  ACCOUNT_MFA_REMOVED_AUDIT_ACTION,
  ACCOUNT_MFA_REMOVED_NOTICE_FAILED_AUDIT_ACTION,
  ACCOUNT_SECURITY_HOLD_STATUS,
  describeAccountForMfaRemoval,
  lookupAccountForMfaRemoval,
  removeAccountMfaBySupport,
} from "@/lib/account-security-hold";
import { authenticateUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { maskEmailRecipient } from "@/lib/email-delivery-pii";
import { hashPasswordAsync, isUnusablePasswordHash } from "@/lib/password";
import { consumePasswordResetToken, sendPasswordResetLink } from "@/lib/password-reset";

/**
 * Support MFA removal against PostgreSQL: only an active account without a
 * platform role and other than the admin's own, only with the masked address
 * retyped and a reason; then the factor, every recovery code, the password
 * and every session go in one transaction with an audit entry, and a notice
 * without a link goes to the login email. Synthetic data only; the Resend
 * provider is a stubbed `fetch`.
 */
const createdUserIds: string[] = [];
const createdEmails: string[] = [];
const REASON = "Owner verified by phone callback; lost authenticator device.";
const PASSWORD = "Synthetic-Owner-Passphrase-2026";
const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
let providerFails = false;
const provider = vi.fn(async (_url: string, init: RequestInit) => {
  if (providerFails) return new Response("synthetic outage", { status: 503 });
  sent.push(JSON.parse(String(init.body)));
  return Response.json({ id: `synthetic-${sent.length}` });
});

async function createUser(data: { status?: string; platformRole?: string; passwordHash?: string } = {}) {
  const email = `mfa-support-${randomUUID()}@example.test`;
  createdEmails.push(email);
  const user = await getDb().user.create({ data: { name: "Synthetic account", email, passwordHash: "synthetic-only", ...data } });
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

function remove(target: { id: string; email: string }, actorId: string, overrides: { confirmation?: string; reason?: string } = {}) {
  return removeAccountMfaBySupport({ userId: target.id, actorId, confirmation: overrides.confirmation ?? maskEmailRecipient(target.email), reason: overrides.reason ?? REASON });
}

beforeEach(() => {
  sent.length = 0;
  providerFails = false;
  provider.mockClear();
  vi.stubEnv("CSRF_SECRET", "synthetic-account-security-hold-db-32b-key");
  vi.stubEnv("JOB_SECRET", "synthetic-account-security-hold-job");
  vi.stubEnv("RESEND_API_KEY", "synthetic-resend-key");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal <no-reply@example.test>");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubGlobal("fetch", provider);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const ids = createdUserIds.splice(0);
  const emails = createdEmails.splice(0);
  await getDb().auditLog.deleteMany({ where: { OR: [{ targetId: { in: ids } }, { actorId: { in: ids } }] } });
  await getDb().accountRateLimitBucket.deleteMany({ where: { keyHash: { in: emails.map((email) => accountRateLimitKeyHash("password_reset_request", email)) } } });
  // Factors, codes, sessions and reset tokens cascade with the user.
  await getDb().user.deleteMany({ where: { id: { in: ids } } });
});

describe("support MFA removal (PostgreSQL)", () => {
  it("removes MFA, disables the password, ends every session, audits the reason and notifies the login email without a link", async () => {
    const admin = await createUser({ platformRole: "platform_admin" });
    const user = await createUser({ passwordHash: await hashPasswordAsync(PASSWORD) });
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
    // The account stays active on the same address, but the old password no longer works.
    const after = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ status: "active", email: user.email });
    expect(isUnusablePasswordHash(after.passwordHash)).toBe(true);
    await expect(authenticateUser(user.email, PASSWORD)).resolves.toBeNull();

    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION } });
    expect(audit).toMatchObject({ actorId: admin.id, actorLabel: "platform_admin", targetType: "User", ipAddress: "203.0.113.7", userAgent: "synthetic-agent" });
    expect(audit.after).toEqual({ reason: REASON, factorsRemoved: 1, recoveryCodesRemoved: 3, sessionsRevoked: 2, loginCredentialDisabled: true });
    expect(JSON.stringify(audit)).not.toContain(user.email);
    expect(JSON.stringify(audit)).not.toContain("synthetic-support-secret");

    // One notice, to the login email, with no link.
    expect(sent.map((mail) => mail.to)).toEqual([user.email]);
    const notice = sent[0]!;
    expect(notice.text).toContain("你的兩步驟驗證已由客服移除，密碼也已停用，請使用「忘記密碼」重新設定；若不是你申請的，請立即聯絡客服");
    expect(notice.text).not.toMatch(/https?:\/\//u);
    expect(notice.html).not.toMatch(/<a\s|https?:\/\//u);
    expect(await getDb().auditLog.count({ where: { targetId: user.id, action: ACCOUNT_MFA_REMOVED_NOTICE_FAILED_AUDIT_ACTION } })).toBe(0);

    // The mailbox holder gets back in only through a password reset.
    sent.length = 0;
    await sendPasswordResetLink({ email: user.email, appUrl: "https://app.example.test" });
    const link = /\/password-reset\/confirm\?token=([A-Za-z0-9._%-]+)/u.exec(sent[0]!.text);
    expect(link).not.toBeNull();
    const newPassword = "Synthetic-Recovered-Passphrase-2026";
    await expect(consumePasswordResetToken(decodeURIComponent(link![1]!), newPassword)).resolves.toMatchObject({ ok: true });
    await expect(authenticateUser(user.email, newPassword)).resolves.toMatchObject({ user: { id: user.id } });

    // Nobody else changes.
    expect(await getDb().userMfaFactor.count({ where: { userId: bystander.id } })).toBe(1);
    expect(await getDb().userRecoveryCode.count({ where: { userId: bystander.id } })).toBe(1);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: bystanderSession.id } })).revokedAt).toBeNull();
    expect((await getDb().user.findUniqueOrThrow({ where: { id: bystander.id } })).passwordHash).toBe("synthetic-only");
  });

  it("keeps the removal and audits a notice that could not be sent", async () => {
    const admin = await createUser({ platformRole: "platform_admin" });
    const user = await createUser();
    await withMfa(user.id);
    providerFails = true;
    await expect(remove(user, admin.id)).resolves.toEqual({ status: "removed" });
    expect(await getDb().userMfaFactor.count({ where: { userId: user.id } })).toBe(0);
    const removal = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION } });
    const failed = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: ACCOUNT_MFA_REMOVED_NOTICE_FAILED_AUDIT_ACTION } });
    expect(failed).toMatchObject({ actorId: admin.id, targetType: "User" });
    expect(failed.after).toMatchObject({ removalAuditId: removal.id, errorCode: expect.any(String) });
    expect(JSON.stringify(failed)).not.toContain(user.email);
  });

  it("refuses the admin's own account, a wrong confirmation and a missing reason, and changes nothing", async () => {
    const admin = await createUser({ platformRole: "platform_admin" });
    await withMfa(admin.id);
    const user = await createUser();
    await withMfa(user.id);
    const session = await createSession(user.id);
    const masked = maskEmailRecipient(user.email);

    await expect(remove(admin, admin.id)).resolves.toEqual({ status: "self" });
    for (const confirmation of ["", "x***@example.test", user.email, user.id]) {
      await expect(remove(user, admin.id, { confirmation })).resolves.toEqual({ status: "confirmation_mismatch" });
    }
    for (const reason of ["", "   ", "too short", "x".repeat(501)]) {
      await expect(remove(user, admin.id, { confirmation: masked, reason })).resolves.toEqual({ status: "invalid_reason" });
    }

    expect(await getDb().userMfaFactor.count({ where: { userId: { in: [admin.id, user.id] } } })).toBe(2);
    expect(await getDb().userRecoveryCode.count({ where: { userId: { in: [admin.id, user.id] } } })).toBe(4);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe("synthetic-only");
    expect(await getDb().auditLog.count({ where: { action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION, targetId: { in: [admin.id, user.id] } } })).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it.each(["platform_admin", "platform_support"])("refuses an account with the platform role %s and changes nothing", async (platformRole) => {
    const admin = await createUser({ platformRole: "platform_admin" });
    const peer = await createUser({ platformRole });
    await withMfa(peer.id);
    const session = await createSession(peer.id);
    await expect(remove(peer, admin.id)).resolves.toEqual({ status: "platform_role" });
    expect(await getDb().userMfaFactor.count({ where: { userId: peer.id } })).toBe(1);
    expect(await getDb().userRecoveryCode.count({ where: { userId: peer.id } })).toBe(2);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    expect((await getDb().user.findUniqueOrThrow({ where: { id: peer.id } })).passwordHash).toBe("synthetic-only");
    expect(await getDb().auditLog.count({ where: { action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION, targetId: peer.id } })).toBe(0);
    expect(sent).toHaveLength(0);
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
      await expect(remove(target, admin.id)).resolves.toEqual({ status: "not_active" });
      expect(await getDb().userMfaFactor.count({ where: { userId: target.id } })).toBe(1);
    }
    await expect(remove(withoutMfa, admin.id)).resolves.toEqual({ status: "nothing_to_remove" });
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: withoutMfaSession.id } })).revokedAt).toBeNull();
    expect((await getDb().user.findUniqueOrThrow({ where: { id: withoutMfa.id } })).passwordHash).toBe("synthetic-only");
    await expect(removeAccountMfaBySupport({ userId: `missing-${randomUUID()}`, actorId: admin.id, confirmation: "a***@example.test", reason: REASON })).resolves.toEqual({ status: "not_found" });
    expect(await getDb().auditLog.count({ where: { action: ACCOUNT_MFA_REMOVED_AUDIT_ACTION, actorId: admin.id } })).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("finds an account by its normalized login email, audits every lookup without the address, and describes it masked", async () => {
    const admin = await createUser({ platformRole: "platform_admin" });
    const user = await createUser();
    await withMfa(user.id, 2);
    const meta = { actorId: admin.id, ipAddress: "203.0.113.7", userAgent: "synthetic-agent" };
    await expect(lookupAccountForMfaRemoval({ ...meta, email: `  ${user.email.toUpperCase()} ` })).resolves.toBe(user.id);
    const missing = `nobody-${randomUUID()}@example.test`;
    await expect(lookupAccountForMfaRemoval({ ...meta, email: missing })).resolves.toBeNull();
    for (const value of [undefined, "", "not-an-email", 42]) await expect(lookupAccountForMfaRemoval({ ...meta, email: value })).resolves.toBeNull();

    const audits = await getDb().auditLog.findMany({ where: { actorId: admin.id, action: ACCOUNT_MFA_REMOVAL_LOOKUP_AUDIT_ACTION } });
    expect(audits).toHaveLength(6);
    const found = audits.filter((audit) => audit.targetId === user.id);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ actorLabel: "platform_admin", targetType: "User", after: { result: "found" }, ipAddress: "203.0.113.7", userAgent: "synthetic-agent" });
    const notFound = audits.filter((audit) => audit.targetId === null);
    expect(notFound).toHaveLength(5);
    for (const audit of notFound) expect(audit.after).toEqual({ result: "not_found" });
    const serialized = JSON.stringify(audits).toLowerCase();
    expect(serialized).not.toContain(user.email);
    expect(serialized).not.toContain(missing);
    expect(serialized).not.toContain("not-an-email");

    const described = await describeAccountForMfaRemoval(user.id);
    expect(described).toEqual({ userId: user.id, maskedEmail: maskEmailRecipient(user.email), status: "active", hasMfaFactor: true, recoveryCodeCount: 2, isPlatformAdmin: false });
    expect(JSON.stringify(described)).not.toContain(user.email);
    await expect(describeAccountForMfaRemoval(admin.id)).resolves.toMatchObject({ isPlatformAdmin: true });
    await expect(describeAccountForMfaRemoval(`missing-${randomUUID()}`)).resolves.toBeNull();
  });
});
