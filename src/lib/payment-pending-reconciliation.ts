import { Prisma, type PaymentTransaction } from "@prisma/client";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { InventoryUnavailableError } from "@/lib/inventory-reservations";
import { captureOperationalError } from "@/lib/monitoring";
import { getPaymentProvider } from "@/lib/payment-providers";
import {
  PaymentQueryProviderError,
  type PaymentProviderAdapter,
  type PendingPaymentQueryResult,
} from "@/lib/payment-providers/types";
import { classifyPaymentWebhookFailure, paymentWebhookFailureMessage } from "@/lib/payment-webhook-errors";
import {
  claimPaymentWebhookEvent,
  findOrCreatePaymentWebhookEvent,
  releaseFailedPaymentWebhookClaim,
} from "@/lib/payment-webhook-event-claim";
import {
  MANUAL_RECONCILIATION_EVENT_TYPE,
  MANUAL_RECONCILIATION_STATUS,
  PAYMENT_MANUAL_RECONCILIATION_METADATA_KEY,
  paymentHeldForManualReconciliation,
} from "@/lib/payment-webhook-manual-reconciliation";
import { processPaymentWebhook, type PaymentWebhookExpectedScope, type PaymentWebhookPayloadInput } from "@/lib/payment-webhooks";
import { redactedJsonSnapshot } from "@/lib/redaction";
import { reportWebhookRetryAlert } from "@/lib/webhook-retry";

/**
 * A-2 05: PayUni pending-payment reconciler (docs/domain-workflows.md
 * 「付款通知遺失時的主動查詢（A-2 05）」).
 *
 * A lost PayUni Notify used to leave the checkout pending until a human
 * noticed. Every run of `/api/jobs/payment-reconcile` asks PayUni about
 * PayUni payments that are still undecided here (`pending`, or `expired`
 * because the local inventory reservation timed out while the callback was
 * missing), created between PAYMENT_RECONCILE_MIN_AGE_MS and
 * PAYMENT_RECONCILE_MAX_AGE_MS ago, not held for manual reconciliation, and
 * due on their own back-off.
 *
 * A provider decision is never applied here. `paid` and `failed` become the
 * same normalized payload a callback for that trade state produces (same
 * provider event id `TradeNo:TradeStatus`), share the callback's WebhookEvent
 * row and claim, and run `processPaymentWebhook` with the server-owned
 * payment as the expected scope. Commission, inventory, orders, entitlements,
 * receipts, tracking and `payment_paid` automations therefore follow the one
 * webhook pipeline, and a callback racing the reconciler is applied once
 * (event claim + the pipeline's Serializable transaction).
 *
 * Every run takes at most PAYMENT_RECONCILE_BATCH_LIMIT payments, round-robin
 * across vendors, and starts no new query after its deadline.
 */

export const PAYMENT_RECONCILE_PROVIDER = "payuni";
/** PayUni's own advice for an unanswered authorization is to query after 15 minutes. */
export const PAYMENT_RECONCILE_MIN_AGE_MS = 15 * 60_000;
/** Checkouts older than this are left to manual reconciliation. */
export const PAYMENT_RECONCILE_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
/** Payments queried per run, shared fairly across vendors. */
export const PAYMENT_RECONCILE_BATCH_LIMIT = 20;
/** No new payment starts after this long; the rest wait for the next run. */
export const PAYMENT_RECONCILE_DEADLINE_MS = 40_000;
/** One provider query may take this long before it counts as a network error. */
export const PAYMENT_RECONCILE_QUERY_TIMEOUT_MS = 10_000;
/**
 * Provider queries per payment. With the back-off below the tenth query
 * happens about 52 hours after checkout, inside PAYMENT_RECONCILE_MAX_AGE_MS.
 */
export const PAYMENT_RECONCILE_MAX_ATTEMPTS = 10;
const PAYMENT_RECONCILE_BASE_DELAY_MS = 15 * 60_000;
const PAYMENT_RECONCILE_MAX_DELAY_MS = 12 * 60 * 60_000;
const ACTOR_LABEL = "job:payment-reconcile";
/** Local states with no provider decision yet; `expired` is the local reservation timeout (a late paid is still accepted). */
const RECONCILABLE_STATUSES = new Set(["pending", "expired"]);

