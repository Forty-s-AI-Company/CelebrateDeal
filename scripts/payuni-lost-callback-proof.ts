/**
 * A4-05: read-only proof for the PayUni lost-callback drill
 * (`scripts/payuni-lost-callback-drill.mjs`, workflow
 * `.github/workflows/staging-payuni-lost-callback.yml`).
 *
 * It finds the one WP4 synthetic buyer checkout owned by the given source SHA
 * (fixed synthetic vendor and product, `wp4SourceCommit` in the checkout
 * metadata) and reads, inside one `SET TRANSACTION READ ONLY` repeatable-read
 * snapshot, everything that shows whether the payment was posted and how many
 * times: the payment row, the PayUni WebhookEvent rows for its order number
 * (and whether the reconciler or a callback created them), manual
 * reconciliation events, the `PaymentPendingReconciliation` row, the commerce
 * order and its `payment.paid` events, the inventory reservation and the
 * reconciler's audit entries. A read-only PayUni trade query adds the
 * sanitized settlement codes (`CloseStatus`, `RemainAmt`, ...).
 *
 * Phases:
 * - `pay`: right after the drill paid with the callback withheld; expects a
 *   still-undecided payment, no paid event at all, and PayUni reporting the
 *   trade as paid (only then was a callback really withheld; otherwise the
 *   result is NO_POSTING_OBSERVED).
 * - `verify`: after `/api/jobs/payment-reconcile` ran; expects exactly one
 *   posting, made by the reconciler. Running it again after more reconcile
 *   runs must give the same counts.
 *
 * Output: fixed enums, booleans, counts and the synthetic NT$1 amounts. Never
 * an id, order number, trade number, e-mail, URL or provider text.
 *
 * Usage (protected workflow only; DATABASE_URL must be the staging database):
 *   LOST_CALLBACK_PHASE=pay|verify CELEBRATEDEAL_SOURCE_SHA=<sha> \
 *   node --import tsx scripts/payuni-lost-callback-proof.ts
 * Exit 0 = the phase expectation holds, 2 = it does not, 3 = configuration or database failure.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { isStagingDatabaseUrl } from "@/lib/database-identity";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

export const LOST_CALLBACK_PROOF_SCHEMA = "celebratedeal-payuni-lost-callback-proof/v1";
export type LostCallbackPhase = "pay" | "verify";
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
/** Same prefix as `pendingReconcileManualEventId` (payment-webhook-manual-reconciliation.ts); a test pins it. */
export const RECONCILE_MANUAL_EVENT_PREFIX = "manual:reconcile:";
const RECONCILER_ACTOR = "job:payment-reconcile";
const UNDECIDED_PAYMENT_STATUSES = new Set(["pending", "expired"]);

type ProofDb = Pick<PrismaClient, "$transaction">;
type Settlement = Record<string, string> | null;

