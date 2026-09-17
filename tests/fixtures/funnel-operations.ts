import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";

/** Synthetic trusted projection, not a provider payment or a simulated checkout response. */
export async function createFunnelSalesProjectionFixture(db: PrismaClient, input: { vendorId: string; projectId: string; pageId: string; stepId: string; runKey: string }) {
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  const orderNumber = `TEST_ONLY_PAID_${input.runKey}`;
  const payment = await db.paymentTransaction.create({ data: {
    vendorId: input.vendorId, providerName: "demo", orderNumber, paymentMode: "platform",
    grossAmountCents: 123400, netAmountCents: 123400, currency: "TWD", status: "paid",
    metadata: { funnel: { pageId: input.pageId, stepId: input.stepId }, testEvidence: "synthetic database projection only" },
  } });
  await db.commerceOrder.create({ data: {
    vendorId: input.vendorId, projectId: input.projectId, primaryPaymentTransactionId: payment.id,
    orderNumber, checkoutIdempotencyKey: `test-only-${input.runKey}`, checkoutIdentityHash: createHash("sha256").update(`test-only-${input.runKey}`).digest("base64url"),
    status: "partially_refunded", currency: "TWD", subtotalAmountCents: 123400, totalAmountCents: 123400,
    paidAmountCents: 123400, refundedAmountCents: 23400, paidAt: new Date(),
    // Reports select no PII. These sentinel values cannot be used as buyer envelopes.
    buyerEncryptedEnvelope: "TEST_ONLY_NO_BUYER_DATA", buyerMaskedName: "TEST ONLY", buyerMaskedEmail: "TEST ONLY",
  } });
  await db.analyticsEvent.create({ data: {
    vendorId: input.vendorId, projectId: input.projectId, visitorId: "test-only-client-event",
    eventType: "purchase", trustLevel: "LEGACY_UNVERIFIED", payload: { pageId: input.pageId, amountCents: 99999999, orderNumber: "TEST_ONLY_FAKE_PURCHASE" },
  } });
  return { orderNumber, paymentId: payment.id };
}

