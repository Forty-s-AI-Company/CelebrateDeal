import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

/**
 * Login email change against PostgreSQL: the request revokes older ones and
 * stores only a hash, the confirmation is single-use, bound to the request's
 * own user, re-checks uniqueness under a lock, and ends every session and
 * reset link. Synthetic data; the Resend provider is a stubbed `fetch`.
 */
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })) }));

import { accountRateLimitKeyHash, checkAccountRateLimit } from "@/lib/account-rate-limit";
import { confirmAccountEmailChange, processAccountEmailChangeRequest } from "@/lib/account-email-change";
import { accountEmailChangeTokenHash, createAccountEmailChangeToken } from "@/lib/account-email-change-token";
import { vendorEmailVerificationState } from "@/lib/merchant-email-verification";
import { consumePasswordResetToken, createPasswordResetToken } from "@/lib/password-reset";

const created = { userIds: [] as string[], vendorIds: [] as string[], emails: [] as string[] };
const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
const provider = vi.fn(async (_url: string, init: RequestInit) => {
  sent.push(JSON.parse(String(init.body)));
  return Response.json({ id: `synthetic-${sent.length}` });
});

function syntheticEmail(prefix: string) {
  const email = `${prefix}-${randomUUID()}@example.test`;
  created.emails.push(email);
  return email;
}

async function createUser(data: { status?: string; emailVerifiedAt?: Date | null } = {}) {
  const user = await getDb().user.create({ data: { name: "Synthetic owner", email: syntheticEmail("change"), passwordHash: "synthetic-only", ...data } });
  created.userIds.push(user.id);
  return user;
}

async function createSession(userId: string) {
  return getDb().userSession.create({ data: { userId, tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), expiresAt: new Date(Date.now() + 60 * 60_000) } });
}

async function createFounderVendor(owner: { id: string; email: string }) {
  const vendor = await getDb().vendor.create({ data: { name: "Synthetic vendor", slug: `change-vendor-${randomUUID()}`, email: owner.email, passwordHash: "synthetic-only" } });
  created.vendorIds.push(vendor.id);
  await getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: "owner", status: "active" } });
  return vendor;
}

function request(user: { id: string; email: string }, newEmail: string, now?: Date) {
  return processAccountEmailChangeRequest({ userId: user.id, currentEmail: user.email, newEmail, actorLabel: "owner", now });
}

