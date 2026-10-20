import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db";
import { generatePaymentOrderNumber } from "@/lib/payment-order-number";
import { PaymentWebhookPayload, processPaymentWebhook } from "@/lib/payment-webhooks";

const db = getDb();
const vendorIds: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function pendingPayUniCheckout(grossAmountCents: number) {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Fee", slug: `fee-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const transaction = await db.paymentTransaction.create({
    data: {
      vendorId: vendor.id, providerName: "payuni", orderNumber: generatePaymentOrderNumber(), providerTradeNo: `trade-${suffix}`,
      grossAmountCents, netAmountCents: grossAmountCents, currency: "TWD", status: "pending", metadata: {},
    },
  });
  return { vendor, transaction };
}

function paid(vendorId: string, orderNumber: string, grossAmountCents: number, extra: Record<string, unknown> = {}) {
  return PaymentWebhookPayload.parse({
    provider: "payuni", eventId: `synthetic-${randomUUID()}`, eventType: "paid", vendorId, orderNumber,
    grossAmountCents, currency: "TWD", ...extra,
  });
}

describe("PayUni gateway fee through the webhook pipeline (F-040)", () => {
  it("writes the contract-rate fee once in whole NT$ and keeps it on later fee-less paid events", async () => {
    const { vendor, transaction } = await pendingPayUniCheckout(120_000);
    await processPaymentWebhook(paid(vendor.id, transaction.orderNumber!, 120_000));
    const first = await db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } });
    expect(first).toMatchObject({ status: "paid", gatewayFeeCents: 3_500, netAmountCents: 116_500, metadata: { feeSource: "contract_rate" } });

    // A notify resend or admin retry under a changed env rate must not rewrite the stored fee.
    vi.stubEnv("PAYUNI_CREDIT_FEE_BPS", "200");
    await processPaymentWebhook(paid(vendor.id, transaction.orderNumber!, 120_000));
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } }))
      .resolves.toMatchObject({ gatewayFeeCents: 3_500, netAmountCents: 116_500, metadata: { feeSource: "contract_rate" } });

    // A provider-reported fee wins, and is then itself kept.
    await processPaymentWebhook(paid(vendor.id, transaction.orderNumber!, 120_000, { gatewayFeeCents: 3_000, netAmountCents: 117_000 }));
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } }))
      .resolves.toMatchObject({ gatewayFeeCents: 3_000, netAmountCents: 117_000, metadata: { feeSource: "provider" } });
    await processPaymentWebhook(paid(vendor.id, transaction.orderNumber!, 120_000));
    await expect(db.paymentTransaction.findUniqueOrThrow({ where: { id: transaction.id } }))
      .resolves.toMatchObject({ gatewayFeeCents: 3_000, netAmountCents: 117_000, metadata: { feeSource: "provider" } });
  });
});
