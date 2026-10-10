import { Prisma, type PrismaClient } from "@prisma/client";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";
import { paymentWebhookFailureMessage, type PaymentWebhookFailureCode } from "../src/lib/payment-webhook-errors";

const SOURCE = "9acfe8d2dba62430e950cff2c0387841ab91f44b";
// Exact public CI step start: run38031885137. This is observation, never replay authority.
const WINDOW_START = new Date("2026-10-10T06:43:34Z");
const FIXED_ACTOR = "wp4_sandbox_fixed_callback_retry";
const CODES: PaymentWebhookFailureCode[] = ["scope_missing", "scope_invalid", "scope_mismatch", "order_ambiguous",
  "amount_mismatch", "inventory_conflict", "processing_timeout", "processing_claim_lost", "processing_failed"];
const state = (value: unknown, allowed: readonly string[]) => typeof value === "string" && allowed.includes(value) ? value : "OTHER";
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000 ? value : null;
type AuditScalar = { action: string; actorLabel: string; errorCode: string | null; status: string | null; retryCount: string | null };

/** Fixed event audit scalar paths only: no full audit blobs, credentials, IDs or payload output. */
export async function readOriginalRetryAudit(db: Pick<PrismaClient, "$transaction">) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(SOURCE), take: 2,
        select: { id: true, orderNumber: true } });
      if (payments.length !== 1) return { classification: payments.length ? "PAYMENT_AMBIGUOUS" : "PAYMENT_UNAVAILABLE" };
      const payment = payments[0]!;
      if (!payment.orderNumber) return { classification: "REFERENCE_UNAVAILABLE" };
      const events = await tx.webhookEvent.findMany({ where: { provider: "payuni", eventType: "paid",
        payload: { path: ["normalized", "orderNumber"], equals: payment.orderNumber } }, take: 2,
        select: { id: true, vendorId: true, status: true, retryCount: true, maxRetries: true, updatedAt: true, nextRetryAt: true, errorMessage: true } });
      if (events.length !== 1) return { classification: events.length ? "EVENT_AMBIGUOUS" : "EVENT_UNAVAILABLE" };
      const event = events[0]!;
      if (event.vendorId !== null && event.vendorId !== WP4_SANDBOX_FIXTURE.vendorId) return { classification: "EVENT_SCOPE_MISMATCH" };
      const model = Prisma.dmmf.datamodel.models.find((item) => item.name === "AuditLog");
      if (!model || !["action", "actorLabel", "targetType", "targetId", "createdAt", "before", "after"].every((name) => model.fields.some((field) => field.name === name))
        || !["before", "after"].every((name) => model.fields.some((field) => field.name === name && field.type === "Json"))) {
        return { classification: "SCHEMA_UNVERIFIED" };
      }
      const rows = await tx.$queryRaw<AuditScalar[]>(Prisma.sql`
        SELECT "action", "actorLabel", "after"->>'errorCode' AS "errorCode", "after"->>'status' AS "status",
          "before"->>'retryCount' AS "retryCount"
        FROM "AuditLog" WHERE "targetType" = 'WebhookEvent' AND "targetId" = ${event.id}
          AND ("vendorId" IS NULL OR "vendorId" = ${WP4_SANDBOX_FIXTURE.vendorId})
          AND "actorLabel" IN (${FIXED_ACTOR}, 'job:webhook-retry') AND "createdAt" >= ${WINDOW_START}
        LIMIT 21
      `);
      if (rows.length > 20) return { classification: "AUDIT_AMBIGUOUS" };
      const fixed = rows.filter((row) => row.actorLabel === FIXED_ACTOR);
      const schedulerCount = rows.filter((row) => row.actorLabel === "job:webhook-retry").length;
      const fixedRows = fixed.map((row) => ({ action: state(row.action, ["webhook_retry_failed", "webhook_retry_exhausted", "retry_webhook_event"]),
        errorCode: row.errorCode === null ? "NONE" : state(row.errorCode, CODES),
        status: state(row.status, ["failed", "exhausted", "processed"]),
        retryCountMatchesCurrent: typeof row.retryCount === "string" && /^\d{1,4}$/.test(row.retryCount)
          && integer(Number(row.retryCount)) !== null && Number(row.retryCount) === event.retryCount }));
      return { classification: schedulerCount ? "SCHEDULER_ACTIVITY_OBSERVED" : fixed.length === 1 ? "FIXED_AUDIT_OBSERVED"
        : fixed.length === 0 ? "NO_FIXED_AUDIT" : "AUDIT_AMBIGUOUS",
        fixedActorCount: fixed.length, schedulerCount, fixedRows,
        eventStatus: state(event.status, ["received", "failed", "retrying", "processed", "exhausted"]),
        retryCount: integer(event.retryCount), maxRetries: integer(event.maxRetries),
        storedFailure: event.errorMessage === null ? "NONE" : CODES.find((code) => paymentWebhookFailureMessage(code) === event.errorMessage) ?? "OTHER",
        nextRetryAt: event.nextRetryAt === null ? "NONE" : event.nextRetryAt.getTime() <= Date.now() ? "DUE" : "FUTURE",
        eventUpdatedAfterRunStart: event.updatedAt >= WINDOW_START, paymentUpdatedAfterRunStart: "UNKNOWN",
        callbackPosts: 0, callbackReplayAuthorized: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError
      && (["P2021", "P2022"].includes(error.code)
        || (error.code === "P2010" && ["42703", "42P01"].includes(String(error.meta?.code ?? ""))))) {
      return { classification: "SCHEMA_UNVERIFIED" };
    }
    // Keep the other readonly sections; never emit raw exception or meta contents.
    return { classification: "AUDIT_READ_FAILED" };
  }
}
