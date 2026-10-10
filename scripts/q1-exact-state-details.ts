import { readOriginalRetryAudit } from "./q1-original-retry-audit";
import { readProcessingPreconditions } from "./q1-processing-preconditions";
import { Prisma, PrismaClient } from "@prisma/client";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "../src/lib/wp4-payuni-sandbox-reconciliation";
import { paymentWebhookFailureMessage, type PaymentWebhookFailureCode } from "../src/lib/payment-webhook-errors";
import { PaymentWebhookPayload } from "../src/lib/payment-webhooks";
import { qaFinanceDatabaseUrl, QA_FINANCE_CA_FILE, verifyQaFinanceCertificate, qaFinanceFailureCategory } from "../src/lib/staging-qa-finance-bootstrap";

// Diagnose the already-issued transaction only; this is not a new checkout selector.
export const EXACT_SOURCE = "9acfe8d2dba62430e950cff2c0387841ab91f44b";
const ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const closedState = (value: unknown, values: readonly string[]) => values.find((state) => state === value) ?? "OTHER";
const CALLBACK_FAILURES: readonly PaymentWebhookFailureCode[] = ["scope_missing", "scope_invalid", "scope_mismatch",
  "order_ambiguous", "amount_mismatch", "inventory_conflict", "processing_timeout", "processing_claim_lost", "processing_failed"];

type CallbackObservation = {
  callbackState: string; callbackTenantState?: string; callbackFailure?: string; callbackRetryBudgetAvailable?: boolean;
  callbackPayloadValid?: boolean; callbackEventIdentityMatches?: boolean; callbackProviderOrderMatches?: boolean;
  callbackPayloadTenantMatches?: boolean; callbackAmountMatches?: boolean; callbackTradeMatches?: boolean;
  callbackCurrencyMatches?: boolean; callbackSingleRecoveryCountAllowed?: boolean;
};

// Read the actual stored callback only. A signed query is never a callback substitute.
async function readOriginalCallback(tx: Prisma.TransactionClient, payment: {
  orderNumber: string | null; providerTradeNo: string | null; grossAmountCents: number; currency: string;
}): Promise<CallbackObservation> {
  const { orderNumber } = payment;
  if (!orderNumber || !/^[a-zA-Z0-9_-]{1,128}$/.test(orderNumber)) return { callbackState: "REFERENCE_UNAVAILABLE" };
  const events = await tx.webhookEvent.findMany({ where: { provider: "payuni", eventType: "paid",
    payload: { path: ["normalized", "orderNumber"], equals: orderNumber } }, take: 2,
    select: { status: true, vendorId: true, errorMessage: true, retryCount: true, maxRetries: true, eventId: true, payload: true } });
  if (events.length !== 1) return { callbackState: events.length ? "AMBIGUOUS" : "NOT_OBSERVED" };
  const event = events[0]!;
  const envelope = event.payload;
  const parsed = PaymentWebhookPayload.safeParse(envelope && typeof envelope === "object" && !Array.isArray(envelope) ? envelope.normalized : null);
  // Only booleans leave this read-only process. Never expose payloads, IDs or schema errors.
  // These observations explain the existing recovery guards; they do not authorize replay.
  const callbackBinding = {
    callbackPayloadValid: parsed.success,
    callbackEventIdentityMatches: parsed.success && parsed.data.eventId === event.eventId,
    callbackProviderOrderMatches: parsed.success && parsed.data.provider === "payuni" && parsed.data.eventType === "paid"
      && parsed.data.orderNumber === orderNumber,
    callbackPayloadTenantMatches: parsed.success && (parsed.data.vendorId === undefined || parsed.data.vendorId === WP4_SANDBOX_FIXTURE.vendorId)
      && (parsed.data.vendorSlug === undefined || parsed.data.vendorSlug === WP4_SANDBOX_FIXTURE.vendorSlug),
    callbackAmountMatches: parsed.success && parsed.data.grossAmountCents === payment.grossAmountCents,
    callbackTradeMatches: parsed.success && (parsed.data.providerTradeNo === undefined || payment.providerTradeNo === null
      || parsed.data.providerTradeNo === payment.providerTradeNo),
    callbackCurrencyMatches: parsed.success && (parsed.data.currency === undefined || parsed.data.currency === payment.currency),
    callbackSingleRecoveryCountAllowed: Number.isSafeInteger(event.retryCount) && event.retryCount >= 0 && event.retryCount <= 1,
  };
  return { callbackState: closedState(event.status, ["received", "processed", "failed", "retrying", "exhausted"]),
    callbackTenantState: event.vendorId === null ? "UNASSIGNED" : event.vendorId === WP4_SANDBOX_FIXTURE.vendorId ? "MATCHED" : "MISMATCHED",
    callbackFailure: event.errorMessage === null ? "NONE"
      : CALLBACK_FAILURES.find((code) => paymentWebhookFailureMessage(code) === event.errorMessage) ?? "OTHER",
    callbackRetryBudgetAvailable: Number.isSafeInteger(event.retryCount) && Number.isSafeInteger(event.maxRetries)
      && event.retryCount >= 0 && event.retryCount < event.maxRetries, ...callbackBinding };
}