export type LostCallbackProof = {
  schemaVersion: typeof LOST_CALLBACK_PROOF_SCHEMA;
  phase: LostCallbackPhase;
  sourceSha: string;
  candidate: "FOUND" | "MISSING" | "AMBIGUOUS";
  payment: null | {
    status: string;
    paymentMode: string;
    amountCents: number;
    currency: string;
    ageMinutes: number;
    providerTradeRecorded: boolean;
    manualHold: boolean;
  };
  providerEvents: {
    paid: number;
    paidProcessed: number;
    paidSource: "NONE" | "RECONCILER" | "CALLBACK" | "UNKNOWN" | "MIXED";
    paidMaxRetryCount: number;
    other: number;
  };
  manualEvents: number;
  reconciliation: null | { status: string; attempts: number; lastOutcome: string; providerTradeSeen: boolean };
  order: { count: number; status: string; paidAmountCents: number; paidEvents: number };
  reservation: { count: number; status: string };
  reconcilerAudit: { applied: number; manualReview: number };
  /** resultShape/rowCheck: the drill's de-identified enums (QUERY_RESULT_SHAPES / QUERY_ROW_CHECKS); NONE when not queried. */
  provider: { status: string; resultShape: string; rowCheck: string; settlement: Settlement };
  evaluation: "CALLBACK_WITHHELD" | "NO_POSTING_OBSERVED" | "RECONCILED_ONCE" | "NOT_YET_RECONCILED" | "UNEXPECTED_STATE";
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A bounded lowercase code from our own schema; anything else is "other". */
function code(value: unknown) {
  return typeof value === "string" && /^[a-z_]{1,64}$/u.test(value) ? value : "other";
}

function eventSource(payload: unknown): "RECONCILER" | "CALLBACK" | "UNKNOWN" {
  const diagnostics = objectValue(objectValue(payload)?.diagnostics);
  if (diagnostics?.source === "pending_reconciler") return "RECONCILER";
  if (diagnostics?.provider === "payuni" && objectValue(diagnostics.payuni)) return "CALLBACK";
  return "UNKNOWN";
}

function isWp4BuyerCheckout(metadata: unknown, sourceSha: string) {
  const root = objectValue(metadata);
  return root?.wp4SourceCommit === sourceSha && root.billingPurpose === "buyer_order" && root.productId === WP4_SANDBOX_FIXTURE.productId;
}

/** PayUni itself reports a complete, collected card trade for the order. */
function providerReportsPaid(provider: LostCallbackProof["provider"]) {
  return provider.status === "FOUND" && provider.settlement?.TradeStatus === "1"
    && provider.settlement.DataSource === "A" && provider.settlement.PaymentType === "1";
}

/**
 * Phase expectation over the snapshot. `pay` claims CALLBACK_WITHHELD only when
 * PayUni reports the trade paid; an undecided payment without that evidence
 * is NO_POSTING_OBSERVED (nothing proves a callback existed to be lost).
 */
export function evaluateLostCallbackProof(proof: Omit<LostCallbackProof, "evaluation">): LostCallbackProof["evaluation"] {
  if (proof.candidate !== "FOUND" || !proof.payment || proof.manualEvents !== 0 || proof.reconcilerAudit.manualReview !== 0
    || proof.order.count !== 1 || proof.payment.amountCents !== 100 || proof.payment.currency !== "TWD"
    || proof.payment.paymentMode !== "platform" || proof.payment.manualHold || proof.providerEvents.other !== 0) {
    return "UNEXPECTED_STATE";
  }
  const undecided = UNDECIDED_PAYMENT_STATUSES.has(proof.payment.status) && proof.providerEvents.paid === 0
    && proof.order.paidEvents === 0 && proof.reconcilerAudit.applied === 0
    && (proof.reconciliation === null || proof.reconciliation.status === "active");
  if (proof.phase === "pay") {
    if (!undecided) return "UNEXPECTED_STATE";
    return providerReportsPaid(proof.provider) ? "CALLBACK_WITHHELD" : "NO_POSTING_OBSERVED";
  }
  if (undecided) return "NOT_YET_RECONCILED";
  const reconciledOnce = proof.payment.status === "paid" && proof.payment.providerTradeRecorded
    && proof.providerEvents.paid === 1 && proof.providerEvents.paidProcessed === 1 && proof.providerEvents.paidSource === "RECONCILER"
    && proof.order.status === "paid" && proof.order.paidAmountCents === 100 && proof.order.paidEvents === 1
    && proof.reconciliation?.status === "settled" && proof.reconciliation.lastOutcome === "paid_applied"
    && proof.reconcilerAudit.applied === 1;
  return reconciledOnce ? "RECONCILED_ONCE" : "UNEXPECTED_STATE";
}

type Snapshot = { proof: Omit<LostCallbackProof, "evaluation" | "provider">; orderNumber: string | null };

async function readSnapshot(tx: Prisma.TransactionClient, sourceSha: string, phase: LostCallbackPhase, now: Date): Promise<Snapshot> {
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const empty: Omit<LostCallbackProof, "evaluation" | "provider" | "candidate"> = {
    schemaVersion: LOST_CALLBACK_PROOF_SCHEMA, phase, sourceSha, payment: null,
    providerEvents: { paid: 0, paidProcessed: 0, paidSource: "NONE", paidMaxRetryCount: 0, other: 0 },
    manualEvents: 0, reconciliation: null,
    order: { count: 0, status: "none", paidAmountCents: 0, paidEvents: 0 },
    reservation: { count: 0, status: "none" },
    reconcilerAudit: { applied: 0, manualReview: 0 },
  };
  const rows = await tx.paymentTransaction.findMany({
    where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni" },
    select: { id: true, status: true, metadata: true, orderNumber: true, providerTradeNo: true, paymentMode: true, grossAmountCents: true, currency: true, createdAt: true },
  });
  const candidates = rows.filter((row) => isWp4BuyerCheckout(row.metadata, sourceSha));
  if (candidates.length !== 1) {
    return { proof: { ...empty, candidate: candidates.length === 0 ? "MISSING" : "AMBIGUOUS" }, orderNumber: null };
  }
  const payment = candidates[0]!;
  const vendorId = WP4_SANDBOX_FIXTURE.vendorId;
  const orderNumber = payment.orderNumber;
  const events = orderNumber
    ? await tx.webhookEvent.findMany({
      // Second guard: an initial PayUni event has no tenant until it is processed (vendorId null);
      // an event already bound to another vendor is never counted.
      where: {
        provider: "payuni", OR: [{ vendorId }, { vendorId: null }],
        payload: { path: ["normalized", "orderNumber"], equals: orderNumber },
      },
      select: { id: true, eventType: true, status: true, retryCount: true, payload: true },
    })
    : [];
  const paid = events.filter((event) => event.eventType === "paid");
  const sources = new Set(paid.map((event) => eventSource(event.payload)));
  const manualEvents = orderNumber
    ? await tx.webhookEvent.count({ where: { provider: "payuni", vendorId, eventId: { startsWith: `${RECONCILE_MANUAL_EVENT_PREFIX}${orderNumber}:` } } })
    : 0;
  const reconciliation = await tx.paymentPendingReconciliation.findUnique({
    where: { vendorId_paymentTransactionId: { vendorId, paymentTransactionId: payment.id } },
    select: { status: true, attempts: true, lastOutcome: true, providerTradeSeen: true },
  });
  const orders = await tx.commerceOrder.findMany({
    where: { vendorId, primaryPaymentTransactionId: payment.id },
    select: { id: true, status: true, paidAmountCents: true },
  });
  const paidOrderEvents = orders.length === 1
    ? await tx.commerceOrderEvent.count({ where: { vendorId, orderId: orders[0]!.id, eventType: "payment.paid" } })
    : 0;
  const reservations = await tx.inventoryReservation.findMany({ where: { vendorId, paymentTransactionId: payment.id }, select: { status: true } });
  // The reconciler audits an applied decision on the WebhookEvent and a manual review on the payment.
  const [applied, manualReview] = await Promise.all([
    paid.length
      ? tx.auditLog.count({ where: { vendorId, actorLabel: RECONCILER_ACTOR, action: "payment_reconcile_applied", targetType: "WebhookEvent", targetId: { in: paid.map((event) => event.id) } } })
      : Promise.resolve(0),
    tx.auditLog.count({ where: { vendorId, actorLabel: RECONCILER_ACTOR, action: "payment_reconcile_manual_review", targetType: "PaymentTransaction", targetId: payment.id } }),
  ]);
  return {
    orderNumber,
    proof: {
      ...empty,
      candidate: "FOUND",
      payment: {
        status: code(payment.status),
        paymentMode: code(payment.paymentMode),
        amountCents: payment.grossAmountCents,
        currency: payment.currency === "TWD" ? "TWD" : "other",
        ageMinutes: Math.max(0, Math.floor((now.getTime() - payment.createdAt.getTime()) / 60_000)),
        providerTradeRecorded: Boolean(payment.providerTradeNo?.trim()),
        manualHold: objectValue(payment.metadata)?.paymentManualReconciliation !== undefined,
      },
      providerEvents: {
        paid: paid.length,
        paidProcessed: paid.filter((event) => event.status === "processed").length,
        paidSource: sources.size === 0 ? "NONE" : sources.size > 1 ? "MIXED" : [...sources][0]!,
        paidMaxRetryCount: paid.reduce((max, event) => Math.max(max, event.retryCount), 0),
        other: events.length - paid.length,
      },
      manualEvents,
      reconciliation: reconciliation ? {
        status: code(reconciliation.status), attempts: reconciliation.attempts,
        lastOutcome: code(reconciliation.lastOutcome ?? "none"), providerTradeSeen: reconciliation.providerTradeSeen,
      } : null,
      order: {
        count: orders.length,
        status: orders.length === 1 ? code(orders[0]!.status) : "none",
        paidAmountCents: orders.length === 1 ? orders[0]!.paidAmountCents : 0,
        paidEvents: paidOrderEvents,
      },
      reservation: { count: reservations.length, status: reservations.length === 1 ? code(reservations[0]!.status) : "none" },
      reconcilerAudit: { applied, manualReview },
    },
  };
}

type ProviderQuery = (orderNumber: string) => Promise<{ status: string; resultShape?: string; rowCheck?: string; settlement: Settlement }>;

/** The whole read, then the optional read-only PayUni query. The order number never leaves this function. */
export async function readLostCallbackProof(db: ProofDb, input: {
  sourceSha: string; phase: LostCallbackPhase; now?: Date; queryProvider?: ProviderQuery | null;
}): Promise<LostCallbackProof> {
  if (!SOURCE_SHA.test(input.sourceSha) || (input.phase !== "pay" && input.phase !== "verify")) {
    throw new Error("LOST_CALLBACK_PROOF_INPUT_REJECTED");
  }
  const now = input.now ?? new Date();
  const snapshot = await db.$transaction((tx) => readSnapshot(tx, input.sourceSha, input.phase, now), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 60_000,
  });
  let provider: LostCallbackProof["provider"] = { status: "NOT_QUERIED", resultShape: "NONE", rowCheck: "NONE", settlement: null };
  if (snapshot.orderNumber && input.queryProvider) {
    const result = await input.queryProvider(snapshot.orderNumber);
    // The drill's own allowlists (dynamic import for the same CommonJS reason as main()).
    const { QUERY_RESULT_SHAPES, QUERY_ROW_CHECKS } = await import("./payuni-lost-callback-drill.mjs");
    const listed = (allowed: readonly string[], value: unknown) => (typeof value === "string" && allowed.includes(value) ? value : "NONE");
    provider = {
      status: typeof result?.status === "string" && /^[A-Z_0-9]{1,32}$/u.test(result.status) ? result.status : "OTHER",
      resultShape: listed(QUERY_RESULT_SHAPES, result?.resultShape), rowCheck: listed(QUERY_ROW_CHECKS, result?.rowCheck),
      settlement: result?.settlement ?? null,
    };
  }
  return { ...snapshot.proof, provider, evaluation: evaluateLostCallbackProof({ ...snapshot.proof, provider }) };
}

