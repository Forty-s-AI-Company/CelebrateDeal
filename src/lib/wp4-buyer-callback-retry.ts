import { Prisma, type PrismaClient, type PaymentTransaction, type WebhookEvent } from "@prisma/client";
import { PaymentWebhookPayload, type PaymentWebhookPayloadInput } from "./payment-webhooks";
import { retryWebhookEvent } from "./webhook-retry";
import { wp4HistoricalBuyerWhere, WP4_BUYER_CONTINUATION_SOURCE } from "./wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";

/** Every supplied provider selector must agree with the server-owned payment. */
function matchesFixedPayment(payload: PaymentWebhookPayloadInput,
  event: Pick<WebhookEvent, "eventId" | "vendorId">,
  payment: Pick<PaymentTransaction, "vendorId" | "orderNumber" | "providerTradeNo" | "grossAmountCents" | "currency">) {
  return payload.provider === "payuni" && payload.eventId === event.eventId && payload.eventType === "paid"
    && (event.vendorId === null || event.vendorId === payment.vendorId)
    && (payload.vendorId === undefined || payload.vendorId === payment.vendorId)
    && payload.orderNumber === payment.orderNumber
    && (payload.vendorSlug === undefined || payload.vendorSlug === WP4_SANDBOX_FIXTURE.vendorSlug)
    && (payload.providerTradeNo === undefined || payment.providerTradeNo === null || payload.providerTradeNo === payment.providerTradeNo)
    && payload.grossAmountCents === payment.grossAmountCents
    && (payload.currency === undefined || payload.currency === payment.currency);
}
async function schemaRecoveryEligible(tx: Prisma.TransactionClient, source: string, payment: PaymentTransaction, event: WebhookEvent, parsed: { data: PaymentWebhookPayloadInput }) {

  // This is a new, fixed recovery after an observed schema repair, not a
  // reset of the earlier reservation or a general scheduler retry.
  if (source !== "9acfe8d2dba62430e950cff2c0387841ab91f44b" || payment.status !== "pending"
    || payment.refundedAmountCents !== 0 || event.retryCount !== 3 || event.maxRetries !== 5
    || !parsed.data.providerTradeNo?.trim()) return false;
  const ledger = await tx.$queryRaw<{ checksum: string }[]>(Prisma.sql`
    SELECT checksum FROM "_prisma_migrations"
    WHERE migration_name='20261006120000_merchant_affiliate_policy_snapshots'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  if (ledger.length !== 1 || ledger[0]!.checksum !== "1dc83cfe4e3db8d6116c116e6e918625f125ccc802bed306d3f85a076132c3dd"
    || await tx.refundRecord.count({ where: { paymentTransactionId: payment.id } }) !== 0) return false;
  const audit = await tx.$queryRaw<{ total: number; fixed: number }[]>(Prisma.sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "actorLabel"='wp4_sandbox_fixed_callback_retry')::int AS fixed
    FROM "AuditLog" WHERE "targetType"='WebhookEvent' AND "targetId"=${event.id}
      AND "createdAt">=${new Date("2026-10-10T06:43:34Z")}`);
  if (audit.length !== 1 || audit[0]!.total !== 1 || audit[0]!.fixed !== 1) return false;
  return true;
}

