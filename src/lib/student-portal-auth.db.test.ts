import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { protectCommerceOrderPii } from "@/lib/commerce-order-pii";
import { studentPortalVoucherProductWhere } from "@/lib/student-portal-voucher";
import { getStudentPortalDashboard } from "@/lib/student-portal";
import { consumeStudentPortalAccessToken, createStudentPortalAccessToken } from "@/lib/student-portal-auth";

const vendors: string[] = [];
const db = getDb();
const now = new Date("2026-10-04T12:00:00Z");

async function vendor() {
  const suffix = randomUUID();
  const row = await db.vendor.create({ data: { name: "Synthetic portal owner", slug: `portal-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(row.id);
  return row;
}

async function order(vendorId: string, email: string) {
  const id = randomUUID();
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic student", email }, shipping: null }, { vendorId, orderId: id });
  return db.commerceOrder.create({ data: {
    id, vendorId, automationCustomerKeyHash: automationCustomerKeyHash(vendorId, email),
    orderNumber: id, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 10000, totalAmountCents: 10000, paidAmountCents: 10000,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked,
  } });
}

beforeEach(() => vi.stubEnv("CSRF_SECRET", "synthetic-student-portal-database-test-key-only"));
afterEach(async () => {
  await db.automationVoucherGrant.deleteMany({ where: { vendorId: { in: vendors } } });
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
  vi.unstubAllEnvs();
});

describe("student portal PostgreSQL boundaries", () => {
  it("lets exactly one of twelve concurrent consumers claim the capability", async () => {
    const owner = await vendor();
    const token = await createStudentPortalAccessToken(db, { vendorId: owner.id, email: "learner@example.test", purpose: "magic_link", now });
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeStudentPortalAccessToken(db, { token, expectedPurpose: "magic_link", now })));
    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await db.studentPortalAccessToken.findMany({ where: { vendorId: owner.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.consumedAt).toEqual(now);
    expect(rows[0]?.tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(rows[0]?.tokenHash === token).toBe(false);
    expect(JSON.stringify(rows).includes("learner@example.test")).toBe(false);
    await expect(consumeStudentPortalAccessToken(db, { token, expectedPurpose: "magic_link", now })).resolves.toBeNull();
  });

  it("does not consume a record rebound to another tenant or student", async () => {
    const a = await vendor(); const b = await vendor();
    const token = await createStudentPortalAccessToken(db, { vendorId: a.id, email: "learner@example.test", purpose: "magic_link", now });
    const row = await db.studentPortalAccessToken.findFirstOrThrow({ where: { vendorId: a.id } });
    await db.studentPortalAccessToken.update({ where: { id: row.id }, data: { vendorId: b.id } });
    await expect(consumeStudentPortalAccessToken(db, { token, expectedPurpose: "magic_link", now })).resolves.toBeNull();
    await db.studentPortalAccessToken.update({ where: { id: row.id }, data: { vendorId: a.id, customerKeyHash: automationCustomerKeyHash(a.id, "other@example.test") } });
    await expect(consumeStudentPortalAccessToken(db, { token, expectedPurpose: "magic_link", now })).resolves.toBeNull();
    expect((await db.studentPortalAccessToken.findUniqueOrThrow({ where: { id: row.id } })).consumedAt).toBeNull();
  });

  it("rejects purpose confusion and the exact expiry boundary without burning valid state", async () => {
    const owner = await vendor();
    const token = await createStudentPortalAccessToken(db, { vendorId: owner.id, email: "learner@example.test", purpose: "magic_link", now });
    await expect(consumeStudentPortalAccessToken(db, { token, expectedPurpose: "checkout_redirect", now })).resolves.toBeNull();
    await expect(consumeStudentPortalAccessToken(db, { token, expectedPurpose: "magic_link", now: new Date(now.getTime() + 900_000) })).resolves.toBeNull();
    expect((await db.studentPortalAccessToken.findFirstOrThrow({ where: { vendorId: owner.id } })).consumedAt).toBeNull();
  });

  it("enforces unique digests, lifetime checks and vendor ownership at the database boundary", async () => {
    const owner = await vendor();
    await createStudentPortalAccessToken(db, { vendorId: owner.id, email: "learner@example.test", purpose: "magic_link", now });
    const row = await db.studentPortalAccessToken.findFirstOrThrow({ where: { vendorId: owner.id } });
    const data = { ...row, id: undefined };
    await expect(db.studentPortalAccessToken.create({ data })).rejects.toMatchObject({ code: "P2002" });
    await expect(db.studentPortalAccessToken.create({ data: { ...data, tokenHash: "b".repeat(43), vendorId: randomUUID() } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.studentPortalAccessToken.create({ data: { ...data, tokenHash: "c".repeat(43), expiresAt: new Date(now.getTime() + 901_000) } })).rejects.toThrow();
    expect(await db.studentPortalAccessToken.count({ where: { vendorId: owner.id } })).toBe(1);
  });

  it("returns only the authenticated tenant/customer orders with actual database joins", async () => {
    const a = await vendor(); const b = await vendor();
    const own = await order(a.id, "learner@example.test");
    await order(a.id, "other@example.test"); await order(b.id, "learner@example.test");
    const dashboard = await getStudentPortalDashboard(db, { vendorId: a.id, customerKeyHash: automationCustomerKeyHash(a.id, "learner@example.test") }, now);
    expect(dashboard.orders.map((item) => item.id)).toEqual([own.id]);
    expect(dashboard.courses).toEqual([]);
    expect(dashboard.consultations).toEqual([]);
    expect(dashboard.vouchers).toEqual([]);
  });

  it("enables RLS with no public policies on the capability table", async () => {
    const rows = await db.$queryRaw<Array<{ relrowsecurity: boolean; policies: bigint }>>`
      SELECT c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c WHERE c.oid = '"StudentPortalAccessToken"'::regclass
    `;
    expect(rows).toEqual([{ relrowsecurity: true, policies: BigInt(0) }]);
  });
});

describe("portal vouchers follow live product availability", () => {
  it.each([
    { name: "currency changed", data: { currency: "USD" } },
    { name: "inactive", data: { isActive: false } },
    { name: "external checkout", data: { checkoutUrl: "https://checkout.example.test" } },
    { name: "unconfirmed fulfillment", data: { fulfillmentTypeConfirmed: false } },
    { name: "missing delivery", data: { fulfillmentType: "course" as const } },
    { name: "no inventory", data: { inventory: 0 } },
    { name: "invalid price", data: { priceCents: 0 } },
  ])("hides and refuses bearer rotation for $name", async ({ data }) => {
    const owner = await vendor();
    const customerKeyHash = automationCustomerKeyHash(owner.id, "learner@example.test");
    const product = await db.product.create({ data: { vendorId: owner.id, name: "Synthetic voucher product", slug: randomUUID(), priceCents: 1000, inventory: 10 } });
    const voucher = await db.automationVoucherGrant.create({ data: { vendorId: owner.id, productId: product.id, customerKeyHash, claimTokenHash: randomUUID(), discountType: "percentage", discountValue: 10, expiresAt: new Date(now.getTime() + 86_400_000) } });
    const scope = { vendorId: owner.id, customerKeyHash };
    expect((await getStudentPortalDashboard(db, scope, now)).vouchers.map((row) => row.id)).toEqual([voucher.id]);
    await db.product.update({ where: { id: product.id }, data });
    expect((await getStudentPortalDashboard(db, scope, now)).vouchers).toEqual([]);
    const result = await db.automationVoucherGrant.updateMany({ where: { id: voucher.id, ...scope, product: { is: { ...studentPortalVoucherProductWhere(owner.id), currency: voucher.currency } } }, data: { claimTokenHash: randomUUID() } });
    expect(result.count).toBe(0);
    expect((await db.automationVoucherGrant.findUniqueOrThrow({ where: { id: voucher.id } })).claimTokenHash).toBe(voucher.claimTokenHash);
    await db.product.update({ where: { id: product.id }, data: { isActive: true, checkoutUrl: null, fulfillmentTypeConfirmed: true, fulfillmentType: "physical", inventory: 10, priceCents: 1000, currency: "TWD" } });
    expect((await getStudentPortalDashboard(db, scope, now)).vouchers.map((row) => row.id)).toEqual([voucher.id]);
    expect((await db.automationVoucherGrant.updateMany({ where: { id: voucher.id, ...scope, product: { is: { ...studentPortalVoucherProductWhere(owner.id), currency: voucher.currency } } }, data: { claimTokenHash: randomUUID() } })).count).toBe(1);
  });
});
