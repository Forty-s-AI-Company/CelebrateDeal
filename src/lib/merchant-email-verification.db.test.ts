import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

/**
 * Merchant email verification against PostgreSQL: the link binds user and
 * address in the final update, confirmation is idempotent, sends are limited
 * per recipient, and only links the platform itself e-mailed (verification,
 * member invitation, password reset) set `emailVerifiedAt`. Synthetic data;
 * the Resend provider is a stubbed `fetch`.
 */
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })) }));

import { accountRateLimitKeyHash } from "@/lib/account-rate-limit";
import { createMerchantEmailVerificationToken } from "@/lib/merchant-email-verification-token";
import { confirmMerchantEmailVerification, sendMerchantEmailVerification, vendorOwnerEmailVerified } from "@/lib/merchant-email-verification";
import { acceptVendorMemberInvitation, createVendorMemberInvitation } from "@/lib/vendor-member-invitation";
import { consumePasswordResetToken, createPasswordResetToken } from "@/lib/password-reset";

const created = { userIds: [] as string[], vendorIds: [] as string[], emails: [] as string[] };
const sent: Array<{ to: string; subject: string; text: string }> = [];
const provider = vi.fn(async (_url: string, init: RequestInit) => {
  sent.push(JSON.parse(String(init.body)));
  return Response.json({ id: `synthetic-${sent.length}` });
});

async function createUser(data: { status?: string; emailVerifiedAt?: Date | null } = {}) {
  const email = `verify-${randomUUID()}@example.test`;
  created.emails.push(email);
  const user = await getDb().user.create({ data: { name: "Synthetic owner", email, passwordHash: "synthetic-only", ...data } });
  created.userIds.push(user.id);
  return user;
}

function linkToken(text: string) {
  const match = /\/verify-email\?token=([A-Za-z0-9._%-]+)/u.exec(text);
  expect(match).not.toBeNull();
  return decodeURIComponent(match![1]!);
}