/** Reserve one retry durably before dispatch; a lost response cannot reopen it. */
async function retryFixedBuyerCallback(db: Pick<PrismaClient, "$transaction">, source: string, schemaRecovery = false) {
  const reserved = await db.$transaction(async tx => {
    const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(source), take: 2 });
    if (payments.length !== 1) return { status: payments.length ? "CANDIDATE_AMBIGUOUS" : "FIXTURE_UNAVAILABLE" };
    const payment = payments[0]!;
    if (!payment.orderNumber) return { status: "EVENT_UNAVAILABLE" };
    // Initial verified PayUni callbacks have no tenant projection until processing succeeds.
    // Resolve by the authoritative fixed payment; explicit conflicting scope still fails.
    const events = await tx.webhookEvent.findMany({ where: { provider: "payuni", eventType: "paid",
      payload: { path: ["normalized", "orderNumber"], equals: payment.orderNumber } }, take: 2 });
    if (events.length !== 1) return { status: "EVENT_UNAVAILABLE" };
    const event = events[0]!;
    const envelope = event.payload;
    const normalized = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope.normalized : null;
    const parsed = PaymentWebhookPayload.safeParse(normalized);
    if (!parsed.success || !matchesFixedPayment(parsed.data, event, payment)) return { status: "RETRY_REJECTED" };
    if (parsed.data.vendorSlug !== undefined) {
      const vendor = await tx.vendor.findUnique({ where: { id: payment.vendorId }, select: { slug: true } });
      if (!vendor || vendor.slug !== parsed.data.vendorSlug) return { status: "RETRY_REJECTED" };
    }
    if (event.status === "processed") return { status: "ALREADY_PROCESSED" };
    const metadata = payment.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
      || (schemaRecovery ? metadata.wp4CallbackRetryReserved !== true || metadata.q1SchemaRecoveryReserved === true : metadata.wp4CallbackRetryReserved === true)
      || event.status !== "failed" || !Number.isSafeInteger(event.retryCount) || !Number.isSafeInteger(event.maxRetries)
      || event.retryCount < 0 || event.maxRetries <= 0 || event.retryCount >= event.maxRetries) return { status: "RETRY_REJECTED" };
    if (schemaRecovery && !await schemaRecoveryEligible(tx, source, payment, event, parsed)) return { status: "RETRY_REJECTED" };
    // NotifyURL and ReturnURL can already have consumed retries. The actual remaining
    // event budget governs eligibility; the payment marker and CAS still allow only
    // one fixed recovery. Never reset or increase the provider event's retry budget.
    const updatedAt = new Date();
    const fenced = await tx.webhookEvent.updateMany({ where: { id: event.id, status: "failed", retryCount: event.retryCount, updatedAt: event.updatedAt }, data: { updatedAt } });
    if (fenced.count !== 1) return { status: "RETRY_REJECTED" };
    await tx.paymentTransaction.update({ where: { id: payment.id, vendorId: WP4_SANDBOX_FIXTURE.vendorId },
      data: { metadata: { ...metadata, wp4CallbackRetryReserved: true,
        ...(schemaRecovery ? { q1SchemaRecoveryReserved: true } : {}) } as Prisma.InputJsonObject } });
    return { status: "RESERVED", eventId: event.id, expectedVersion: { retryCount: event.retryCount, updatedAt,
      paymentScope: { vendorId: payment.vendorId, paymentTransactionId: payment.id, providerName: payment.providerName, orderNumber: payment.orderNumber } } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch(error => {
    // A competing serializable reservation is a rejected retry, not a new dispatch.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { status: "RETRY_REJECTED", eventId: undefined, expectedVersion: undefined };
    }
    throw error;
  });
  if (reserved.status !== "RESERVED" || !reserved.eventId) return { status: reserved.status, retryAttempts: 0, failureCode: reserved.status === "ALREADY_PROCESSED" ? "NONE" : "UNKNOWN" };
  try {
    const outcome = await retryWebhookEvent(reserved.eventId, schemaRecovery ? "q1_sandbox_schema_recovery" : "wp4_sandbox_fixed_callback_retry", reserved.expectedVersion);
    return outcome.status === "processed" ? { status: "PROCESSED", retryAttempts: 1, failureCode: "NONE" }
      : { status: "RETRY_FAILED", retryAttempts: 1, failureCode: "errorCode" in outcome ? outcome.errorCode ?? "processing_failed" : "processing_failed" };
  } catch { return { status: "RETRY_FAILED", retryAttempts: 1, failureCode: "processing_failed" }; }
}

/** Preserve the previously delivered historical recovery scope. */
export function retryWp4HistoricalBuyerCallback(db: Pick<PrismaClient, "$transaction">) {
  return retryFixedBuyerCallback(db, WP4_BUYER_CONTINUATION_SOURCE);
}

/** Original Q1 payment is catalog-owned; callers cannot supply a source or ID.
 * Replays only its existing verified callback, never submits another payment. */
export function retryQ1OriginalBuyerCallback(db: Pick<PrismaClient, "$transaction">) {
  return retryFixedBuyerCallback(db, "9acfe8d2dba62430e950cff2c0387841ab91f44b");
}

/** No caller-selected order, source or budget. Preflight runs in the deployed
 * process and uses its actual crypto binding. Reservation remains durable even
 * if dispatch fails or the HTTP response is lost. */
export async function retryQ1OriginalAfterSchemaRepair(db: Pick<PrismaClient, "$transaction">) {
  const { readQ1Downstream, Q1_DOWNSTREAM_MODELS } = await import("./q1-downstream-readonly");
  const probe = await readQ1Downstream(db);
  if (probe.classification !== "DOWNSTREAM_OBSERVED" || probe.decrypt !== "OK" || probe.protect !== "OK"
    || probe.billingPurposeClass !== "buyer_order" || !["ABSENT", "VALID"].includes(probe.coursePolicySnapshotClass)
    || probe.schema.length !== Q1_DOWNSTREAM_MODELS.length
    || new Set(probe.schema.map(row => row.model)).size !== Q1_DOWNSTREAM_MODELS.length
    || probe.schema.some(row => !row.compatible || row.missingColumns.length > 0)
    || probe.enums.length === 0 || probe.enums.some(row => !row.compatible || row.missingLabels.length > 0)) {
    return { status: "RETRY_REJECTED", retryAttempts: 0, failureCode: "UNKNOWN" };
  }
  return retryFixedBuyerCallback(db, "9acfe8d2dba62430e950cff2c0387841ab91f44b", true);
}
