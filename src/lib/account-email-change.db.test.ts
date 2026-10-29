import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

/**
 * Login email change against PostgreSQL: the request revokes older ones and
 * stores only hashes, the confirmation is single-use, bound to the request's
 * own user, re-checks uniqueness under a lock, and ends every session and
 * reset link; the revert link restores (or cancels), reserves the previous
 * address while usable, and locks further changes. Synthetic data; the
 * Resend provider is a stubbed `fetch`.
 */
const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })),
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string): never => { throw new Error(`redirect:${url}`); } }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/auth")>(), requireAuth: auth.requireAuth }));

import { updatePasswordAction } from "@/app/actions/auth-security-actions";
import { accountRateLimitKeyHash, checkAccountRateLimit, consumeAccountRateLimit } from "@/lib/account-rate-limit";
import {
  accountEmailChangeLockedUntil,
  confirmAccountEmailChange,
  describeAccountEmailChangeLink,
  describeAccountEmailRevertLink,
  processAccountEmailChangeRequest,
  revertAccountEmailChange,
} from "@/lib/account-email-change";
import { accountEmailChangeTokenHash, createAccountEmailChangeToken } from "@/lib/account-email-change-token";
import { authenticateUser } from "@/lib/auth";
import { assertLoginEmailAvailableForNewAccount, LoginEmailReservedError } from "@/lib/login-email-reservation";
import { vendorEmailVerificationState } from "@/lib/merchant-email-verification";
import { hashPasswordAsync, isUnusablePasswordHash, verifyPasswordAsync } from "@/lib/password";
import { consumePasswordResetToken, createPasswordResetToken, sendPasswordResetLink } from "@/lib/password-reset";
import { acceptVendorMemberInvitation, createVendorMemberInvitation } from "@/lib/vendor-member-invitation";

const created = { userIds: [] as string[], vendorIds: [] as string[], emails: [] as string[] };
const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
const provider = vi.fn(async (_url: string, init: RequestInit) => {
  sent.push(JSON.parse(String(init.body)));
  return Response.json({ id: `synthetic-${sent.length}` });
});
const DAY_MS = 24 * 60 * 60_000;

function syntheticEmail(prefix: string) {
  const email = `${prefix}-${randomUUID()}@example.test`;
  created.emails.push(email);
  return email;
}

async function createUser(data: { status?: string; emailVerifiedAt?: Date | null; passwordHash?: string } = {}) {
  const user = await getDb().user.create({ data: { name: "Synthetic owner", email: syntheticEmail("change"), passwordHash: "synthetic-only", ...data } });
  created.userIds.push(user.id);
  return user;
}

async function createSession(userId: string) {
  return getDb().userSession.create({ data: { userId, tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60_000) } });
}

async function createVendor(email: string) {
  const vendor = await getDb().vendor.create({ data: { name: "Synthetic vendor", slug: `change-vendor-${randomUUID()}`, email, passwordHash: "synthetic-only" } });
  created.vendorIds.push(vendor.id);
  return vendor;
}

async function createFounderVendor(owner: { id: string; email: string }, membership: { role?: string; status?: string } = {}) {
  const vendor = await createVendor(owner.email);
  await getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: membership.role ?? "owner", status: membership.status ?? "active" } });
  return vendor;
}

/** Requests a change from `sessionId`, or from a session signed in just now. */
async function request(user: { id: string; email: string }, newEmail: string, now?: Date, sessionId?: string) {
  const session = sessionId ?? (await createSession(user.id)).id;
  return processAccountEmailChangeRequest({ userId: user.id, sessionId: session, currentEmail: user.email, newEmail, actorLabel: "owner", now });
}

async function createLineIdentity(userId: string, vendorId: string) {
  return getDb().lineUserIdentity.create({
    data: { vendorId, subjectType: "user", subjectId: userId, lineUserIdHash: createHash("sha256").update(randomUUID()).digest("hex"), lineUserIdEncrypted: "v1.synthetic" },
  });
}