/** Wait after the n-th claimed query: 15 min, 30 min, 1 h, 2 h, ... capped at 12 h. */
export function paymentReconcileDelayMs(attempts: number) {
  const exponent = Math.max(0, Math.min(attempts - 1, 16));
  return Math.min(PAYMENT_RECONCILE_BASE_DELAY_MS * 2 ** exponent, PAYMENT_RECONCILE_MAX_DELAY_MS);
}

export type PaymentReconcileSummary = {
  /** Set when PayUni is not configured on this deployment: nothing was scanned or queried. */
  skipped?: "provider_unavailable";
  candidates: number;
  examined: number;
  /** Paid decisions applied through the webhook pipeline by this run. */
  paid: number;
  /** Failed decisions applied through the webhook pipeline by this run. */
  failed: number;
  /** A callback (or another run) had already decided the payment. */
  alreadySettled: number;
  /** The provider event is being processed by a concurrent callback; asked again later. */
  inProgress: number;
  /** The pipeline failed; the event was left `failed` for the webhook-retry job. */
  handedToRetry: number;
  /** A late paid whose released stock was sold out (alerted, also counted in handedToRetry). */
  inventoryUnavailable: number;
  pending: number;
  notFound: number;
  expired: number;
  queryErrors: number;
  /** Payments marked for a human (alerted). */
  manualReview: number;
  /** Payments the provider never collected and that stopped being queried. */
  closed: number;
  claimedElsewhere: number;
  /** Unexpected errors (reported; the next run tries again). */
  errors: number;
};

type ReconcileDb = ReturnType<typeof getDb>;

type Candidate = {
  transactionId: string;
  vendorId: string;
  reconciliationId: string | null;
  attempts: number;
};

type ReconcilableTransaction = Pick<PaymentTransaction,
  "id" | "vendorId" | "providerName" | "orderNumber" | "paymentMode" | "grossAmountCents" | "currency" | "status" | "metadata">;

type Outcome = Exclude<keyof PaymentReconcileSummary, "skipped" | "candidates" | "examined" | "inventoryUnavailable">;

