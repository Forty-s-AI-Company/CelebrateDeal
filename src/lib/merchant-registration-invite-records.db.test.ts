import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { isMerchantRegistrationInviteRevoked, recentMerchantInvitations } from "@/lib/merchant-registration-invite-records";

const db = new PrismaClient();
const jtis: string[] = [];
const registrationAuditIds: string[] = [];

function jti(label: string) {
  const value = `${label}-${randomUUID().replace(/-/gu, "")}`.slice(0, 64);
  jtis.push(value);
  return value;
}

afterEach(async () => {
  await db.auditLog.deleteMany({ where: { targetType: "MerchantRegistrationInvite", targetId: { in: jtis } } });
  await db.auditLog.deleteMany({ where: { id: { in: registrationAuditIds } } });
  jtis.length = 0;
  registrationAuditIds.length = 0;
});
afterAll(async () => db.$disconnect());

describe("merchant invitation audit records (PostgreSQL)", () => {
  it("derives status from real audit rows, matching registrations by the JSON jti path", async () => {
    // Future timestamps keep these rows at the top of the newest-first listing.
    const base = Date.now() + 365 * 24 * 60 * 60 * 1_000;
    const registered = jti("registered");
    const revoked = jti("revoked");
    const pending = jti("pending");
    const expired = jti("expired");
    const rows = [
      { id: registered, offset: 4, expiresAt: new Date(base + 14 * 86_400_000) },
      { id: revoked, offset: 3, expiresAt: new Date(base + 14 * 86_400_000) },
      { id: pending, offset: 2, expiresAt: new Date(base + 14 * 86_400_000) },
      { id: expired, offset: 1, expiresAt: new Date(Date.now() - 1_000) },
    ];
    for (const row of rows) {
      await db.auditLog.create({ data: {
        vendorId: null, actorLabel: "platform_admin", action: "merchant_registration_invite_created", targetType: "MerchantRegistrationInvite", targetId: row.id,
        after: { maskedEmail: `${row.id.slice(0, 1)}***@example.test`, emailHash: "synthetic", expiresAt: row.expiresAt.toISOString() },
        createdAt: new Date(base + row.offset * 1_000),
      } });
    }
    await db.auditLog.create({ data: { vendorId: null, actorLabel: "platform_admin", action: "merchant_registration_invite_revoked", targetType: "MerchantRegistrationInvite", targetId: revoked } });
    const registration = await db.auditLog.create({ data: {
      action: "registration_completed", targetType: "User", targetId: `user-${randomUUID()}`,
      after: { policyConsent: { termsVersion: "t", privacyVersion: "p" }, registrationInvite: { jti: registered } },
      createdAt: new Date(base + 10_000),
    } });
    registrationAuditIds.push(registration.id);

    const listed = await recentMerchantInvitations(new Date());
    const status = Object.fromEntries(listed.filter((row) => jtis.includes(row.jti)).map((row) => [row.jti, row.status]));
    expect(status).toEqual({ [registered]: "registered", [revoked]: "revoked", [pending]: "pending", [expired]: "expired" });
    await expect(isMerchantRegistrationInviteRevoked(revoked)).resolves.toBe(true);
    await expect(isMerchantRegistrationInviteRevoked(pending)).resolves.toBe(false);
  });
});