const PHASE_PASS: Record<LostCallbackPhase, LostCallbackProof["evaluation"]> = { pay: "CALLBACK_WITHHELD", verify: "RECONCILED_ONCE" };

async function main() {
  // A dynamic import, before the configuration gate so every run proves it loads: tsx compiles this
  // file as CommonJS, and a static import would require() the drill's ESM graph, whose entry points
  // use top-level await (ERR_REQUIRE_ASYNC_MODULE). Locked by staging-payuni-lost-callback-workflow.test.mjs.
  const { payUniSandboxCrypto, queryProviderSettlement, readSandboxKeyInputs } = await import("./payuni-lost-callback-drill.mjs");
  const phase = process.env.LOST_CALLBACK_PHASE;
  const sourceSha = process.env.CELEBRATEDEAL_SOURCE_SHA?.trim().toLowerCase() ?? "";
  const protectedCi = process.argv.length === 2 && process.env.GITHUB_ACTIONS === "true"
    && process.env.GITHUB_REF === "refs/heads/master" && process.env.GITHUB_REF_PROTECTED === "true";
  if (!protectedCi || (phase !== "pay" && phase !== "verify") || !SOURCE_SHA.test(sourceSha)
    || !isStagingDatabaseUrl(process.env.DATABASE_URL) || !process.env.RUNNER_TEMP) {
    console.log("payuni_lost_callback_proof=BLOCKED; reason=CONFIGURATION_REJECTED");
    process.exitCode = 3;
    return;
  }
  const keys = readSandboxKeyInputs();
  let queryProvider: ProviderQuery | null = null;
  const merchantId = keys.merchantId;
  if (process.env.PAYUNI_ENV === "sandbox" && merchantId && keys.key && keys.iv) {
    try {
      const crypto = payUniSandboxCrypto({ key: keys.key, iv: keys.iv });
      queryProvider = (orderNumber) => queryProviderSettlement(orderNumber, { crypto, merchantId });
    } catch {
      // Malformed key material: the database proof still runs, the provider stays NOT_QUERIED.
    }
  }
  const db = new PrismaClient();
  try {
    const proof = await readLostCallbackProof(db, { sourceSha, phase, queryProvider });
    const directory = path.join(process.env.RUNNER_TEMP, "payuni-lost-callback");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${phase}-proof.json`), `${JSON.stringify(proof)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(`payuni_lost_callback_proof=${proof.evaluation}; phase=${phase}`);
    console.log(JSON.stringify(proof));
    if (proof.evaluation !== PHASE_PASS[phase]) process.exitCode = 2;
  } catch {
    console.log("payuni_lost_callback_proof=BLOCKED; reason=DATABASE_OR_PROVIDER_FAILURE");
    process.exitCode = 3;
  } finally {
    await db.$disconnect();
  }
}

// No top-level await here either: esbuild rejects it in tsx's CommonJS output (2026-11-24 run 45340752525).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.log("payuni_lost_callback_proof=BLOCKED; reason=INTERNAL_FAILURE");
    process.exitCode = 3;
  });
}
