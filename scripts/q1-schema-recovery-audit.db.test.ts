import { expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import { ensureWp4SandboxFixture, WP4_SANDBOX_FIXTURE as fixed } from "../src/lib/wp4-sandbox-fixture";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";
import { EXACT_SOURCE } from "./q1-exact-state-details";
import { readSchemaRecoveryAudit } from "./q1-schema-recovery";

it("reads actual distinct original/recovery/scheduler actors and durable marker only for the fixed original event", async () => {
  const db = getDb(), audits: string[] = [];
  await ensureWp4SandboxFixture(db);
  try {
    const payment = await db.paymentTransaction.create({ data: { vendorId: fixed.vendorId, providerName: "payuni",
      orderNumber: "synthetic-original-schema-audit", grossAmountCents: 100, currency: "TWD", status: "pending",
      checkoutIdempotencyKey: wp4HistoricalBuyerWhere(EXACT_SOURCE).checkoutIdempotencyKey,
      metadata: { wp4SourceCommit: EXACT_SOURCE, billingPurpose: "buyer_order", productId: fixed.productId,
        wp4PaymentSubmissionReserved: true, wp4CallbackRetryReserved: true } } });
    const event = await db.webhookEvent.create({ data: { vendorId: fixed.vendorId, provider: "payuni", eventType: "paid",
      eventId: "synthetic-original-schema-audit-paid", status: "failed", retryCount: 3, maxRetries: 5,
      payload: { normalized: { orderNumber: payment.orderNumber } } } });
    async function audit(actor: string, targetId = event.id) {
      const row = await db.auditLog.create({ data: { vendorId: fixed.vendorId, targetType: "WebhookEvent", targetId,
        actorLabel: actor, action: "synthetic-audit" } }); audits.push(row.id);
    }
    await audit("wp4_sandbox_fixed_callback_retry");
    await audit("job:webhook-retry", "another-synthetic-event");
    await expect(readSchemaRecoveryAudit(db)).resolves.toEqual({ total: 1, fixed: 1, recovery: 0, scheduler: 0, paid: 0,
      retryCount: 3, maxRetries: 5, recoveryReserved: false });
    await audit("q1_sandbox_schema_recovery");
    const paid = await db.auditLog.create({ data: { vendorId: fixed.vendorId, targetType: "WebhookEvent", targetId: event.id,
      actorLabel: "webhook:payuni", action: "payment_webhook_paid" } }); audits.push(paid.id);
    await db.paymentTransaction.update({ where: { id: payment.id }, data: { metadata: {
      ...(payment.metadata as Record<string, string | boolean>), q1SchemaRecoveryReserved: true } } });
    await db.webhookEvent.update({ where: { id: event.id }, data: { retryCount: 4, status: "processed" } });
    await expect(readSchemaRecoveryAudit(db)).resolves.toEqual({ total: 3, fixed: 1, recovery: 1, scheduler: 0, paid: 1,
      retryCount: 4, maxRetries: 5, recoveryReserved: true });
    await audit("job:webhook-retry");
    await expect(readSchemaRecoveryAudit(db)).resolves.toMatchObject({ total: 4, scheduler: 1, paid: 1 });
  } finally {
    await db.auditLog.deleteMany({ where: { id: { in: audits } } });
    await db.vendor.deleteMany({ where: { id: fixed.vendorId } });
    await db.user.deleteMany({ where: { id: fixed.userId } });
    await db.billingPlan.deleteMany({ where: { id: fixed.planId } });
  }
});