// Query only the database-selected original merchant reference; no checkout/close API.
export async function queryExactProviderState(orderNumber: string, query?: (order: string) => Promise<unknown>) {
  try {
    const { queryTransaction } = await import("./payuni-sandbox-external-qa.mjs");
    const result = await (query ?? ((order) => queryTransaction(order, { signal: AbortSignal.timeout(5000) })))(orderNumber);
    if (!result || typeof result !== "object" || Array.isArray(result)) return { providerQuery: "INVALID_RESPONSE" };
    const row = result as Record<string, unknown>;
    if (row.MerTradeNo !== orderNumber) return { providerQuery: "IDENTITY_MISMATCH" };
    return { providerQuery: "OBSERVED", providerTradeState: closedState(String(row.TradeStatus), ["0", "1"]),
      providerTradeNumberPresent: typeof row.TradeNo === "string" && row.TradeNo.length > 0,
      providerAmountMatches: Number(row.TradeAmt) === 1 };
  } catch (error) {
    const { PayUniQueryFailure } = await import("./payuni-sandbox-external-qa.mjs");
    if (!(error instanceof PayUniQueryFailure)) return { providerQuery: "UNAVAILABLE" };
    return { providerQuery: "REJECTED", providerFailureStage: closedState(error.failureStage,
      ["request-configuration", "network-request", "http-response", "response-envelope", "signature-decryption", "provider-result", "order-validation"]),
      providerDisposition: closedState(error.providerDisposition,
        ["terminal-authentication", "terminal-invalid-request", "retryable-not-found", "retryable-processing", "retryable-provider", "unknown"]) };
  }
}

