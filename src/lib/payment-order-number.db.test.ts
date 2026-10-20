import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";
import { generatePaymentOrderNumber, isPaymentOrderNumberConflict, withPaymentOrderNumberRetry } from "@/lib/payment-order-number";

const vendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function vendor(label: string) {
  const suffix = randomUUID();
  const created = await getDb().vendor.create({ data: { name: `Order number ${label}`, slug: `order-number-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(created.id);
  return created;
}

describe("PaymentTransaction (providerName, orderNumber) uniqueness (F-050)", () => {
  it("rejects the same provider order number across tenants and lets the creator retry once", async () => {
    const db = getDb();
    const [first, second] = [await vendor("A"), await vendor("B")];
    const taken = generatePaymentOrderNumber();
    await db.paymentTransaction.create({ data: { vendorId: first.id, providerName: "payuni", orderNumber: taken, status: "pending" } });

    const collision = await db.paymentTransaction.create({ data: { vendorId: second.id, providerName: "payuni", orderNumber: taken, status: "pending" } })
      .then(() => null, (error: unknown) => error);
    expect(isPaymentOrderNumberConflict(collision)).toBe(true);

    const fresh = generatePaymentOrderNumber();
    const numbers = [taken, fresh];
    const created = await withPaymentOrderNumberRetry(
      (orderNumber) => db.$transaction((tx) => tx.paymentTransaction.create({ data: { vendorId: second.id, providerName: "payuni", orderNumber, status: "pending" } })),
      () => numbers.shift()!,
    );
    expect(created.orderNumber).toBe(fresh);
    expect(await db.paymentTransaction.count({ where: { providerName: "payuni", orderNumber: taken } })).toBe(1);
  });

  it("keeps provider namespaces and NULL order numbers independent", async () => {
    const db = getDb();
    const tenant = await vendor("C");
    const shared = generatePaymentOrderNumber();
    await db.paymentTransaction.create({ data: { vendorId: tenant.id, providerName: "payuni", orderNumber: shared } });
    await db.paymentTransaction.create({ data: { vendorId: tenant.id, providerName: "demo", orderNumber: shared } });
    await db.paymentTransaction.create({ data: { vendorId: tenant.id, providerName: "payuni", orderNumber: null } });
    await db.paymentTransaction.create({ data: { vendorId: tenant.id, providerName: "payuni", orderNumber: null } });
    expect(await db.paymentTransaction.count({ where: { vendorId: tenant.id } })).toBe(4);
  });

  it("serves the vendor-less webhook lookup from the unique index", async () => {
    const [row] = await getDb().$queryRaw<Array<{ definition: string }>>`
      SELECT pg_catalog.pg_get_indexdef(to_regclass('"PaymentTransaction_providerName_orderNumber_key"')) AS definition`;
    expect(row?.definition).toMatch(/^CREATE UNIQUE INDEX "PaymentTransaction_providerName_orderNumber_key" ON \w+\."PaymentTransaction" USING btree \("providerName", "orderNumber"\)$/);
  });
});