function linkFrom(mail: { text: string }, path: string) {
  const match = new RegExp(`${path}\\?token=([A-Za-z0-9._%-]+)`, "u").exec(mail.text);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

/** Requests a change and returns the change link (new address) and the revert link (old address). */
async function requestLinks(user: { id: string; email: string }, newEmail: string, now?: Date, sessionId?: string) {
  const before = sent.length;
  await expect(request(user, newEmail, now, sessionId)).resolves.toEqual({ outcome: "sent" });
  const mails = sent.slice(before);
  const verification = mails.find((mail) => mail.to === newEmail);
  const notice = mails.find((mail) => mail.to === user.email);
  expect(verification).toBeDefined();
  expect(notice).toBeDefined();
  return { change: linkFrom(verification!, "/verify-email-change"), revert: linkFrom(notice!, "/revert-email-change") };
}

async function requestLink(user: { id: string; email: string }, newEmail: string, now?: Date, sessionId?: string) {
  return (await requestLinks(user, newEmail, now, sessionId)).change;
}

/** Changes the user's address end to end and returns the revert link. */
async function changeEmail(user: { id: string; email: string }, newEmail: string) {
  const links = await requestLinks(user, newEmail);
  await expect(confirmAccountEmailChange(links.change)).resolves.toEqual({ status: "changed" });
  return links.revert;
}

async function usableResetTokens(userId: string) {
  return getDb().passwordResetToken.count({ where: { userId, usedAt: null, expiresAt: { gt: new Date() } } });
}

beforeEach(() => {
  sent.length = 0;
  provider.mockClear();
  auth.requireAuth.mockReset();
  // Signing secrets are stubbed here, never inherited from the shell.
  vi.stubEnv("CSRF_SECRET", "synthetic-account-email-change-db-32b-key");
  vi.stubEnv("JOB_SECRET", "synthetic-account-email-change-job");
  vi.stubEnv("RESEND_API_KEY", "synthetic-resend-key");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal <no-reply@example.test>");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubGlobal("fetch", provider);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const db = getDb();
  const emails = created.emails.splice(0);
  const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const userIds = [...new Set([...created.userIds.splice(0), ...users.map((user) => user.id)])];
  const vendorIds = created.vendorIds.splice(0);
  await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: userIds } }, { actorId: { in: userIds } }, { vendorId: { in: vendorIds } }] } });
  await db.accountRateLimitBucket.deleteMany({
    where: {
      keyHash: {
        in: [
          ...emails.map((email) => accountRateLimitKeyHash("account_email_change_recipient", email)),
          ...userIds.flatMap((id) => emails.map((email) => accountRateLimitKeyHash("account_email_change_pair", `${id}\u0000${email}`))),
          ...userIds.map((id) => accountRateLimitKeyHash("account_email_change_request", id)),
          ...emails.map((email) => accountRateLimitKeyHash("password_reset_request", email)),
        ],
      },
    },
  });
  await db.vendorMemberInvitation.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  // Requests, sessions and reset tokens cascade with the user.
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("requesting a login email change (PostgreSQL)", () => {
  it("stores only hashes, mails the change link to the new address and a masked notice with only a revert link to the old one", async () => {
    const user = await createUser();
    const newEmail = syntheticEmail("new");
    const { change, revert } = await requestLinks(user, newEmail);

    const rows = await getDb().userEmailChangeRequest.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      previousEmail: user.email,
      newEmail,
      tokenHash: accountEmailChangeTokenHash(change),
      revertTokenHash: accountEmailChangeTokenHash(revert),
      consumedAt: null,
      revokedAt: null,
      revertedAt: null,
      revertRevokedAt: null,
    });
    // Until the change completes the revert link lives as long as the request.
    expect(rows[0]!.revertExpiresAt).toEqual(rows[0]!.expiresAt);
    const lifetime = rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime();
    expect(lifetime).toBeLessThanOrEqual(60 * 60_000);
    expect(lifetime).toBeGreaterThan(60 * 60_000 - 1_000);
    for (const token of [change, revert]) expect(JSON.stringify(rows)).not.toContain(token.split(".")[2]!);

    expect(sent).toHaveLength(2);
    const [userLocal, userDomain] = user.email.split("@");
    const verification = sent.find((mail) => mail.to === newEmail)!;
    expect(verification.subject).toBe("CelebrateDeal｜請確認新的登入 Email");
    // The new address sees which account it is (masked) and is told not to confirm a stranger's.
    expect(verification.text).toContain(`${userLocal!.slice(0, 1)}***@${userDomain}`);
    expect(verification.text).toContain("若不認得此帳號請勿確認");
    expect(verification.text).not.toContain(user.email);

    const notice = sent.find((mail) => mail.to === user.email)!;
    expect(notice.subject).toBe("CelebrateDeal｜你的登入 Email 正在變更");
    const [local, domain] = newEmail.split("@");
    expect(notice.text).toContain(`你的登入 Email 正在變更為 ${local!.slice(0, 1)}***@${domain}`);
    expect(notice.text).toContain("不是我操作，還原 Email");
    for (const body of [notice.text, notice.html]) {
      expect(body).not.toContain(newEmail);
      expect(body).not.toContain("verify-email-change");
      expect(body).not.toContain(change.split(".")[1]!);
    }
    expect(await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ email: user.email, emailVerifiedAt: null });
    await expect(describeAccountEmailChangeLink(change)).resolves.toEqual({ maskedCurrentEmail: `${userLocal!.slice(0, 1)}***@${userDomain}` });
    await expect(describeAccountEmailRevertLink(revert)).resolves.toEqual({ mode: "cancel" });

    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_requested" } });
    expect(audit.after).toMatchObject({ outcome: "sent", requestId: rows[0]!.id, supersededRequests: 0, noticeSent: true });
    expect(JSON.stringify(audit)).not.toContain(newEmail);
  });

  it("does not reveal an address another account uses: no mail to it, the same notice and row shape, the old link still dies", async () => {
    const user = await createUser();
    const other = await createUser();
    const earlier = await requestLink(user, syntheticEmail("earlier"));
    sent.length = 0;

    await expect(request(user, other.email)).resolves.toEqual({ outcome: "target_unavailable" });
    expect(sent.map((mail) => mail.to)).toEqual([user.email]);
    expect(sent[0]!.subject).toBe("CelebrateDeal｜你的登入 Email 正在變更");
    const revert = linkFrom(sent[0]!, "/revert-email-change");
    const rows = await getDb().userEmailChangeRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.revokedAt !== null, row.consumedAt])).toEqual([[true, null], [false, null]]);
    // The superseded link stops working exactly as after a successful request.
    await expect(confirmAccountEmailChange(earlier)).resolves.toEqual({ status: "invalid" });
    // The notice's revert link works the same as for a free address.
    await expect(describeAccountEmailRevertLink(revert)).resolves.toEqual({ mode: "cancel" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: other.id } })).email).toBe(other.email);
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_requested", after: { path: ["outcome"], equals: "target_unavailable" } } });
    expect(JSON.stringify(audit)).not.toContain(other.email);
  });

  it("keeps one open request per user: a new request supersedes the older link", async () => {
    const user = await createUser();
    const firstEmail = syntheticEmail("first");
    const secondEmail = syntheticEmail("second");
    const first = await requestLink(user, firstEmail);
    const second = await requestLink(user, secondEmail);

    const rows = await getDb().userEmailChangeRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.newEmail, row.revokedAt !== null, row.consumedAt])).toEqual([[firstEmail, true, null], [secondEmail, false, null]]);
    await expect(confirmAccountEmailChange(first)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
    await expect(confirmAccountEmailChange(second)).resolves.toEqual({ status: "changed" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(secondEmail);
  });

  it("enforces one open request per user and the row invariants in the database itself", async () => {
    const user = await createUser();
    const now = new Date();
    const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
    const row = (email: string) => ({
      userId: user.id,
      previousEmail: user.email,
      newEmail: email,
      tokenHash: hash(),
      expiresAt: new Date(now.getTime() + 60_000),
      revertTokenHash: hash(),
      revertExpiresAt: new Date(now.getTime() + 60_000),
    });
    await getDb().userEmailChangeRequest.create({ data: row(syntheticEmail("open-a")) });
    await expect(getDb().userEmailChangeRequest.create({ data: row(syntheticEmail("open-b")) })).rejects.toMatchObject({ code: "P2002" });
    await getDb().userEmailChangeRequest.updateMany({ where: { userId: user.id }, data: { revokedAt: now } });
    // Unnormalized addresses, identical addresses and double outcomes are refused by CHECK constraints.
    await expect(getDb().userEmailChangeRequest.create({ data: row(" Upper@Example.test") })).rejects.toThrow();
    await expect(getDb().userEmailChangeRequest.create({ data: row(user.email) })).rejects.toThrow();
    await expect(getDb().userEmailChangeRequest.create({ data: { ...row(syntheticEmail("both")), consumedAt: now, revokedAt: now } })).rejects.toThrow();
    await expect(getDb().userEmailChangeRequest.create({ data: { ...row(syntheticEmail("both-revert")), revokedAt: now, revertedAt: now, revertRevokedAt: now } })).rejects.toThrow();
    // The initiating session is recorded as a pair (20261030200000).
    await expect(getDb().userEmailChangeRequest.create({ data: { ...row(syntheticEmail("session-id-only")), revokedAt: now, initiatingSessionId: "synthetic-session" } })).rejects.toThrow();
    await expect(getDb().userEmailChangeRequest.create({ data: { ...row(syntheticEmail("session-time-only")), revokedAt: now, initiatingSessionCreatedAt: now } })).rejects.toThrow();
    await expect(getDb().userEmailChangeRequest.create({ data: { ...row(syntheticEmail("session-pair")), revokedAt: now, initiatingSessionId: "synthetic-session", initiatingSessionCreatedAt: now } })).resolves.toBeTruthy();
  });

  it("limits verification mail per (account, address), so another account keeps its own allowance", async () => {
    const target = syntheticEmail("popular");
    const user = await createUser();
    for (let index = 0; index < 3; index += 1) {
      await expect(request(user, target)).resolves.toEqual({ outcome: "sent" });
    }
    sent.length = 0;
    await expect(request(user, target)).resolves.toEqual({ outcome: "recipient_rate_limited" });
    expect(sent).toEqual([]);
    expect(await getDb().auditLog.count({ where: { targetId: user.id, action: "account_email_change_suppressed", after: { path: ["reason"], equals: "pair_rate_limited" } } })).toBe(1);
    // Someone else exhausting their own pair does not block this account.
    const other = await createUser();
    await expect(request(other, target)).resolves.toEqual({ outcome: "sent" });
  });

  it("keeps a looser per-address cap across all accounts", async () => {
    const target = syntheticEmail("bombed");
    for (let index = 0; index < 20; index += 1) await consumeAccountRateLimit("account_email_change_recipient", target);
    const user = await createUser();
    await expect(request(user, target)).resolves.toEqual({ outcome: "recipient_rate_limited" });
    expect(sent).toEqual([]);
    expect(await getDb().userEmailChangeRequest.count({ where: { userId: user.id } })).toBe(0);
  });

  it("limits requests per account to five an hour (the action's account layer)", async () => {
    const user = await createUser();
    for (let index = 0; index < 5; index += 1) {
      await expect(checkAccountRateLimit("account_email_change_request", user.id)).resolves.toBeNull();
    }
    expect((await checkAccountRateLimit("account_email_change_request", user.id))?.status).toBe(429);
    const other = await createUser();
    await expect(checkAccountRateLimit("account_email_change_request", other.id)).resolves.toBeNull();
  });

  it("stores nothing when the account changed since the request or is suspended", async () => {
    const user = await createUser();
    await expect(processAccountEmailChangeRequest({ userId: user.id, sessionId: (await createSession(user.id)).id, currentEmail: syntheticEmail("stale"), newEmail: syntheticEmail("x") })).resolves.toEqual({ outcome: "account_changed" });
    const suspended = await createUser({ status: "suspended" });
    await expect(request(suspended, syntheticEmail("y"))).resolves.toEqual({ outcome: "account_changed" });
    expect(await getDb().userEmailChangeRequest.count({ where: { userId: { in: [user.id, suspended.id] } } })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("stores nothing when the requesting session ended meanwhile or belongs to someone else", async () => {
    const user = await createUser();
    const other = await createUser();
    const revoked = await getDb().userSession.update({ where: { id: (await createSession(user.id)).id }, data: { revokedAt: new Date() } });
    await expect(request(user, syntheticEmail("revoked-session"), undefined, revoked.id)).resolves.toEqual({ outcome: "account_changed" });
    const foreign = await createSession(other.id);
    await expect(request(user, syntheticEmail("foreign-session"), undefined, foreign.id)).resolves.toEqual({ outcome: "account_changed" });
    expect(await getDb().userEmailChangeRequest.count({ where: { userId: user.id } })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("revokes both links when the verification mail cannot be sent, and sends no notice", async () => {
    const user = await createUser();
    provider.mockImplementationOnce(async () => new Response("{}", { status: 500 }));
    await expect(request(user, syntheticEmail("bounce"))).resolves.toEqual({ outcome: "send_failed" });
    const row = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(row.revertRevokedAt).toBeInstanceOf(Date);
    expect(sent).toEqual([]);
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_email_failed" } });
    expect(audit.after).toMatchObject({ errorCode: "provider_rejected", requestId: row.id });
  });

  it("is cancelled by a password change in settings", async () => {
    const password = "Synthetic-Current-Passphrase-2026";
    const user = await createUser({ passwordHash: await hashPasswordAsync(password) });
    const link = await requestLink(user, syntheticEmail("settings-cancel"));
    const session = await createSession(user.id);
    auth.requireAuth.mockResolvedValue({ user: { ...user, mfaFactor: null }, session, vendor: null, member: null });
    const form = new FormData();
    form.set("currentPassword", password);
    form.set("password", "Synthetic-Rotated-Passphrase-2026");
    form.set("confirmPassword", "Synthetic-Rotated-Passphrase-2026");
    await expect(updatePasswordAction(form)).rejects.toThrow("redirect:/login?password_changed=1");
    expect((await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } })).revokedAt).toBeInstanceOf(Date);
    await expect(confirmAccountEmailChange(link)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });
});

describe("confirming a login email change (PostgreSQL)", () => {
  it("changes and verifies the address, consumes the request, opens the revert window, ends every session and reset token, keeps the founder bound, and audits", async () => {
    const user = await createUser();
    const vendor = await createFounderVendor(user);
    const sessions = [await createSession(user.id), await createSession(user.id)];
    const reset = await createPasswordResetToken({ email: user.email });
    const newEmail = syntheticEmail("verified");
    const token = await requestLink(user, newEmail, undefined, sessions[0]!.id);
    const before = Date.now();

    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "changed" });

    const changed = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(changed.email).toBe(newEmail);
    expect(changed.emailVerifiedAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    const row = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.consumedAt).toEqual(changed.emailVerifiedAt);
    expect(row.revokedAt).toBeNull();
    expect(row.revertExpiresAt.getTime() - row.consumedAt!.getTime()).toBe(7 * DAY_MS);
    expect(row.syncedVendorId).toBe(vendor.id);
    for (const session of sessions) {
      expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeInstanceOf(Date);
    }
    expect((await getDb().passwordResetToken.findUniqueOrThrow({ where: { id: reset!.tokenId } })).usedAt).toBeInstanceOf(Date);
    await expect(consumePasswordResetToken(reset!.token, "synthetic-new-password-123")).resolves.toEqual({ ok: false, reason: "invalid_or_expired" });
    expect((await getDb().vendor.findUniqueOrThrow({ where: { id: vendor.id } })).email).toBe(newEmail);
    await expect(vendorEmailVerificationState(getDb(), vendor.id)).resolves.toEqual({ verified: true, founder: { userId: user.id, email: newEmail }, fallbackReason: null });

    const audits = await getDb().auditLog.findMany({ where: { targetId: user.id, action: "account_email_changed" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ vendorId: vendor.id, actorId: user.id, userAgent: "synthetic-agent" });
    expect(audits[0]!.after).toMatchObject({ requestId: row.id, sessionsRevoked: 2, resetLinksRevoked: 1, founderVendorUpdated: true });
    expect(JSON.stringify(audits)).not.toContain(token.split(".")[2]!);
    expect(JSON.stringify(audits)).not.toContain(newEmail);
  });

  it.each([
    ["a founder who left the workspace", { status: "inactive" }],
    ["a founder whose role is now staff", { role: "admin" }],
  ])("does not move Vendor.email for %s", async (_label, membership) => {
    const user = await createUser();
    const vendor = await createFounderVendor(user, membership);
    await changeEmail(user, syntheticEmail("staff"));
    expect((await getDb().vendor.findUniqueOrThrow({ where: { id: vendor.id } })).email).toBe(user.email);
    expect((await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } })).syncedVendorId).toBeNull();
  });

  it("does not move Vendor.email to an address another workspace already uses", async () => {
    const user = await createUser();
    const vendor = await createFounderVendor(user);
    const newEmail = syntheticEmail("vendor-taken");
    const otherVendor = await createVendor(newEmail);
    await changeEmail(user, newEmail);
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(newEmail);
    expect((await getDb().vendor.findUniqueOrThrow({ where: { id: vendor.id } })).email).toBe(user.email);
    expect((await getDb().vendor.findUniqueOrThrow({ where: { id: otherVendor.id } })).email).toBe(newEmail);
  });

  it("refuses an expired link and leaves the account untouched", async () => {
    const user = await createUser();
    const session = await createSession(user.id);
    const issuedAt = new Date(Date.now() - 2 * 60 * 60_000);
    const token = await requestLink(user, syntheticEmail("late"), issuedAt);
    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } })).consumedAt).toBeNull();

    // The stored expiry decides too: a token whose own expiry is still ahead is refused once the row expired.
    const other = await createUser();
    const fresh = await requestLink(other, syntheticEmail("stored-expiry"));
    const past = new Date(Date.now() - 60_000);
    await getDb().userEmailChangeRequest.updateMany({ where: { userId: other.id }, data: { createdAt: new Date(past.getTime() - 60_000), expiresAt: past } });
    await expect(confirmAccountEmailChange(fresh)).resolves.toEqual({ status: "invalid" });
    await expect(describeAccountEmailChangeLink(fresh)).resolves.toBeNull();

    for (const account of [user, other]) {
      expect(await getDb().user.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({ email: account.email, emailVerifiedAt: null });
    }
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
  });

  it("refuses a link that was already used", async () => {
    const user = await createUser();
    const newEmail = syntheticEmail("once");
    const token = await requestLink(user, newEmail);
    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "changed" });
    const session = await createSession(user.id);
    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(newEmail);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    expect(await getDb().auditLog.count({ where: { targetId: user.id, action: "account_email_changed" } })).toBe(1);
  });

  it("reports an address taken between request and confirmation and changes nothing", async () => {
    const user = await createUser();
    const session = await createSession(user.id);
    const newEmail = syntheticEmail("contested");
    const token = await requestLink(user, newEmail);
    const squatter = await getDb().user.create({ data: { name: "Synthetic squatter", email: newEmail, passwordHash: "synthetic-only" } });
    created.userIds.push(squatter.id);

    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "email_taken" });
    expect(await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ email: user.email, emailVerifiedAt: null });
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    const row = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(row).toMatchObject({ consumedAt: null, revokedAt: expect.any(Date) });
    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "invalid" });
  });

  it("lets only one of two accounts racing for the same address win", async () => {
    const first = await createUser();
    const second = await createUser();
    const contested = syntheticEmail("race");
    const firstLink = await requestLink(first, contested);
    const secondLink = await requestLink(second, contested);
    const results = await Promise.all([confirmAccountEmailChange(firstLink), confirmAccountEmailChange(secondLink)]);
    expect(results.map((result) => result.status).sort()).toEqual(["changed", "email_taken"]);
    const owners = await getDb().user.findMany({ where: { email: contested }, select: { id: true } });
    expect(owners).toHaveLength(1);
    const loser = owners[0]!.id === first.id ? second : first;
    expect((await getDb().user.findUniqueOrThrow({ where: { id: loser.id } })).email).toBe(loser.email);
  });

  it("binds the change to the request's own user: user A's link never changes user B", async () => {
    const userA = await createUser();
    const userB = await createUser();
    const sessionB = await createSession(userB.id);
    const newEmail = syntheticEmail("a-only");
    const tokenA = await requestLink(userA, newEmail);

    const forgedForB = createAccountEmailChangeToken({ userId: userB.id, newEmail }).token;
    await expect(confirmAccountEmailChange(forgedForB)).resolves.toEqual({ status: "invalid" });
    const rowA = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: userA.id } });
    await getDb().userEmailChangeRequest.update({ where: { id: rowA.id }, data: { tokenHash: accountEmailChangeTokenHash(forgedForB) } });
    await expect(confirmAccountEmailChange(forgedForB)).resolves.toEqual({ status: "invalid" });
    await getDb().userEmailChangeRequest.update({ where: { id: rowA.id }, data: { tokenHash: accountEmailChangeTokenHash(tokenA) } });

    await expect(confirmAccountEmailChange(tokenA)).resolves.toEqual({ status: "changed" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: userA.id } })).email).toBe(newEmail);
    expect(await getDb().user.findUniqueOrThrow({ where: { id: userB.id } })).toMatchObject({ email: userB.email, emailVerifiedAt: null });
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: sessionB.id } })).revokedAt).toBeNull();
  });

  it("refuses a link whose MAC does not match the stored address", async () => {
    const user = await createUser();
    const token = await requestLink(user, syntheticEmail("bound"));
    await getDb().userEmailChangeRequest.updateMany({ where: { userId: user.id }, data: { newEmail: syntheticEmail("swapped") } });
    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it("refuses links of suspended accounts and links cancelled by a password reset", async () => {
    const suspended = await createUser();
    const suspendedLink = await requestLink(suspended, syntheticEmail("suspended"));
    await getDb().user.update({ where: { id: suspended.id }, data: { status: "suspended" } });
    await expect(confirmAccountEmailChange(suspendedLink)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: suspended.id } })).email).toBe(suspended.email);

    const user = await createUser();
    const link = await requestLink(user, syntheticEmail("cancelled"));
    const reset = await createPasswordResetToken({ email: user.email });
    await expect(consumePasswordResetToken(reset!.token, "synthetic-new-password-123")).resolves.toMatchObject({ ok: true });
    expect((await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } })).revokedAt).toBeInstanceOf(Date);
    await expect(confirmAccountEmailChange(link)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it("refuses malformed tokens and tokens without a stored request", async () => {
    for (const value of [undefined, "", "aec1.x.y", createAccountEmailChangeToken({ userId: "cuid_unknown_user", newEmail: "nobody@example.test" }).token]) {
      await expect(confirmAccountEmailChange(value)).resolves.toEqual({ status: "invalid" });
    }
  });
});