beforeEach(() => {
  sent.length = 0;
  provider.mockClear();
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
  await db.accountRateLimitBucket.deleteMany({ where: { keyHash: { in: emails.map((email) => accountRateLimitKeyHash("merchant_email_verification", email)) } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe("confirming a merchant email verification link (PostgreSQL)", () => {
  it("verifies the account once, is idempotent, and audits the link id but never the token", async () => {
    const user = await createUser();
    const { token, jti } = createMerchantEmailVerificationToken({ userId: user.id, email: user.email });
    await expect(confirmMerchantEmailVerification(token)).resolves.toEqual({ status: "verified" });
    const verifiedAt = (await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt;
    expect(verifiedAt).toBeInstanceOf(Date);

    // Opening the same link (or another valid one) again changes nothing.
    await expect(confirmMerchantEmailVerification(token)).resolves.toEqual({ status: "already_verified" });
    const again = createMerchantEmailVerificationToken({ userId: user.id, email: user.email }).token;
    await expect(confirmMerchantEmailVerification(again)).resolves.toEqual({ status: "already_verified" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toEqual(verifiedAt);

    const audits = await getDb().auditLog.findMany({ where: { targetId: user.id, action: "merchant_email_verified" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ method: "verification_link", jti });
    expect(JSON.stringify(audits)).not.toContain(token.split(".")[2]!);
  });

  it("binds the update to both the user and the address in the link", async () => {
    const owner = await createUser();
    const other = await createUser();
    // A link for one account's id with another account's address verifies neither.
    const mixed = createMerchantEmailVerificationToken({ userId: owner.id, email: other.email }).token;
    await expect(confirmMerchantEmailVerification(mixed)).resolves.toEqual({ status: "invalid" });
    const unknown = createMerchantEmailVerificationToken({ userId: "cuid_unknown_user", email: owner.email }).token;
    await expect(confirmMerchantEmailVerification(unknown)).resolves.toEqual({ status: "invalid" });
    for (const id of [owner.id, other.id]) expect((await getDb().user.findUniqueOrThrow({ where: { id } })).emailVerifiedAt).toBeNull();
  });

  it("invalidates links sent to an earlier address", async () => {
    const user = await createUser();
    const { token } = createMerchantEmailVerificationToken({ userId: user.id, email: user.email });
    const changed = `changed-${randomUUID()}@example.test`;
    created.emails.push(changed);
    await getDb().user.update({ where: { id: user.id }, data: { email: changed } });
    await expect(confirmMerchantEmailVerification(token)).resolves.toEqual({ status: "invalid" });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  });

  it("refuses expired, tampered and suspended-account links", async () => {
    const user = await createUser();
    const expired = createMerchantEmailVerificationToken({ userId: user.id, email: user.email, now: new Date(Date.now() - 25 * 60 * 60 * 1_000) }).token;
    await expect(confirmMerchantEmailVerification(expired)).resolves.toEqual({ status: "invalid" });
    const valid = createMerchantEmailVerificationToken({ userId: user.id, email: user.email }).token;
    await expect(confirmMerchantEmailVerification(`${valid.slice(0, -2)}AA`)).resolves.toEqual({ status: "invalid" });
    const suspended = await createUser({ status: "suspended" });
    await expect(confirmMerchantEmailVerification(createMerchantEmailVerificationToken({ userId: suspended.id, email: suspended.email }).token)).resolves.toEqual({ status: "invalid" });
    for (const id of [user.id, suspended.id]) expect((await getDb().user.findUniqueOrThrow({ where: { id } })).emailVerifiedAt).toBeNull();
  });
});

describe("sending merchant verification mail (PostgreSQL)", () => {
  it("sends a working link to the stored address and audits it without the token", async () => {
    const user = await createUser();
    await expect(sendMerchantEmailVerification({ userId: user.id, source: "resend" })).resolves.toMatchObject({ status: "sent" });
    expect(provider).toHaveBeenCalledOnce();
    expect(provider.mock.calls[0]![0]).toBe("https://api.resend.com/emails");
    expect(sent[0]).toMatchObject({ to: user.email, subject: "CelebrateDeal｜請驗證你的 Email" });
    const token = linkToken(sent[0]!.text);
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "merchant_email_verification_sent" } });
    expect(audit.after).toMatchObject({ source: "resend" });
    expect(JSON.stringify(audit)).not.toContain(token.split(".")[2]!);
    await expect(confirmMerchantEmailVerification(token)).resolves.toEqual({ status: "verified" });
  });

  it("allows three sends per recipient per hour and then refuses without sending", async () => {
    const user = await createUser();
    for (let index = 0; index < 3; index += 1) {
      await expect(sendMerchantEmailVerification({ userId: user.id, source: index === 0 ? "registration" : "resend" })).resolves.toMatchObject({ status: "sent" });
    }
    const limited = await sendMerchantEmailVerification({ userId: user.id, source: "resend" });
    expect(limited).toMatchObject({ status: "rate_limited" });
    expect(provider).toHaveBeenCalledTimes(3);
    expect(await getDb().auditLog.count({ where: { targetId: user.id, action: "merchant_email_verification_suppressed" } })).toBe(1);
  });

  it("sends nothing to a verified, suspended or unknown account", async () => {
    const verified = await createUser({ emailVerifiedAt: new Date() });
    const suspended = await createUser({ status: "suspended" });
    await expect(sendMerchantEmailVerification({ userId: verified.id, source: "resend" })).resolves.toEqual({ status: "already_verified" });
    await expect(sendMerchantEmailVerification({ userId: suspended.id, source: "resend" })).resolves.toEqual({ status: "ineligible" });
    await expect(sendMerchantEmailVerification({ userId: "cuid_unknown_user", source: "resend" })).resolves.toEqual({ status: "ineligible" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("reports a provider failure and audits it without throwing", async () => {
    const user = await createUser();
    provider.mockImplementationOnce(async () => new Response("{}", { status: 500 }));
    await expect(sendMerchantEmailVerification({ userId: user.id, source: "resend" })).resolves.toEqual({ status: "failed" });
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { targetId: user.id, action: "merchant_email_verification_email_failed" } });
    expect(audit.after).toMatchObject({ errorCode: "provider_rejected" });
  });
});

describe("other links the platform e-mailed also prove the mailbox (PostgreSQL)", () => {
  async function createVendorWithOwner() {
    const owner = await createUser();
    const suffix = randomUUID();
    const vendor = await getDb().vendor.create({ data: { name: "Synthetic vendor", slug: `verify-vendor-${suffix}`, email: owner.email, passwordHash: "synthetic-only" } });
    created.vendorIds.push(vendor.id);
    await getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: "owner", status: "active" } });
    return { vendor, owner };
  }

  it("verifies a new account created by accepting a member invitation", async () => {
    const { vendor, owner } = await createVendorWithOwner();
    const email = `invitee-${randomUUID()}@example.test`;
    created.emails.push(email);
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email, name: "Invitee", role: "admin" });
    const result = await acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: null, newAccount: { passwordHash: "synthetic-only", name: "Invitee", termsVersion: "t", privacyVersion: "p" } });
    expect(result).toMatchObject({ ok: true, createdAccount: true });
    expect((await getDb().user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("verifies an existing account that accepts an invitation sent to its address, keeping an earlier timestamp", async () => {
    const { vendor, owner } = await createVendorWithOwner();
    const invitee = await createUser();
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: invitee.email, name: "Invitee", role: "support" });
    await expect(acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: invitee.id })).resolves.toMatchObject({ ok: true, createdAccount: false });
    const verifiedAt = (await getDb().user.findUniqueOrThrow({ where: { id: invitee.id } })).emailVerifiedAt;
    expect(verifiedAt).toBeInstanceOf(Date);

    const earlier = new Date("2026-01-01T00:00:00.000Z");
    const alreadyVerified = await createUser({ emailVerifiedAt: earlier });
    const second = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: alreadyVerified.email, name: "Verified", role: "support" });
    await acceptVendorMemberInvitation(getDb(), { token: second.token, actorUserId: alreadyVerified.id });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: alreadyVerified.id } })).emailVerifiedAt).toEqual(earlier);
  });

  it("verifies the account when a password reset link is completed", async () => {
    const user = await createUser();
    const reset = await createPasswordResetToken({ email: user.email });
    await expect(consumePasswordResetToken(reset!.token, "synthetic-new-password-123")).resolves.toMatchObject({ ok: true });
    expect((await getDb().user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("decides vendor verification by the founding account", async () => {
    const { vendor, owner } = await createVendorWithOwner();
    await expect(vendorOwnerEmailVerified(getDb(), vendor.id)).resolves.toBe(false);
    await getDb().user.update({ where: { id: owner.id }, data: { emailVerifiedAt: new Date() } });
    await expect(vendorOwnerEmailVerified(getDb(), vendor.id)).resolves.toBe(true);
    await expect(vendorOwnerEmailVerified(getDb(), "cuid_unknown_vendor")).resolves.toBe(false);
  });
});