const utcTimestamp = (value: Date) => Prisma.sql`(${value.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function emptySummary(): PaymentReconcileSummary {
  return {
    candidates: 0, examined: 0, paid: 0, failed: 0, alreadySettled: 0, inProgress: 0, handedToRetry: 0, inventoryUnavailable: 0,
    pending: 0, notFound: 0, expired: 0, queryErrors: 0, manualReview: 0, closed: 0, claimedElsewhere: 0, errors: 0,
  };
}

function report(error: unknown, context: Record<string, unknown>, options?: Parameters<typeof captureOperationalError>[2]) {
  try {
    captureOperationalError(error, { source: "payment_reconcile", provider: PAYMENT_RECONCILE_PROVIDER, ...context }, options);
  } catch {
    // Monitoring must never stop the job.
  }
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** The PayUni adapter when this deployment can query PayUni, else null (nothing is scanned). */
export function pendingPaymentReconcileAdapter(): PaymentProviderAdapter | null {
  let adapter: PaymentProviderAdapter;
  try {
    adapter = getPaymentProvider(PAYMENT_RECONCILE_PROVIDER);
  } catch {
    return null;
  }
  if (!adapter.queryPendingPayment || adapter.checkoutReadiness() !== "ready") return null;
  return adapter;
}

/**
 * Due payments, each vendor's earliest-due first and then each vendor's
 * second, ... (round-robin). Every join is bound to the payment's vendor.
 */
function scan(db: ReconcileDb, now: Date, limit: number) {
  const newest = new Date(now.getTime() - PAYMENT_RECONCILE_MIN_AGE_MS);
  const oldest = new Date(now.getTime() - PAYMENT_RECONCILE_MAX_AGE_MS);
  return db.$queryRaw<Candidate[]>(Prisma.sql`
    WITH "candidate" AS (
      SELECT t."id" AS "transactionId", t."vendorId", r."id" AS "reconciliationId",
             COALESCE(r."attempts", 0)::int AS "attempts",
             COALESCE(r."nextQueryAt", t."createdAt") AS "dueAt",
             ROW_NUMBER() OVER (
               PARTITION BY t."vendorId" ORDER BY COALESCE(r."nextQueryAt", t."createdAt") ASC, t."id" ASC
             ) AS "vendorRank"
      FROM "PaymentTransaction" t
      LEFT JOIN "PaymentPendingReconciliation" r
        ON r."vendorId" = t."vendorId" AND r."paymentTransactionId" = t."id"
      WHERE t."providerName" = ${PAYMENT_RECONCILE_PROVIDER}
        AND t."status" IN ('pending', 'expired')
        AND t."paymentMode" = 'platform'
        AND t."orderNumber" IS NOT NULL
        AND t."createdAt" >= ${utcTimestamp(oldest)}
        AND t."createdAt" <= ${utcTimestamp(newest)}
        AND (t."metadata" IS NULL OR t."metadata" -> ${PAYMENT_MANUAL_RECONCILIATION_METADATA_KEY}::text IS NULL)
        AND (r."id" IS NULL OR (r."status" = 'active' AND r."nextQueryAt" <= ${utcTimestamp(now)}))
    )
    SELECT "transactionId", "vendorId", "reconciliationId", "attempts"
    FROM "candidate"
    WHERE "vendorRank" <= ${limit}
    ORDER BY "vendorRank" ASC, "dueAt" ASC, "transactionId" ASC
    LIMIT ${limit}
  `);
}

/**
 * The claim: moves the payment's next due time forward and counts the query
 * before PayUni is asked, conditional on the state the scan saw. A concurrent
 * run that saw the same state gets null and skips it.
 */
async function claimCandidate(db: ReconcileDb, candidate: Candidate, now: Date): Promise<number | null> {
  const attempts = candidate.attempts + 1;
  const nextQueryAt = new Date(now.getTime() + paymentReconcileDelayMs(attempts));
  if (!candidate.reconciliationId) {
    try {
      await db.paymentPendingReconciliation.create({
        data: {
          vendorId: candidate.vendorId,
          paymentTransactionId: candidate.transactionId,
          providerName: PAYMENT_RECONCILE_PROVIDER,
          attempts,
          lastQueriedAt: now,
          nextQueryAt,
        },
      });
      return attempts;
    } catch (error) {
      if (isUniqueConflict(error)) return null;
      throw error;
    }
  }
  const claimed = await db.paymentPendingReconciliation.updateMany({
    where: {
      id: candidate.reconciliationId,
      vendorId: candidate.vendorId,
      paymentTransactionId: candidate.transactionId,
      status: "active",
      attempts: candidate.attempts,
      nextQueryAt: { lte: now },
    },
    data: { attempts: { increment: 1 }, lastQueriedAt: now, nextQueryAt },
  });
  return claimed.count === 1 ? attempts : null;
}

type ReconcileContext = {
  db: ReconcileDb;
  now: Date;
  candidate: Candidate;
  attempts: number;
};

/** Records the outcome of the claimed query; a terminal status stops further queries. */
async function finish(context: ReconcileContext, status: "active" | "settled" | "closed" | "needs_manual_review", outcome: string) {
  await context.db.paymentPendingReconciliation.updateMany({
    where: {
      vendorId: context.candidate.vendorId,
      paymentTransactionId: context.candidate.transactionId,
      status: "active",
      attempts: context.attempts,
    },
    data: { status, lastOutcome: outcome, resolvedAt: status === "active" ? null : new Date() },
  });
}

type ManualReviewInput = {
  reason: string;
  level: "error" | "warning";
  /** The provider reports money that may be captured: hold the pending payment from inventory expiry. */
  hold: boolean;
  /** Add a needs_manual_reconciliation WebhookEvent (the platform's existing reconciliation queue). */
  recordEvent: boolean;
  providerTradeNo?: string;
  tradeStatus?: string;
  paymentType?: string;
  expectedAmountCents?: number;
  reportedAmountCents?: number;
  rawSnapshot?: Record<string, string | number | boolean>;
};

/**
 * Marks the payment for a human: the reconciliation row stops, the platform
 * reconciliation queue gets a record, the pending payment is held when money
 * may be captured, and an alert and audit entry are written. No payment,
 * order, commission or inventory state is changed.
 */
async function flagManualReview(context: ReconcileContext, transaction: ReconcilableTransaction, input: ManualReviewInput) {
  const { db, candidate } = context;
  await finish(context, "needs_manual_review", input.reason);
  const orderNumber = transaction.orderNumber ?? transaction.id;
  let webhookEventId: string | undefined;
  if (input.recordEvent) {
    const eventId = `manual:reconcile:${orderNumber}:${input.reason}`;
    const key = { provider_eventId: { provider: PAYMENT_RECONCILE_PROVIDER, eventId } };
    let event = await db.webhookEvent.findUnique({ where: key, select: { id: true } });
    if (!event) {
      try {
        event = await db.webhookEvent.create({
          data: {
            provider: PAYMENT_RECONCILE_PROVIDER,
            eventId,
            eventType: MANUAL_RECONCILIATION_EVENT_TYPE,
            vendorId: candidate.vendorId,
            status: MANUAL_RECONCILIATION_STATUS,
            maxRetries: 0,
            errorMessage: `Manual reconciliation required: reconcile_${input.reason}`,
            payload: {
              raw: redactedJsonSnapshot(input.rawSnapshot ?? {}),
              reconciliation: redactedJsonSnapshot({
                source: "pending_reconciler",
                reason: input.reason,
                orderNumber,
                providerTradeNo: input.providerTradeNo ?? null,
                tradeStatus: input.tradeStatus ?? null,
                paymentType: input.paymentType ?? null,
                expectedAmountCents: input.expectedAmountCents ?? null,
                reportedAmountCents: input.reportedAmountCents ?? null,
                matchedTransaction: transaction.id,
                attempts: context.attempts,
              }),
            } as Prisma.InputJsonObject,
          },
          select: { id: true },
        });
      } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        event = await db.webhookEvent.findUnique({ where: key, select: { id: true } });
      }
    }
    webhookEventId = event?.id;
  }
  if (input.hold && transaction.status === "pending" && !paymentHeldForManualReconciliation(transaction.metadata)) {
    // Conditional on still pending: a payment decided since the read keeps its own state.
    await db.paymentTransaction.updateMany({
      where: { id: transaction.id, vendorId: candidate.vendorId, status: "pending" },
      data: {
        metadata: {
          ...metadataObject(transaction.metadata),
          [PAYMENT_MANUAL_RECONCILIATION_METADATA_KEY]: { reason: `reconcile_${input.reason}`, webhookEventId: webhookEventId ?? null },
        } as Prisma.InputJsonObject,
      },
    });
  }
  report(new Error("Pending payment requires manual reconciliation"), {
    operation: "manual_review",
    status: input.reason,
    providerTradeStatus: input.tradeStatus,
    providerPaymentType: input.paymentType,
    webhookEventId,
  }, { level: input.level, fingerprint: ["payment-reconcile-manual-review", input.reason] });
  await writeAuditLog({
    vendorId: candidate.vendorId,
    actorLabel: ACTOR_LABEL,
    action: "payment_reconcile_manual_review",
    targetType: "PaymentTransaction",
    targetId: transaction.id,
    after: auditSnapshot({
      reason: input.reason,
      attempts: context.attempts,
      tradeStatus: input.tradeStatus ?? null,
      paymentType: input.paymentType ?? null,
      expectedAmountCents: input.expectedAmountCents ?? null,
      reportedAmountCents: input.reportedAmountCents ?? null,
      held: input.hold && transaction.status === "pending",
      webhookEventId: webhookEventId ?? null,
    }),
  });
  return "manualReview" as const;
}

/**
 * Applies a provider decision through the payment webhook pipeline, as one
 * provider event shared with the callback route.
 */
async function applyProviderDecision(
  context: ReconcileContext,
  transaction: ReconcilableTransaction,
  decision: Extract<PendingPaymentQueryResult, { outcome: "paid" | "failed" }>,
  summary: PaymentReconcileSummary,
): Promise<Outcome> {
  const { db, candidate } = context;
  const orderNumber = transaction.orderNumber!;
  const scope: PaymentWebhookExpectedScope = {
    vendorId: candidate.vendorId,
    paymentTransactionId: transaction.id,
    providerName: PAYMENT_RECONCILE_PROVIDER,
    orderNumber,
  };
  // The tenant comes from the server record; the pipeline re-checks the scope
  // inside its Serializable transaction before writing anything.
  const payload: PaymentWebhookPayloadInput = { ...decision.payload, vendorId: candidate.vendorId };
  if (payload.provider !== PAYMENT_RECONCILE_PROVIDER || payload.orderNumber !== orderNumber) {
    throw new Error("Reconciled provider decision does not match the payment.");
  }
  const event = await findOrCreatePaymentWebhookEvent(db, payload, {
    raw: redactedJsonSnapshot(decision.rawSnapshot),
    normalized: redactedJsonSnapshot(payload),
    diagnostics: redactedJsonSnapshot({ source: "pending_reconciler" }),
  } as Prisma.InputJsonObject);
  const claim = await claimPaymentWebhookEvent(db, event);
  if (claim.status === "processed") {
    await finish(context, "settled", `${decision.outcome}_already_processed`);
    return "alreadySettled";
  }
  if (claim.status === "pending") {
    if (claim.event.status === "received" || claim.event.status === "retrying") {
      // A callback holds the claim right now; its outcome is visible next run.
      await finish(context, "active", "event_in_progress");
      return "inProgress";
    }
    // Exhausted or held events are already someone's to resolve; never reprocess them here.
    return flagManualReview(context, transaction, {
      reason: "event_needs_attention", level: "error", hold: false, recordEvent: false,
      providerTradeNo: decision.providerTradeNo, tradeStatus: decision.outcome === "failed" ? decision.tradeStatus : "1",
    });
  }

  try {
    await processPaymentWebhook(payload, claim.event, scope);
  } catch (error) {
    const latest = await db.webhookEvent.findUnique({ where: { id: claim.event.id }, select: { status: true } }).catch(() => null);
    if (latest?.status === "processed") {
      await finish(context, "settled", `${decision.outcome}_already_processed`);
      return "alreadySettled";
    }
    const errorCode = classifyPaymentWebhookFailure(error);
    await releaseFailedPaymentWebhookClaim(db, claim.event, claim.isRetry, paymentWebhookFailureMessage(errorCode));
    const inventoryUnavailable = error instanceof InventoryUnavailableError;
    if (inventoryUnavailable) {
      summary.inventoryUnavailable += 1;
      reportWebhookRetryAlert({ eventId: claim.event.id, orderNumber, provider: PAYMENT_RECONCILE_PROVIDER, reason: "inventory_unavailable" });
    }
    report(error, { operation: "apply", status: errorCode, webhookEventId: claim.event.id }, {
      level: "error", fingerprint: ["payment-reconcile-apply", errorCode],
    });
    await writeAuditLog({
      vendorId: candidate.vendorId,
      actorLabel: ACTOR_LABEL,
      action: "payment_webhook_failed",
      targetType: "WebhookEvent",
      targetId: claim.event.id,
      before: auditSnapshot(payload),
      after: auditSnapshot({ errorCode, source: "pending_reconciler" }),
    });
    // The event now belongs to the webhook-retry job (bounded retries, alert on exhaustion).
    await finish(context, "settled", `${decision.outcome}_handed_to_retry`);
    return "handedToRetry";
  }
  await finish(context, "settled", `${decision.outcome}_applied`);
  await writeAuditLog({
    vendorId: candidate.vendorId,
    actorLabel: ACTOR_LABEL,
    action: "payment_reconcile_applied",
    targetType: "WebhookEvent",
    targetId: claim.event.id,
    after: auditSnapshot({ eventType: payload.eventType, paymentTransactionId: transaction.id, attempts: context.attempts }),
  });
  return decision.outcome === "paid" ? "paid" : "failed";
}

async function reconcileCandidate(
  db: ReconcileDb,
  adapter: PaymentProviderAdapter,
  candidate: Candidate,
  now: Date,
  summary: PaymentReconcileSummary,
): Promise<Outcome> {
  const attempts = await claimCandidate(db, candidate, now);
  if (attempts === null) return "claimedElsewhere";
  const context: ReconcileContext = { db, now, candidate, attempts };

  // Re-read the claimed payment bound to its vendor: the scan may be stale.
  const transaction = await db.paymentTransaction.findFirst({
    where: { id: candidate.transactionId, vendorId: candidate.vendorId, providerName: PAYMENT_RECONCILE_PROVIDER },
    select: {
      id: true, vendorId: true, providerName: true, orderNumber: true, paymentMode: true,
      grossAmountCents: true, currency: true, status: true, metadata: true,
    },
  });
  if (!transaction || !transaction.orderNumber || !RECONCILABLE_STATUSES.has(transaction.status)) {
    await finish(context, "settled", "already_settled");
    return "alreadySettled";
  }
  if (paymentHeldForManualReconciliation(transaction.metadata)) {
    // A callback put it in the reconciliation queue since the scan.
    await finish(context, "closed", "held_for_manual_reconciliation");
    return "closed";
  }

  let result: PendingPaymentQueryResult;
  try {
    result = await adapter.queryPendingPayment!({ transaction, timeoutMs: PAYMENT_RECONCILE_QUERY_TIMEOUT_MS });
  } catch (error) {
    const category = error instanceof PaymentQueryProviderError ? error.category : "unknown";
    // A response that fails HashInfo or decryption is never trusted; it may be tampering or a key change.
    report(new Error("Pending payment provider query failed"), { operation: "query", status: category }, {
      level: category === "authentication" ? "error" : "warning",
      fingerprint: ["payment-reconcile-query", category],
    });
    if (attempts >= PAYMENT_RECONCILE_MAX_ATTEMPTS) {
      return flagManualReview(context, transaction, { reason: "query_attempts_exhausted", level: "error", hold: false, recordEvent: true });
    }
    await finish(context, "active", `query_error_${category}`);
    return "queryErrors";
  }

  switch (result.outcome) {
    case "not_found":
      // Authenticated absence: PayUni never received this trade, so no money was taken.
      if (attempts >= PAYMENT_RECONCILE_MAX_ATTEMPTS) {
        await finish(context, "closed", "not_found");
        return "closed";
      }
      await finish(context, "active", "not_found");
      return "notFound";
    case "pending":
      if (attempts >= PAYMENT_RECONCILE_MAX_ATTEMPTS) {
        return flagManualReview(context, transaction, {
          reason: "provider_pending_exhausted", level: "warning", hold: false, recordEvent: true,
          providerTradeNo: result.providerTradeNo, tradeStatus: result.tradeStatus,
        });
      }
      await finish(context, "active", "provider_pending");
      return "pending";
    case "expired":
      // Signed TradeStatus 4: no money was received. The existing rule changes no state
      // (the reservation expires on its own); stop querying.
      await finish(context, "closed", "provider_expired");
      return "expired";
    case "manual_reconciliation":
      return flagManualReview(context, transaction, {
        reason: result.reason, level: "error", hold: true, recordEvent: true,
        providerTradeNo: result.providerTradeNo, tradeStatus: result.tradeStatus, paymentType: result.paymentType,
        rawSnapshot: result.rawSnapshot,
      });
    case "paid":
      // Money comes only from the server record; a different provider amount is never applied.
      if (result.grossAmountCents !== transaction.grossAmountCents) {
        return flagManualReview(context, transaction, {
          reason: "amount_mismatch", level: "error", hold: true, recordEvent: true,
          providerTradeNo: result.providerTradeNo, tradeStatus: "1", paymentType: "1",
          expectedAmountCents: transaction.grossAmountCents, reportedAmountCents: result.grossAmountCents,
          rawSnapshot: result.rawSnapshot,
        });
      }
      return applyProviderDecision(context, transaction, result, summary);
    case "failed":
      return applyProviderDecision(context, transaction, result, summary);
  }
}

/**
 * One reconciliation pass. A thrown scan rejects (the route reports it); an
 * error on one payment is reported and the pass goes on with the next one.
 */
export async function runPendingPaymentReconciliation(options: {
  db?: ReconcileDb;
  adapter?: PaymentProviderAdapter | null;
  now?: Date;
  limit?: number;
  deadlineMs?: number;
  clock?: () => number;
} = {}): Promise<PaymentReconcileSummary> {
  const summary = emptySummary();
  const adapter = options.adapter === undefined ? pendingPaymentReconcileAdapter() : options.adapter;
  if (!adapter?.queryPendingPayment) return { ...summary, skipped: "provider_unavailable" };
  const db = options.db ?? getDb();
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const now = options.now ?? new Date(startedAt);
  const limit = Math.max(0, Math.min(options.limit ?? PAYMENT_RECONCILE_BATCH_LIMIT, PAYMENT_RECONCILE_BATCH_LIMIT));
  const deadlineMs = Math.min(options.deadlineMs ?? PAYMENT_RECONCILE_DEADLINE_MS, PAYMENT_RECONCILE_DEADLINE_MS);
  if (limit === 0 || deadlineMs <= 0) return summary;

  const candidates = await scan(db, now, limit);
  summary.candidates = candidates.length;
  for (const candidate of candidates) {
    if (clock() - startedAt >= deadlineMs) break;
    summary.examined += 1;
    try {
      const outcome = await reconcileCandidate(db, adapter, candidate, now, summary);
      summary[outcome] += 1;
    } catch (error) {
      summary.errors += 1;
      report(error, { operation: "reconcile" }, { fingerprint: ["payment-reconcile-candidate"] });
    }
  }
  return summary;
}
