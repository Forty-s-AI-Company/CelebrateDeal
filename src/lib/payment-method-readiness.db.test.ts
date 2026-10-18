import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { verifiedVendorPaymentMethodWhere } from "@/lib/payment-method-reference";

const createdVendorIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  const db = getDb();
  const vendorIds = createdVendorIds.splice(0);
  await db.paymentMethodReference.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.teamMembership.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.salesTeam.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendorMember.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } });
});

async function createVendor(label: string) {
  const suffix = randomUUID();
  const vendor = await getDb().vendor.create({
    data: {
      name: `Synthetic ${label}`,
      slug: `wp02-${label}-${suffix}`,
      email: `wp02-${label}-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  return vendor;
}

describe("WP-02 payment-method readiness on disposable PostgreSQL", () => {
  it("counts only current vendor-scoped records whose verification is proven", async () => {
    const db = getDb();
    const now = new Date("2026-10-16T12:00:00.000Z");
    const vendor = await createVendor("merchant");
    const otherVendor = await createVendor("other-tenant");
    const user = await db.user.create({
      data: {
        name: "Synthetic team member",
        email: `wp02-member-${randomUUID()}@example.test`,
        passwordHash: "disposable-test-only",
      },
    });
    createdUserIds.push(user.id);
    const vendorMember = await db.vendorMember.create({
      data: { vendorId: vendor.id, userId: user.id, role: "member" },
    });
    const team = await db.salesTeam.create({
      data: { vendorId: vendor.id, name: "Synthetic payment scope", slug: `wp02-team-${randomUUID()}` },
    });
    const membership = await db.teamMembership.create({
      data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: vendorMember.id },
    });

    const references = [
      { key: "verified-no-expiry", status: "verified", verifiedAt: new Date(now.getTime() - 60_000), expiresAt: null },
      { key: "verified-future-expiry", status: "verified", verifiedAt: now, expiresAt: new Date(now.getTime() + 60_000) },
      { key: "missing-verification-time", status: "verified", verifiedAt: null, expiresAt: null },
      { key: "future-verification-time", status: "verified", verifiedAt: new Date(now.getTime() + 1), expiresAt: null },
      { key: "expired-at-boundary", status: "verified", verifiedAt: new Date(now.getTime() - 60_000), expiresAt: now },
      { key: "pending", status: "pending", verifiedAt: null, expiresAt: null },
      { key: "provider-unknown", status: "provider_unknown", verifiedAt: null, expiresAt: null },
    ] as const;

    await db.paymentMethodReference.createMany({
      data: references.map((reference) => ({
        vendorId: vendor.id,
        scopeType: "VENDOR",
        providerName: "payuni",
        providerPaymentMethodRef: `wp02-${reference.key}-${randomUUID()}`,
        status: reference.status,
        verifiedAt: reference.verifiedAt,
        expiresAt: reference.expiresAt,
      })),
    });
    await db.paymentMethodReference.create({
      data: {
        vendorId: vendor.id,
        scopeType: "VENDOR",
        teamId: team.id,
        membershipId: membership.id,
        providerName: "payuni",
        providerPaymentMethodRef: `wp02-member-scoped-${randomUUID()}`,
        status: "verified",
        verifiedAt: new Date(now.getTime() - 60_000),
      },
    });
    await db.paymentMethodReference.create({
      data: {
        vendorId: vendor.id,
        scopeType: "TEAM",
        providerName: "payuni",
        providerPaymentMethodRef: `wp02-team-scoped-${randomUUID()}`,
        status: "verified",
        verifiedAt: new Date(now.getTime() - 60_000),
      },
    });
    await db.paymentMethodReference.create({
      data: {
        vendorId: otherVendor.id,
        scopeType: "VENDOR",
        providerName: "payuni",
        providerPaymentMethodRef: `wp02-other-tenant-${randomUUID()}`,
        status: "verified",
        verifiedAt: new Date(now.getTime() - 60_000),
      },
    });

    const ready = await db.paymentMethodReference.findMany({
      where: verifiedVendorPaymentMethodWhere(vendor.id, now),
      select: { providerPaymentMethodRef: true },
      orderBy: { providerPaymentMethodRef: "asc" },
    });

    expect(ready).toHaveLength(2);
    expect(ready.map((item) => item.providerPaymentMethodRef)).toEqual(expect.arrayContaining([
      expect.stringContaining("verified-no-expiry"),
      expect.stringContaining("verified-future-expiry"),
    ]));
    expect(await db.paymentMethodReference.count({ where: { vendorId: vendor.id } })).toBe(9);
    expect(await db.paymentMethodReference.count({ where: { vendorId: otherVendor.id } })).toBe(1);
  });
});