function linkFrom(mail: { text: string }) {
  const match = /\/verify-email-change\?token=([A-Za-z0-9._%-]+)/u.exec(mail.text);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

/** Requests a change and returns the link e-mailed to the new address. */
async function requestLink(user: { id: string; email: string }, newEmail: string, now?: Date) {
  const before = sent.length;
  await expect(request(user, newEmail, now)).resolves.toEqual({ outcome: "sent" });
  const verification = sent.slice(before).find((mail) => mail.to === newEmail);
  expect(verification).toBeDefined();
  return linkFrom(verification!);
}

beforeEach(() => {
  sent.length = 0;
  provider.mockClear();
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
          ...userIds.map((id) => accountRateLimitKeyHash("account_email_change_request", id)),
          ...emails.map((email) => accountRateLimitKeyHash("password_reset_request", email)),
        ],
      },
    },
  });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  // Requests, sessions and reset tokens cascade with the user.
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("requesting a login email change (PostgreSQL)", () => {
  it("stores only the link's hash, mails the link to the new address and a masked notice without a link to the old one", async () => {
    const user = await createUser();
    const newEmail = syntheticEmail("new");
    const token = await requestLink(user, newEmail);

    const rows = await getDb().userEmailChangeRequest.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ newEmail, tokenHash: accountEmailChangeTokenHash(token), consumedAt: null, revokedAt: null });
    // 60 minutes, truncated to the token's whole-second expiry.
    const lifetime = rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime();
    expect(lifetime).toBeLessThanOrEqual(60 * 60_000);
    expect(lifetime).toBeGreaterThan(60 * 60_000 - 1_000);
    expect(JSON.stringify(rows)).not.toContain(token.split(".")[2]!);

    expect(sent).toHaveLength(2);
    const verification = sent.find((mail) => mail.to === newEmail)!;
    expect(verification.subject).toBe("CelebrateDeal｜請確認新的登入 Email");
    const notice = sent.find((mail) => mail.to === user.email)!;
    expect(notice.subject).toBe("CelebrateDeal｜你的登入 Email 正在變更");
    const [local, domain] = newEmail.split("@");
    expect(notice.text).toContain(`你的登入 Email 正在變更為 ${local!.slice(0, 1)}***@${domain}`);
    for (const body of [notice.text, notice.html]) {
      expect(body).not.toContain(newEmail);
      expect(body).not.toContain("verify-email-change");
      expect(body).not.toContain(token.split(".")[1]!);
    }
    // Nothing changed yet.
    expect(await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ email: user.email, emailVerifiedAt: null });

    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_requested" } });
    expect(audit.after).toMatchObject({ outcome: "sent", requestId: rows[0]!.id, supersededRequests: 0, noticeSent: true });
    expect(JSON.stringify(audit)).not.toContain(newEmail);
    expect(JSON.stringify(audit)).not.toContain(token.split(".")[2]!);
  });

  it("does not reveal an address another account uses: nothing goes to it, no request is stored, the old link still dies", async () => {
    const user = await createUser();
    const other = await createUser();
    const earlier = await requestLink(user, syntheticEmail("earlier"));
    sent.length = 0;

    await expect(request(user, other.email)).resolves.toEqual({ outcome: "target_unavailable" });
    // Only the same masked notice the success case sends, to the requester's own address.
    expect(sent.map((mail) => mail.to)).toEqual([user.email]);
    expect(sent[0]!.subject).toBe("CelebrateDeal｜你的登入 Email 正在變更");
    const rows = await getDb().userEmailChangeRequest.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedAt).toBeInstanceOf(Date);
    expect(rows.some((row) => row.newEmail === other.email)).toBe(false);
    // The superseded link stops working exactly as after a successful request.
    await expect(confirmAccountEmailChange(earlier)).resolves.toEqual({ status: "invalid" });
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

  it("enforces one open request per user in the database itself", async () => {
    const user = await createUser();
    const now = new Date();
    const row = (email: string) => ({
      userId: user.id,
      newEmail: email,
      tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await getDb().userEmailChangeRequest.create({ data: row(syntheticEmail("open-a")) });
    await expect(getDb().userEmailChangeRequest.create({ data: row(syntheticEmail("open-b")) })).rejects.toMatchObject({ code: "P2002" });
    // Unnormalized addresses and both outcomes at once are refused by CHECK constraints.
    await getDb().userEmailChangeRequest.updateMany({ where: { userId: user.id }, data: { revokedAt: now } });
    await expect(getDb().userEmailChangeRequest.create({ data: row(" Upper@Example.test") })).rejects.toThrow();
    await expect(getDb().userEmailChangeRequest.create({ data: { ...row(syntheticEmail("both")), consumedAt: now, revokedAt: now } })).rejects.toThrow();
  });

  it("limits verification mail per new address, whoever asks, and refuses without sending", async () => {
    const target = syntheticEmail("popular");
    for (let index = 0; index < 3; index += 1) {
      const user = await createUser();
      await expect(request(user, target)).resolves.toEqual({ outcome: "sent" });
    }
    sent.length = 0;
    const fourth = await createUser();
    await expect(request(fourth, target)).resolves.toEqual({ outcome: "recipient_rate_limited" });
    expect(sent).toEqual([]);
    expect(await getDb().userEmailChangeRequest.count({ where: { userId: fourth.id } })).toBe(0);
    expect(await getDb().auditLog.count({ where: { targetId: fourth.id, action: "account_email_change_suppressed" } })).toBe(1);
  });

  it("limits requests per account to five an hour (the action's account layer)", async () => {
    const user = await createUser();
    for (let index = 0; index < 5; index += 1) {
      await expect(checkAccountRateLimit("account_email_change_request", user.id)).resolves.toBeNull();
    }
    const limited = await checkAccountRateLimit("account_email_change_request", user.id);
    expect(limited?.status).toBe(429);
    // Another account is counted separately.
    const other = await createUser();
    await expect(checkAccountRateLimit("account_email_change_request", other.id)).resolves.toBeNull();
  });

  it("stores nothing when the account changed since the request or is suspended", async () => {
    const user = await createUser();
    await expect(processAccountEmailChangeRequest({ userId: user.id, currentEmail: syntheticEmail("stale"), newEmail: syntheticEmail("x") })).resolves.toEqual({ outcome: "account_changed" });
    const suspended = await createUser({ status: "suspended" });
    await expect(request(suspended, syntheticEmail("y"))).resolves.toEqual({ outcome: "account_changed" });
    expect(await getDb().userEmailChangeRequest.count({ where: { userId: { in: [user.id, suspended.id] } } })).toBe(0);
    expect(sent).toEqual([]);
  });

  it("revokes the stored request when the verification mail cannot be sent", async () => {
    const user = await createUser();
    provider.mockImplementationOnce(async () => new Response("{}", { status: 500 }));
    await expect(request(user, syntheticEmail("bounce"))).resolves.toEqual({ outcome: "send_failed" });
    const row = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.revokedAt).toBeInstanceOf(Date);
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "account_email_change_email_failed" } });
    expect(audit.after).toMatchObject({ errorCode: "provider_rejected", requestId: row.id });
  });
});