describe("password reset around a login email change (PostgreSQL)", () => {
  it("issues no reset token for the old address once the change completed", async () => {
    const user = await createUser();
    await changeEmail(user, syntheticEmail("moved"));
    await expect(createPasswordResetToken({ email: user.email })).resolves.toBeNull();
    expect(await usableResetTokens(user.id)).toBe(0);
  });

  it("never leaves a usable reset token when it races the confirmation", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const user = await createUser();
      const link = await requestLink(user, syntheticEmail("race-reset"));
      const [confirmed] = await Promise.all([confirmAccountEmailChange(link), createPasswordResetToken({ email: user.email })]);
      expect(confirmed).toEqual({ status: "changed" });
      // Whichever ran first, no token mailed to the old address can still be used.
      expect(await usableResetTokens(user.id)).toBe(0);
    }
  });
});

describe("reverting a login email change (PostgreSQL)", () => {
  it("restores the previous address and secures the account: sessions, reset tokens, pending changes, founder sync, audit, seven-day lock", async () => {
    const user = await createUser();
    const vendor = await createFounderVendor(user);
    const newEmail = syntheticEmail("taken-over");
    const revert = await changeEmail(user, newEmail);
    await expect(describeAccountEmailRevertLink(revert)).resolves.toEqual({ mode: "restore" });
    // The intruder now acts on the account: new session, a reset to the new address, another pending change.
    const session = await createSession(user.id);
    const reset = await createPasswordResetToken({ email: newEmail });
    expect(reset).not.toBeNull();
    await requestLink({ id: user.id, email: newEmail }, syntheticEmail("further"));

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });

    const restored = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(restored.email).toBe(user.email);
    expect(restored.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeInstanceOf(Date);
    expect(await usableResetTokens(user.id)).toBe(0);
    expect(await getDb().userEmailChangeRequest.count({ where: { userId: user.id, consumedAt: null, revokedAt: null } })).toBe(0);
    expect((await getDb().vendor.findUniqueOrThrow({ where: { id: vendor.id } })).email).toBe(user.email);
    await expect(vendorEmailVerificationState(getDb(), vendor.id)).resolves.toMatchObject({ verified: true, founder: { userId: user.id, email: user.email } });
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_reverted" } });
    expect(audit.after).toMatchObject({ vendorRestored: true, pendingCancelled: 1, resetLinksRevoked: 1 });
    expect(JSON.stringify(audit)).not.toContain(user.email);

    // No self-service change for seven days.
    const lockedUntil = await accountEmailChangeLockedUntil(getDb(), user.id);
    expect(lockedUntil!.getTime() - Date.now()).toBeGreaterThan(7 * DAY_MS - 60_000);
    await expect(request(restored, syntheticEmail("too-soon"))).resolves.toEqual({ outcome: "locked" });
    // A reset to the restored address works again.
    await expect(createPasswordResetToken({ email: user.email })).resolves.not.toBeNull();
  });

  it("cancels a change that has not completed yet and evicts its requester, without a change lock", async () => {
    const password = "Synthetic-Owner-Passphrase-2026";
    const user = await createUser({ passwordHash: await hashPasswordAsync(password) });
    const vendor = await createFounderVendor(user);
    const line = await createLineIdentity(user.id, vendor.id);
    const before = new Date(Date.now() - DAY_MS);
    const factor = await getDb().userMfaFactor.create({ data: { userId: user.id, secretEncrypted: "synthetic-owner-secret", enabledAt: before, createdAt: before } });
    await getDb().userRecoveryCode.create({ data: { userId: user.id, codeHash: "synthetic-owner-code", createdAt: before } });
    // Whoever requested the change knew the password and held this session.
    const session = await createSession(user.id);
    const reset = await createPasswordResetToken({ email: user.email });
    const { change, revert } = await requestLinks(user, syntheticEmail("not-yet"), undefined, session.id);
    await expect(describeAccountEmailRevertLink(revert)).resolves.toEqual({ mode: "cancel" });
    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "cancelled" });
    await expect(confirmAccountEmailChange(change)).resolves.toEqual({ status: "invalid" });

    const after = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe(user.email);
    // Sessions, password, reset links, LINE Login and recovery codes end.
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeInstanceOf(Date);
    expect(await getDb().userSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(isUnusablePasswordHash(after.passwordHash)).toBe(true);
    await expect(authenticateUser(user.email, password)).resolves.toBeNull();
    expect((await getDb().passwordResetToken.findUniqueOrThrow({ where: { id: reset!.tokenId } })).usedAt).toBeInstanceOf(Date);
    expect((await getDb().lineUserIdentity.findUniqueOrThrow({ where: { id: line.id } })).revokedAt).toBeInstanceOf(Date);
    expect(await getDb().userRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    // The factor stays: the clicker holds the login mailbox and must not get past MFA.
    await expect(getDb().userMfaFactor.findUnique({ where: { userId: user.id } })).resolves.toMatchObject({ id: factor.id });
    // No change lock.
    await expect(accountEmailChangeLockedUntil(getDb(), user.id)).resolves.toBeNull();
    // The request ends and its revert link is spent without opening the lock.
    expect(await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({
      revokedAt: expect.any(Date),
      revertedAt: null,
      revertRevokedAt: expect.any(Date),
    });
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_cancelled_by_owner" } });
    expect(audit.after).toMatchObject({ pendingCancelled: 1, sessionsRevoked: 1, resetLinksRevoked: 1, lineIdentitiesRevoked: 1, loginCredentialDisabled: true, recoveryCodesRemoved: 1 });
    expect(await getDb().auditLog.count({ where: { targetId: user.id, action: { in: ["account_email_change_reverted", "account_email_revert_mfa_removed"] } } })).toBe(0);

    // The owner resets the password through the address they hold, signs in again and may change right away.
    sent.length = 0;
    await sendPasswordResetLink({ email: user.email, appUrl: "https://app.example.test" });
    const newPassword = "Synthetic-Recovered-Passphrase-2026";
    await expect(consumePasswordResetToken(linkFrom(sent[0]!, "/password-reset/confirm"), newPassword)).resolves.toMatchObject({ ok: true });
    await expect(authenticateUser(user.email, newPassword)).resolves.toMatchObject({ user: { id: user.id } });
    await expect(request(after, syntheticEmail("again"))).resolves.toEqual({ outcome: "sent" });
  });

  it("keeps a cancel single use and revokes the pending request and later revert links, as before", async () => {
    const user = await createUser();
    const first = await requestLinks(user, syntheticEmail("cancel-first"));
    // A second request supersedes the first; both cancel links went to the same address.
    const second = await requestLinks(user, syntheticEmail("cancel-second"));
    await expect(revertAccountEmailChange(first.revert)).resolves.toEqual({ status: "cancelled" });
    await expect(revertAccountEmailChange(first.revert)).resolves.toEqual({ status: "invalid" });
    // The open request (the second) ended, and its later revert link with it.
    await expect(confirmAccountEmailChange(second.change)).resolves.toEqual({ status: "invalid" });
    await expect(describeAccountEmailRevertLink(second.revert)).resolves.toBeNull();
    await expect(revertAccountEmailChange(second.revert)).resolves.toEqual({ status: "invalid" });
    expect(await getDb().userEmailChangeRequest.count({ where: { userId: user.id, consumedAt: null, revokedAt: null } })).toBe(0);
    await expect(accountEmailChangeLockedUntil(getDb(), user.id)).resolves.toBeNull();
  });

  it("locks the account down when the old address's link is used after the change completed", async () => {
    const password = "Synthetic-Owner-Passphrase-2026";
    const user = await createUser({ passwordHash: await hashPasswordAsync(password) });
    const newEmail = syntheticEmail("completed");
    const revert = await changeEmail(user, newEmail);
    await expect(describeAccountEmailRevertLink(revert)).resolves.toEqual({ mode: "restore" });
    const session = await createSession(user.id);
    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeInstanceOf(Date);
    await expect(accountEmailChangeLockedUntil(getDb(), user.id)).resolves.toBeInstanceOf(Date);
    await expect(authenticateUser(user.email, password)).resolves.toBeNull();
  });

  it("is single use", async () => {
    const user = await createUser();
    const revert = await changeEmail(user, syntheticEmail("twice"));
    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    const session = await createSession(user.id);
    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    expect(await getDb().auditLog.count({ where: { targetId: user.id, action: "account_email_change_reverted" } })).toBe(1);
  });

  it("expires seven days after the change", async () => {
    const user = await createUser();
    const newEmail = syntheticEmail("too-late");
    const revert = await changeEmail(user, newEmail);
    await getDb().userEmailChangeRequest.updateMany({ where: { userId: user.id }, data: { revertExpiresAt: new Date(Date.now() - 1_000) } });
    await expect(describeAccountEmailRevertLink(revert)).resolves.toBeNull();
    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(newEmail);
    // Once the window closed the previous address is free again.
    await getDb().$transaction((tx) => assertLoginEmailAvailableForNewAccount(tx, user.email));
  });

  it("reserves the previous address while the revert is usable: registration, invitations and other changes treat it as taken", async () => {
    const user = await createUser();
    const owner = await createUser();
    const vendor = await createFounderVendor(owner);
    await changeEmail(user, syntheticEmail("away"));

    // Registration and invitation acceptance as a new account.
    await expect(getDb().$transaction((tx) => assertLoginEmailAvailableForNewAccount(tx, user.email))).rejects.toBeInstanceOf(LoginEmailReservedError);
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: user.email, name: "Squatter", role: "support" });
    await expect(acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: null, newAccount: { passwordHash: "synthetic-only", name: "Squatter", termsVersion: "t", privacyVersion: "p" } })).resolves.toEqual({ ok: false, reason: "account_exists" });
    expect(await getDb().user.count({ where: { email: user.email } })).toBe(0);

    // Another account's change to the reserved address: same path as a taken address.
    const other = await createUser();
    sent.length = 0;
    await expect(request(other, user.email)).resolves.toEqual({ outcome: "target_unavailable" });
    expect(sent.map((mail) => mail.to)).toEqual([other.email]);
  });

  it("refuses at confirmation an address that became reserved after the request", async () => {
    const user = await createUser();
    const other = await createUser();
    const link = await requestLink(other, user.email.replace("change-", "later-"));
    // The other account asked for an address that is free now...
    const target = (await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: other.id } })).newEmail;
    created.emails.push(target);
    // ...then `user` takes it and moves on, reserving it.
    await changeEmail(user, target);
    const revert = await changeEmail({ id: user.id, email: target }, syntheticEmail("onwards"));
    expect(revert).toBeTruthy();
    await expect(confirmAccountEmailChange(link)).resolves.toEqual({ status: "email_taken" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: other.id } })).email).toBe(other.email);
  });

  it("lets the owner change back to their own reserved address", async () => {
    const user = await createUser();
    const newEmail = syntheticEmail("roundtrip");
    await changeEmail(user, newEmail);
    await changeEmail({ id: user.id, email: newEmail }, user.email);
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it("fails safely when the previous address was taken anyway", async () => {
    const user = await createUser();
    const newEmail = syntheticEmail("blocked");
    const revert = await changeEmail(user, newEmail);
    // Bypassing every application path (e.g. a manual database fix).
    const squatter = await getDb().user.create({ data: { name: "Synthetic squatter", email: user.email, passwordHash: "synthetic-only" } });
    created.userIds.push(squatter.id);
    const session = await createSession(user.id);
    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "conflict" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(newEmail);
    expect((await getDb().user.findUniqueOrThrow({ where: { id: squatter.id } })).email).toBe(user.email);
    // The account is still secured, and the link stays usable for support.
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeInstanceOf(Date);
    await expect(describeAccountEmailRevertLink(revert)).resolves.toEqual({ mode: "restore" });
    expect(await getDb().auditLog.count({ where: { targetId: user.id, action: "account_email_revert_conflict" } })).toBe(1);
  });

  it("cannot be outrun by a later change: the original owner's link still restores, and theirs revokes the later ones", async () => {
    const user = await createUser();
    const intruderFirst = syntheticEmail("intruder-1");
    const intruderSecond = syntheticEmail("intruder-2");
    const ownerRevert = await changeEmail(user, intruderFirst);
    const intruderRevert = await changeEmail({ id: user.id, email: intruderFirst }, intruderSecond);
    // The intruder uses their own revert link: the owner's earlier link survives.
    await expect(revertAccountEmailChange(intruderRevert)).resolves.toEqual({ status: "reverted" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(intruderFirst);
    await expect(revertAccountEmailChange(ownerRevert)).resolves.toEqual({ status: "reverted" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it("revokes later revert links when the owner reverts first", async () => {
    const user = await createUser();
    const intruderFirst = syntheticEmail("later-1");
    const ownerRevert = await changeEmail(user, intruderFirst);
    const intruderRevert = await changeEmail({ id: user.id, email: intruderFirst }, syntheticEmail("later-2"));
    await expect(revertAccountEmailChange(ownerRevert)).resolves.toEqual({ status: "reverted" });
    await expect(revertAccountEmailChange(intruderRevert)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it("makes the password unusable; a reset to the restored address lets the owner back in", async () => {
    const password = "Synthetic-Owner-Passphrase-2026";
    const user = await createUser({ passwordHash: await hashPasswordAsync(password) });
    const intruderEmail = syntheticEmail("evicted");
    const revert = await changeEmail(user, intruderEmail);
    await expect(authenticateUser(intruderEmail, password)).resolves.not.toBeNull();

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    const reverted = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isUnusablePasswordHash(reverted.passwordHash)).toBe(true);
    await expect(verifyPasswordAsync(password, reverted.passwordHash)).resolves.toBe(false);
    await expect(authenticateUser(user.email, password)).resolves.toBeNull();
    await expect(authenticateUser(intruderEmail, password)).resolves.toBeNull();
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_reverted" } });
    expect(audit.after).toMatchObject({ previousRestored: true, loginCredentialDisabled: true, mfaFactorRemoved: false });
    expect(JSON.stringify(audit)).not.toContain(reverted.passwordHash);

    // Not a lockout: the reset link goes to the restored address and replaces the password.
    sent.length = 0;
    await sendPasswordResetLink({ email: user.email, appUrl: "https://app.example.test" });
    expect(sent.map((mail) => mail.to)).toEqual([user.email]);
    const token = linkFrom(sent[0]!, "/password-reset/confirm");
    const newPassword = "Synthetic-Restored-Passphrase-2026";
    await expect(consumePasswordResetToken(token, newPassword)).resolves.toEqual({ ok: true, userId: user.id });
    await expect(authenticateUser(user.email, newPassword)).resolves.toMatchObject({ user: { id: user.id } });
    await expect(authenticateUser(user.email, password)).resolves.toBeNull();
  });

  it("does not let a password change that passed its check before the revert overwrite the disabled password", async () => {
    const password = "Synthetic-Owner-Passphrase-2026";
    const user = await createUser({ passwordHash: await hashPasswordAsync(password) });
    const revert = await changeEmail(user, syntheticEmail("cas"));
    const stale = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    const session = await createSession(user.id);
    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    // requireAuth ran before the revert: it still holds the old hash, and the current password verifies against it.
    auth.requireAuth.mockResolvedValue({ user: { ...stale, mfaFactor: null }, session, vendor: null, member: null });
    const form = new FormData();
    form.set("currentPassword", password);
    form.set("password", "Synthetic-Intruder-Passphrase-2026");
    form.set("confirmPassword", "Synthetic-Intruder-Passphrase-2026");
    await expect(updatePasswordAction(form)).rejects.toThrow("redirect:/settings/security?error=current_password");
    expect(isUnusablePasswordHash((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash)).toBe(true);

    // And with the account as it is now, the old password is simply wrong.
    auth.requireAuth.mockResolvedValue({ user: { ...await getDb().user.findUniqueOrThrow({ where: { id: user.id } }), mfaFactor: null }, session, vendor: null, member: null });
    await expect(updatePasswordAction(form)).rejects.toThrow("redirect:/settings/security?error=current_password");
  });

  it("removes an MFA factor and recovery codes enrolled after the change request, with an audit entry", async () => {
    const user = await createUser();
    const revert = await changeEmail(user, syntheticEmail("intruder-mfa"));
    // Whoever took over enrols their own authenticator.
    const factor = await getDb().userMfaFactor.create({ data: { userId: user.id, secretEncrypted: "synthetic-intruder-secret" } });
    await getDb().userRecoveryCode.createMany({ data: [1, 2].map((index) => ({ userId: user.id, codeHash: `synthetic-intruder-code-${index}` })) });

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    expect(await getDb().userMfaFactor.count({ where: { userId: user.id } })).toBe(0);
    expect(await getDb().userRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    const removal = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_revert_mfa_removed" } });
    expect(removal).toMatchObject({ targetType: "UserMfaFactor", actorLabel: "account_email_revert" });
    expect(removal.after).toMatchObject({ factorType: "totp", factorEnabledAt: factor.enabledAt.toISOString() });
    expect(JSON.stringify(removal)).not.toContain("synthetic-intruder-secret");
    const summary = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_reverted" } });
    expect(summary.after).toMatchObject({ mfaFactorRemoved: true, recoveryCodesRemoved: 2 });
    // The restored owner can be reached for a reset; after it, MFA can be enrolled again.
    await expect(createPasswordResetToken({ email: user.email })).resolves.not.toBeNull();
  });

  it("keeps the owner's earlier factor but removes every recovery code", async () => {
    const user = await createUser();
    const before = new Date(Date.now() - DAY_MS);
    const factor = await getDb().userMfaFactor.create({ data: { userId: user.id, secretEncrypted: "synthetic-owner-secret", enabledAt: before, createdAt: before } });
    await getDb().userRecoveryCode.create({ data: { userId: user.id, codeHash: "synthetic-owner-code", createdAt: before } });
    const revert = await changeEmail(user, syntheticEmail("owner-mfa"));
    await getDb().userRecoveryCode.create({ data: { userId: user.id, codeHash: "synthetic-later-code" } });

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    await expect(getDb().userMfaFactor.findUnique({ where: { userId: user.id } })).resolves.toMatchObject({ id: factor.id, secretEncrypted: "synthetic-owner-secret" });
    expect(await getDb().userRecoveryCode.count({ where: { userId: user.id } })).toBe(0);
    expect(await getDb().auditLog.count({ where: { targetId: user.id, action: "account_email_revert_mfa_removed" } })).toBe(0);
    const summary = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_reverted" } });
    expect(summary.after).toMatchObject({ mfaFactorRemoved: false, recoveryCodesRemoved: 2 });
  });

  it("removes a factor enrolled in the requesting session before the change was requested", async () => {
    const user = await createUser();
    // Sign in, enrol an authenticator, and only then request the change from that same session.
    const session = await getDb().userSession.create({
      data: { userId: user.id, tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60_000), createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    await getDb().userMfaFactor.create({ data: { userId: user.id, secretEncrypted: "synthetic-intruder-secret", enabledAt: new Date(Date.now() - 5 * 60_000), createdAt: new Date(Date.now() - 5 * 60_000) } });
    const links = await requestLinks(user, syntheticEmail("enrol-first"), undefined, session.id);
    const row = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(row).toMatchObject({ initiatingSessionId: session.id, initiatingSessionCreatedAt: session.createdAt });
    await expect(confirmAccountEmailChange(links.change)).resolves.toEqual({ status: "changed" });

    await expect(revertAccountEmailChange(links.revert)).resolves.toEqual({ status: "reverted" });
    expect(await getDb().userMfaFactor.count({ where: { userId: user.id } })).toBe(0);
    const removal = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_revert_mfa_removed" } });
    expect(removal.after).toMatchObject({ cutoffSource: "initiating_session", factorCutoff: session.createdAt.toISOString() });
  });

  it.each([
    ["exactly at the cutoff is removed", 0, 0],
    ["1 ms before the cutoff stays", -1, 1],
  ])("treats a factor enabled %s", async (_label, offsetMs, remaining) => {
    const user = await createUser();
    const revert = await changeEmail(user, syntheticEmail("boundary"));
    const row = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } });
    // Session and request at the same instant: the cutoff is request.createdAt.
    await getDb().userEmailChangeRequest.update({ where: { id: row.id }, data: { initiatingSessionCreatedAt: row.createdAt } });
    const enabledAt = new Date(row.createdAt.getTime() + offsetMs);
    await getDb().userMfaFactor.create({ data: { userId: user.id, secretEncrypted: "synthetic-boundary-secret", enabledAt, createdAt: new Date(row.createdAt.getTime() - DAY_MS) } });

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    expect(await getDb().userMfaFactor.count({ where: { userId: user.id } })).toBe(remaining);
  });

  it.each([
    ["23 hours before a legacy request is removed", 23, 0],
    ["25 hours before a legacy request stays", 25, 1],
  ])("falls back to the request time minus 24 hours for rows without a session time: a factor enabled %s", async (_label, hoursBefore, remaining) => {
    const user = await createUser();
    const revert = await changeEmail(user, syntheticEmail("legacy"));
    const row = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } });
    await getDb().userEmailChangeRequest.update({ where: { id: row.id }, data: { initiatingSessionId: null, initiatingSessionCreatedAt: null } });
    const enabledAt = new Date(row.createdAt.getTime() - hoursBefore * 60 * 60_000);
    await getDb().userMfaFactor.create({ data: { userId: user.id, secretEncrypted: "synthetic-legacy-secret", enabledAt, createdAt: enabledAt } });

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    expect(await getDb().userMfaFactor.count({ where: { userId: user.id } })).toBe(remaining);
  });

  it("revokes the account's LINE Login identities in every workspace, and only this account's", async () => {
    const user = await createUser();
    const other = await createUser();
    const first = await createFounderVendor(user);
    const second = await createVendor(syntheticEmail("second-workspace"));
    const mine = [await createLineIdentity(user.id, first.id), await createLineIdentity(user.id, second.id)];
    const theirs = await createLineIdentity(other.id, first.id);
    const revert = await changeEmail(user, syntheticEmail("line-revert"));

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    for (const identity of mine) expect((await getDb().lineUserIdentity.findUniqueOrThrow({ where: { id: identity.id } })).revokedAt).toBeInstanceOf(Date);
    expect((await getDb().lineUserIdentity.findUniqueOrThrow({ where: { id: theirs.id } })).revokedAt).toBeNull();
    const summary = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_reverted" } });
    expect(summary.after).toMatchObject({ lineIdentitiesRevoked: 2 });
  });

  it("treats a factor re-enrolled with a new secret after the request as the intruder's", async () => {
    const user = await createUser();
    const before = new Date(Date.now() - DAY_MS);
    await getDb().userMfaFactor.create({ data: { userId: user.id, secretEncrypted: "synthetic-owner-secret", enabledAt: before, createdAt: before } });
    const revert = await changeEmail(user, syntheticEmail("re-enrolled"));
    // completeMfaEnrollment's upsert keeps createdAt but refreshes enabledAt.
    await getDb().userMfaFactor.update({ where: { userId: user.id }, data: { secretEncrypted: "synthetic-intruder-secret", enabledAt: new Date() } });

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    expect(await getDb().userMfaFactor.count({ where: { userId: user.id } })).toBe(0);
  });

  it("evicts only this account: another user's factor, codes, sessions and password stay", async () => {
    const user = await createUser();
    const bystanderHash = await hashPasswordAsync("Synthetic-Bystander-Passphrase-2026");
    const bystander = await createUser({ passwordHash: bystanderHash });
    const revert = await changeEmail(user, syntheticEmail("scoped"));
    await getDb().userMfaFactor.create({ data: { userId: user.id, secretEncrypted: "synthetic-intruder-secret" } });
    await getDb().userMfaFactor.create({ data: { userId: bystander.id, secretEncrypted: "synthetic-bystander-secret" } });
    await getDb().userRecoveryCode.create({ data: { userId: bystander.id, codeHash: "synthetic-bystander-code" } });
    const bystanderSession = await createSession(bystander.id);
    const bystanderLine = await createLineIdentity(bystander.id, (await createVendor(syntheticEmail("bystander-workspace"))).id);

    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "reverted" });
    expect((await getDb().lineUserIdentity.findUniqueOrThrow({ where: { id: bystanderLine.id } })).revokedAt).toBeNull();
    expect(await getDb().userMfaFactor.count({ where: { userId: bystander.id } })).toBe(1);
    expect(await getDb().userRecoveryCode.count({ where: { userId: bystander.id } })).toBe(1);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: bystanderSession.id } })).revokedAt).toBeNull();
    expect((await getDb().user.findUniqueOrThrow({ where: { id: bystander.id } })).passwordHash).toBe(bystanderHash);
  });

  it("refuses tampered or foreign revert links", async () => {
    const user = await createUser();
    const revert = await changeEmail(user, syntheticEmail("tamper"));
    await getDb().userEmailChangeRequest.updateMany({ where: { userId: user.id }, data: { previousEmail: syntheticEmail("swapped-previous") } });
    await expect(revertAccountEmailChange(revert)).resolves.toEqual({ status: "invalid" });
    for (const value of [undefined, "", "aer1.x.y", revert.replace(/^aer1/u, "aec1")]) {
      await expect(revertAccountEmailChange(value)).resolves.toEqual({ status: "invalid" });
    }
  });
});

