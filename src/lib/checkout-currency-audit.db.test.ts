import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { recordUnsupportedCurrencyRefusal, UNSUPPORTED_CURRENCY_AUDIT_ACTION } from "@/lib/checkout-currency-audit";

const db = getDb();

describe("unsupported-currency audit throttle on PostgreSQL (F-041)", () => {
  it("records one row per target and action per hour and leaves other targets alone", async () => {
    const suffix = randomUUID();
    const vendor = await db.vendor.create({ data: { name: "Synthetic audit shop", slug: `currency-audit-${suffix}`, email: `currency-audit-${suffix}@example.test`, passwordHash: "synthetic-only" } });
    const productId = `synthetic-product-${suffix}`;
    const otherProductId = `synthetic-other-${suffix}`;
    const refusal = (targetId: string) => ({ vendorId: vendor.id, targetType: "Product" as const, targetId, currency: "USD", surface: "checkout_product" as const });
    const rows = (targetId: string) => db.auditLog.count({ where: { targetType: "Product", targetId, action: UNSUPPORTED_CURRENCY_AUDIT_ACTION } });

    await recordUnsupportedCurrencyRefusal(refusal(productId));
    await recordUnsupportedCurrencyRefusal(refusal(productId));
    await recordUnsupportedCurrencyRefusal(refusal(productId));
    expect(await rows(productId)).toBe(1);

    await recordUnsupportedCurrencyRefusal(refusal(otherProductId));
    expect(await rows(otherProductId)).toBe(1);

    // Once the earlier row is outside the one-hour window, the next refusal is recorded.
    await db.auditLog.updateMany({ where: { targetType: "Product", targetId: productId, action: UNSUPPORTED_CURRENCY_AUDIT_ACTION }, data: { createdAt: new Date(Date.now() - 61 * 60 * 1000) } });
    await recordUnsupportedCurrencyRefusal(refusal(productId));
    expect(await rows(productId)).toBe(2);
  });
});