describe("confirming a login email change (PostgreSQL)", () => {
  it("changes and verifies the address, consumes the request, ends every session and reset link, keeps the founder bound, and audits", async () => {
    const user = await createUser();
    const vendor = await createFounderVendor(user);
    const sessions = [await createSession(user.id), await createSession(user.id)];
    const reset = await createPasswordResetToken({ email: user.email });
    const newEmail = syntheticEmail("verified");
    const token = await requestLink(user, newEmail);
    const before = Date.now();

    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "changed" });

    const changed = await getDb().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(changed.email).toBe(newEmail);
    expect(changed.emailVerifiedAt!.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    const row = await getDb().userEmailChangeRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.consumedAt).toEqual(changed.emailVerifiedAt);
    expect(row.revokedAt).toBeNull();
    for (const session of sessions) {
      expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeInstanceOf(Date);
    }
    // The reset link went to the old address and must not verify the new one.
    expect((await getDb().passwordResetToken.findUniqueOrThrow({ where: { id: reset!.tokenId } })).usedAt).toBeInstanceOf(Date);
    await expect(consumePasswordResetToken(reset!.token, "synthetic-new-password-123")).resolves.toEqual({ ok: false, reason: "invalid_or_expired" });
    // The workspace still recognizes its founding account (and it is now verified).
    expect((await getDb().vendor.findUniqueOrThrow({ where: { id: vendor.id } })).email).toBe(newEmail);
    await expect(vendorEmailVerificationState(getDb(), vendor.id)).resolves.toEqual({ verified: true, founder: { userId: user.id, email: newEmail }, fallbackReason: null });

    const audits = await getDb().auditLog.findMany({ where: { targetId: user.id, action: "account_email_changed" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ vendorId: vendor.id, actorId: user.id, userAgent: "synthetic-agent" });
    expect(audits[0]!.after).toMatchObject({ requestId: row.id, sessionsRevoked: 2, resetLinksRevoked: 1, founderVendorUpdated: true });
    expect(JSON.stringify(audits)).not.toContain(token.split(".")[2]!);
    expect(JSON.stringify(audits)).not.toContain(newEmail);
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
    // The replay changed nothing: no new revocation, no second audit.
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
    expect((await getDb().user.findUniqueOrThrow({ where: { id: squatter.id } })).email).toBe(newEmail);
    expect((await getDb().userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    // The link can never succeed, so it is revoked rather than left open.
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

    // A link signed for B with A's address has no stored request of its own.
    const forgedForB = createAccountEmailChangeToken({ userId: userB.id, newEmail }).token;
    await expect(confirmAccountEmailChange(forgedForB)).resolves.toEqual({ status: "invalid" });
    // Even if A's stored request carried the hash of a B-signed link, the user binding refuses it.
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
    // Someone with database write access swaps the target address: the MAC no longer matches.
    const swapped = syntheticEmail("swapped");
    await getDb().userEmailChangeRequest.updateMany({ where: { userId: user.id }, data: { newEmail: swapped } });
    await expect(confirmAccountEmailChange(token)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it("refuses links of suspended accounts and links cancelled by a password change", async () => {
    const suspended = await createUser();
    const suspendedLink = await requestLink(suspended, syntheticEmail("suspended"));
    await getDb().user.update({ where: { id: suspended.id }, data: { status: "suspended" } });
    await expect(confirmAccountEmailChange(suspendedLink)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: suspended.id } })).email).toBe(suspended.email);

    // The old-address notice says a password reset stops the change; it does.
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
