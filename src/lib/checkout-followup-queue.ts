import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CommerceOrderPiiValidationError, revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { createEmailUnsubscribeUrl, protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { captureOperationalError } from "@/lib/monitoring";
import {
  CHECKOUT_FOLLOWUP_TRIGGER, CHECKOUT_FOLLOWUP_DELAY_MS, CHECKOUT_FOLLOWUP_WINDOW_MS,
  checkoutFollowupDeliveryKey, checkoutFollowupDeliveryId, isCurrentCheckoutFollowupDelivery,
} from "@/lib/checkout-followup";

type QueueDb = Pick<PrismaClient, "$queryRaw" | "$transaction" | "automationExecutionLog">;
type Pair = { vendorId: string; orderId: string; eventId: string; ruleId: string; ruleVersion: number };
const RETRY_MS = 5 * 60_000;

/** Recover delayed source facts using the existing job/outbox/ledger. Exclude
 * completed pairs before LIMIT, so repeated runs advance beyond the first batch.
 * Failed pairs cool down independently; no customer data is selected here. */
export async function processDueCheckoutFollowups(db: QueueDb, options: { limit?: number; now?: Date } = {}) {
  const limit = z.number().int().min(1).max(100).parse(options.limit ?? 50);
  const now = z.date().parse(options.now ?? new Date());
  const matureBefore = new Date(now.getTime() - CHECKOUT_FOLLOWUP_DELAY_MS);
  const oldest = new Date(now.getTime() - CHECKOUT_FOLLOWUP_WINDOW_MS);
  const retryBefore = new Date(now.getTime() - RETRY_MS);
  const pairs = await db.$queryRaw<Pair[]>(Prisma.sql`
    SELECT e."vendorId", e."orderId", e.id AS "eventId", r.id AS "ruleId", r.version AS "ruleVersion"
    FROM "CommerceOrderEvent" e
    JOIN "CommerceOrder" o ON o."vendorId" = e."vendorId" AND o.id = e."orderId"
    JOIN "PaymentTransaction" p ON p."vendorId" = o."vendorId" AND p.id = o."primaryPaymentTransactionId"
    JOIN LATERAL (
      SELECT r.* FROM "AutomationRule" r WHERE r."vendorId" = e."vendorId"
        AND r.trigger = 'checkout_incomplete' AND r."isActive" = true AND r."funnelPageId" IS NULL
        AND r."createdAt" <= e."createdAt" AND r."updatedAt" <= e."createdAt" AND r.version BETWEEN 1 AND 2147483647
        AND r.condition = '{"type":"order_pending_payment"}'::jsonb
        AND r.actions = '[{"type":"send_email_notification","template":"checkout_followup"}]'::jsonb
        AND r.id ~ '^[A-Za-z0-9_-]{1,128}$'
        AND length('wp18-checkout-v1:' || e."orderId" || ':' || r.id || ':' || r.version::text) <= 256
      ORDER BY r."createdAt", r.id LIMIT 1
    ) r ON true
    LEFT JOIN "AutomationExecutionLog" attempt ON attempt."vendorId" = e."vendorId"
      AND attempt."idempotencyKey" = 'wp18-checkout-v1:' || e."orderId" || ':' || r.id || ':' || r.version::text
    WHERE e."eventType" = 'checkout_incomplete_candidate' AND e."actorType" = 'system'
      AND e."dedupKey" = 'checkout-followup-candidate:v1'
      AND e."createdAt" <= (${matureBefore.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND e."createdAt" >= (${oldest.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND o.status = 'pending_payment' AND o."paidAt" IS NULL
      AND o."paidAmountCents" = 0 AND o."refundedAmountCents" = 0 AND o."totalAmountCents" > 0 AND p.status = 'pending'
      AND e."vendorId" ~ '^[A-Za-z0-9_-]{1,128}$' AND e."orderId" ~ '^[A-Za-z0-9_-]{1,128}$'
      AND NOT EXISTS (SELECT 1 FROM "EmailDelivery" d WHERE d."vendorId" = e."vendorId"
        AND d.id = 'wp18-checkout-' || encode(sha256(convert_to(e."vendorId" || chr(10) || e."orderId", 'UTF8')), 'hex'))
      AND NOT EXISTS (SELECT 1 FROM "AutomationExecutionLog" l WHERE l."vendorId" = e."vendorId"
        AND l."idempotencyKey" = 'wp18-checkout-v1:' || e."orderId" || ':' || r.id || ':' || r.version::text
        AND (l.status IN ('completed', 'skipped') OR l."startedAt" > (${retryBefore.toISOString()}::timestamptz AT TIME ZONE 'UTC')))
    ORDER BY attempt."startedAt" NULLS FIRST, e."createdAt", e.id, r.id LIMIT ${limit}
  `);
  const results: Array<{ status: string }> = [];
  for (const pair of pairs) {
    // A DB row is still untrusted input for the existing Email transport limit.
    let key: string;
    try { key = checkoutFollowupDeliveryKey(pairReference(pair)); }
    catch { results.push({ status: "invalid_snapshot" }); continue; }
    try {
      const result = await db.$transaction(async tx => {
        // Only this source event is locked. Concurrent workers skip it; the
        // durable unique outbox key also protects replay after a lost response.
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM "CommerceOrderEvent" WHERE id = ${pair.eventId}
            AND "vendorId" = ${pair.vendorId} AND "orderId" = ${pair.orderId}
          FOR UPDATE SKIP LOCKED
        `);
        if (locked.length !== 1) return "claimed_elsewhere";
        const id = checkoutFollowupDeliveryId({ vendorId: pair.vendorId, orderId: pair.orderId });
        const priorDelivery = await tx.emailDelivery.findUnique({
          where: { id },
          select: { id: true },
        });
        if (priorDelivery) return "duplicate";
        const previous = await tx.automationExecutionLog.findUnique({
          where: { vendorId_idempotencyKey: { vendorId: pair.vendorId, idempotencyKey: key } },
          select: { status: true, startedAt: true },
        });
        if (previous && (previous.status === "completed" || previous.status === "skipped"
          || previous.startedAt > retryBefore)) return "duplicate";
        const order = await tx.commerceOrder.findFirst({
          where: { id: pair.orderId, vendorId: pair.vendorId }, select: { buyerEncryptedEnvelope: true },
        });
        const markSuperseded = (errorCode = "source_superseded") => tx.automationExecutionLog.upsert({
          where: { vendorId_idempotencyKey: { vendorId: pair.vendorId, idempotencyKey: key } },
          create: { ...logIdentity(pair, key), status: "skipped", conditionMatched: false, startedAt: now, completedAt: now, errorCode },
          update: { status: "skipped", conditionMatched: false, completedAt: now, errorCode },
        });
        if (!order) { await markSuperseded(); return "superseded"; }
        let pii;
        try { pii = revealCommerceOrderPii({ buyerEncrypted: order.buyerEncryptedEnvelope, shippingEncrypted: null },
          { vendorId: pair.vendorId, orderId: pair.orderId }); }
        catch (error) {
          if (!(error instanceof CommerceOrderPiiValidationError)) throw error;
          await markSuperseded("invalid_recipient"); return "superseded";
        }
        const payload = protectEmailDeliveryPayload({ recipientEmail: pii.buyer.email,
          subject: "您的結帳尚未完成",
          body: `您有一筆仍待付款的訂單。如需繼續，請回到原結帳頁確認目前狀態與付款方式；若不再需要，可忽略此提醒。請勿因本通知重複建立訂單。\n\n取消訂閱：${createEmailUnsubscribeUrl(id)}`,
        }, { vendorId: pair.vendorId, deliveryId: id });
        if (!await isCurrentCheckoutFollowupDelivery({ vendorId: pair.vendorId, trigger: CHECKOUT_FOLLOWUP_TRIGGER,
          idempotencyKey: key, recipientHash: payload.recipientHash }, tx, now)) {
          await markSuperseded(); return "superseded";
        }
        await tx.emailDelivery.create({ data: { id, vendorId: pair.vendorId,
          sourceTemplateId: "automation_checkout_followup_v1", trigger: CHECKOUT_FOLLOWUP_TRIGGER,
          ...payload, idempotencyKey: key, status: "queued", nextAttemptAt: now } });
        // Queue and execution receipt commit together. A failed transaction
        // cannot report completed without its encrypted outbox row.
        const completed = { status: "completed", conditionMatched: true, completedAt: now,
          errorCode: null, actionResults: [{ type: "send_email_notification", status: "queued", template: "checkout_followup" }] };
        await tx.automationExecutionLog.upsert({
          where: { vendorId_idempotencyKey: { vendorId: pair.vendorId, idempotencyKey: key } },
          create: { ...logIdentity(pair, key), ...completed, startedAt: now }, update: completed,
        });
        return "queued";
      });
      results.push({ status: result });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        results.push({ status: "duplicate" }); continue;
      }
      // Persist only a fixed failure code and opaque identities. Cooldown lets
      // other candidates advance even if one encrypted source is unreadable.
      try { captureOperationalError(new Error("Checkout follow-up materialization unavailable"),
        { source: "checkout_followup", operation: "materialize", status: "failed" }); }
      catch { /* Diagnostic failure cannot authorize a delivery. */ }
      try {
        await db.automationExecutionLog.upsert({
        where: { vendorId_idempotencyKey: { vendorId: pair.vendorId, idempotencyKey: key } },
        create: { ...logIdentity(pair, key), status: "failed", startedAt: now, errorCode: "checkout_materialization_failed" }, update: {},
        });
        await db.automationExecutionLog.updateMany({
        where: { vendorId: pair.vendorId, idempotencyKey: key, status: "failed" },
        data: { startedAt: now, errorCode: "checkout_materialization_failed" },
        });
      } catch { /* A failed failure receipt must not discard later pairs. */ }
      results.push({ status: "failed" });
    }
  }
  return results;
}

function pairReference(pair: Pair) { return { orderId: pair.orderId, ruleId: pair.ruleId, ruleVersion: pair.ruleVersion }; }
function logIdentity(pair: Pair, key: string) {
  return { vendorId: pair.vendorId, ruleId: pair.ruleId, idempotencyKey: key, eventId: pair.eventId,
    trigger: "checkout_incomplete", subjectType: "buyer_order",
    subjectKeyHash: createHash("sha256").update(`${pair.vendorId}\n${pair.orderId}`).digest("base64url") };
}