export async function readExactSyntheticState(db: Pick<PrismaClient, "$transaction">,
  query?: (order: string) => Promise<unknown>) {
  return db.$transaction(async (tx) => {
    // PostgreSQL rejects writes even if a future refactor accidentally adds one.
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const rows = await tx.paymentTransaction.findMany({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni",
        AND: [{ metadata: { path: ["wp4SourceCommit"], equals: EXACT_SOURCE } },
          { metadata: { path: ["billingPurpose"], equals: "buyer_order" } },
          { metadata: { path: ["productId"], equals: WP4_SANDBOX_FIXTURE.productId } }] }, take: 2,
      select: { id: true, orderNumber: true, status: true, metadata: true, providerTradeNo: true, grossAmountCents: true, currency: true, refundedAmountCents: true },
    });
    const candidates = rows.filter((row) => wp4SourceCommitFromMetadata(row.metadata) === EXACT_SOURCE
      && wp4PayUniPurposeFromMetadata(row.metadata) === "buyer_order"
      && row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      && row.metadata.productId === WP4_SANDBOX_FIXTURE.productId);
    if (candidates.length !== 1) return { category: candidates.length ? "EXACT_FIXTURE_AMBIGUOUS" : "EXACT_FIXTURE_ABSENT" };
    const payment = candidates[0]!;
    const [orders, reservations] = await Promise.all([
      tx.commerceOrder.findMany({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, primaryPaymentTransactionId: payment.id },
        select: { id: true, status: true, paidAmountCents: true } }),
      tx.inventoryReservation.findMany({ where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, paymentTransactionId: payment.id },
        select: { status: true, releaseReason: true, productId: true, quantity: true } }),
    ]);
    const paidEventCount = orders.length === 1 ? await tx.commerceOrderEvent.count({
      where: { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: orders[0]!.id, eventType: "payment.paid" },
    }) : null;
    const callback = await readOriginalCallback(tx, payment);
    const provider = query ? (payment.grossAmountCents === 100 && payment.currency === "TWD"
      && typeof payment.orderNumber === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(payment.orderNumber)
      ? await queryExactProviderState(payment.orderNumber, query) : { providerQuery: "EXACT_IDENTITY_UNAVAILABLE" }) : undefined;
    return { category: "EXACT_SYNTHETIC_STATE_OBSERVED", ...(provider ? { provider } : {}), callback,
      paymentSubmissionReserved: typeof payment.metadata === "object" && payment.metadata !== null && !Array.isArray(payment.metadata)
        && payment.metadata.wp4PaymentSubmissionReserved === true,
      callbackRetryReserved: typeof payment.metadata === "object" && payment.metadata !== null && !Array.isArray(payment.metadata)
        && payment.metadata.wp4CallbackRetryReserved === true,
      paymentState: closedState(payment.status, ["pending", "paid", "failed", "expired", "refunded", "partially_refunded"]),
      providerTradeNumberPresent: Boolean(payment.providerTradeNo), fixedAmountMatches: payment.grossAmountCents === 100 && payment.currency === "TWD",
      refundState: payment.refundedAmountCents === 0 ? "NONE" : payment.refundedAmountCents > 0 ? "PRESENT" : "INVALID",
      orderCount: orders.length, orderState: orders.length === 1 ? closedState(orders[0]!.status, ["draft", "pending_payment", "paid", "payment_failed", "expired", "cancelled", "partially_refunded", "refunded"]) : "NOT_UNIQUE",
      orderPaidAmountMatches: orders.length === 1 && orders[0]!.paidAmountCents === 100,
      reservationCount: reservations.length, reservationState: reservations.length === 1 ? closedState(reservations[0]!.status, ["reserved", "committed", "released", "expired"]) : "NOT_UNIQUE",
      reservationProductMatches: reservations.length === 1 && reservations[0]!.productId === WP4_SANDBOX_FIXTURE.productId && reservations[0]!.quantity === 1,
      reservationReleaseCategory: reservations.length === 1 ? closedState(reservations[0]!.releaseReason, ["payment_failed", "expired", "provider_checkout_failed", "checkout_metadata_failed", "refund"]) : "NOT_UNIQUE",
      paidEventCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

/** Observe schema names only; never select vendor/payment secrets or replay a callback.
 * Compatibility is candidate diagnosis, not permission to reset a durable marker.
 */
export async function readCallbackProcessingSchema(db: Pick<PrismaClient, "$transaction">) {
  const names = ["Vendor", "PaymentTransaction", "WebhookEvent", "CommerceOrder", "InventoryReservation"] as const;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const models = names.map((name) => Prisma.dmmf.datamodel.models.find((model) => model.name === name));
    if (models.some((model) => !model)) throw new Error("Processing schema model unavailable");
    const tables = models.map((model) => model!.dbName ?? model!.name);
    const columns = await tx.$queryRaw<{ table_name: string; column_name: string }[]>(Prisma.sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (${Prisma.join(tables)})
    `);
    return { expectedApplicationSource: "01d7af28755e73478ade7cdd0bc017c8edee67f5",
      models: models.map((model) => {
        const expected = model!.fields.filter((field) => field.kind !== "object");
        const observed = new Set(columns.filter((column) => column.table_name === (model!.dbName ?? model!.name))
          .map((column) => column.column_name));
        const missing = expected.filter((field) => !observed.has(field.dbName ?? field.name));
        // Names originate exclusively in the reviewed source schema; never expose unknown DB metadata.
        return { model: model!.name, compatible: missing.length === 0,
          missingColumns: missing.map((field) => field.name) };
      }), callbackReplayAuthorized: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
}

async function report(result: Record<string, unknown>) {
  const receipt = { schemaVersion: "celebratedeal-q1-exact-state-details/v1", ...result,
    sourceCommit: EXACT_SOURCE, productionOperations: false, databaseWrites: false, paymentSubmitted: false, refundSubmitted: false, callbackPosts: 0, callbackReplayAuthorized: false };
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF === "refs/heads/master"
    && process.env.GITHUB_REF_PROTECTED === "true" && process.env.RUNNER_TEMP) {
    const directory = resolve(process.env.RUNNER_TEMP, "q1-exact-state-details");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "completion.json"), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  }
  console.log(JSON.stringify(receipt));
}

export async function main(withProviderQuery = false) {
  let db: PrismaClient | undefined;
  let stage = "configuration";
  try {
    const env = process.env;
    if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/master"
      || env.GITHUB_REF_PROTECTED !== "true" || env.PAYUNI_ENV !== "sandbox" || !env.JOB_SECRET
      || env.CELEBRATEDEAL_SOURCE_SHA !== EXACT_SOURCE) throw new Error();
    if (withProviderQuery && ["PAYUNI_SANDBOX_MERCHANT_ID", "PAYUNI_SANDBOX_HASH_KEY", "PAYUNI_SANDBOX_HASH_IV"]
      .some((name) => !env[name])) throw new Error();
    const databaseUrl = qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL ?? "");
    verifyQaFinanceCertificate(await readFile(resolve("prisma", QA_FINANCE_CA_FILE)));
    stage = "deployment-lineage";
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
    if (!await verifyMvpPayUniLineage({ NODE_ENV: "test", CELEBRATEDEAL_SOURCE_SHA: EXACT_SOURCE,
      CELEBRATEDEAL_DEPLOYMENT_HOST: env.CELEBRATEDEAL_DEPLOYMENT_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN })) throw new Error();
    stage = "sandbox-readonly-boundary";
    const response = await fetch(`${ORIGIN}/api/admin/ops/payuni/wp4-buyer-order-proof`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": EXACT_SOURCE },
    });
    const proof = await response.json();
    const expected: Record<string, number> = { VERIFIED: 200, FIXTURE_UNAVAILABLE: 404, CANDIDATE_AMBIGUOUS: 409, STATE_MISMATCH: 409 };
    if (!Object.hasOwn(expected, proof?.status ?? "") || expected[proof.status] !== response.status) throw new Error();
    stage = "fixed-synthetic-readonly-snapshot";
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await report({ status: "READ_ONLY_DIAGNOSTIC", ...await readExactSyntheticState(db, withProviderQuery
      ? async (order) => { const { queryTransaction } = await import("./payuni-sandbox-external-qa.mjs");
        return queryTransaction(order, { signal: AbortSignal.timeout(5000) }); } : undefined),
      processingSchema: await readCallbackProcessingSchema(db), retryAudit: await readOriginalRetryAudit(db),
      processingPreconditions: await readProcessingPreconditions(db) });
  } catch (error) {
    await report({ status: "BLOCKED_OR_FAILED", stage, failureCategory: qaFinanceFailureCategory(error) });
    process.exitCode = 1;
  } finally {
    try { await db?.$disconnect(); }
    catch { await report({ status: "BLOCKED_OR_FAILED", stage: "database-disconnect", failureCategory: "DATABASE_DISCONNECT" }); process.exitCode = 1; }
  }
}
