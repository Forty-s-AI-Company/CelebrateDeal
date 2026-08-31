import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { verifyDeployment } from "./secure-staging-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASK = "wp4-payuni-sandbox-reconciliation";
const RECEIPT_NAME = `${TASK}-receipt.json`;
const CHILD_PREFIX = "SECURE_WP4_RESULT:";
const PAYUNI_HOST = "sandbox-api.payuni.com.tw";
const PAYUNI_PATH = "/api/trade/query";
const SAFE_SHA = /^[a-f0-9]{40}$/u;
const SAFE_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const PURPOSES = Object.freeze(["buyer_order", "platform_subscription", "invoice_payment"]);

export const REQUIRED_SECRET_KEYS = Object.freeze([
  "STAGING_DATABASE_URL", "GITHUB_TOKEN", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV",
]);
export const REQUIRED_CONFIG_KEYS = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL", "CELEBRATEDEAL_SOURCE_SHA", "CELEBRATEDEAL_DEPLOYMENT_HOST", "RUNNER_TEMP",
]);

function hasValue(source, key) {
  return typeof source[key] === "string" && source[key].length > 0;
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function systemEnvironment(source = process.env) {
  return Object.fromEntries(
    ["PATH", "HOME", "USERPROFILE", "TMP", "TEMP", "RUNNER_TEMP", "SystemRoot", "ComSpec", "PATHEXT"]
      .filter((key) => hasValue(source, key))
      .map((key) => [key, source[key]]),
  );
}

function classifyStagingDatabase(source) {
  try {
    const database = new URL(source.STAGING_DATABASE_URL);
    const supabase = new URL(source.NEXT_PUBLIC_SUPABASE_URL);
    const projectRef = supabase.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/u)?.[1];
    const direct = projectRef && database.hostname === `db.${projectRef}.supabase.co` && database.username === "postgres";
    const pooler = projectRef && database.hostname.endsWith(".pooler.supabase.com") && database.username.endsWith(`.${projectRef}`);
    const port = database.port || "5432";
    return Boolean(
      /^postgres(?:ql)?:$/u.test(database.protocol)
      && supabase.protocol === "https:"
      && database.pathname === "/postgres"
      && /^\d{2,5}$/u.test(port)
      && (direct || pooler),
    );
  } catch {
    return false;
  }
}

export function validateInvocation(task, source = process.env) {
  if (task !== TASK) return { ok: false, reason: "TASK_NOT_ALLOWLISTED" };
  if (![...REQUIRED_SECRET_KEYS, ...REQUIRED_CONFIG_KEYS].every((key) => hasValue(source, key))) {
    return { ok: false, reason: "REQUIRED_BINDING_MISSING" };
  }
  if (!SAFE_SHA.test(source.CELEBRATEDEAL_SOURCE_SHA)) return { ok: false, reason: "SOURCE_SHA_INVALID" };
  if (!SAFE_HOST.test(source.CELEBRATEDEAL_DEPLOYMENT_HOST) || !source.CELEBRATEDEAL_DEPLOYMENT_HOST.endsWith(".vercel.app")) {
    return { ok: false, reason: "DEPLOYMENT_HOST_INVALID" };
  }
  if (!classifyStagingDatabase(source)) return { ok: false, reason: "STAGING_DATABASE_IDENTITY_INVALID" };
  return { ok: true, reason: null };
}

function initialPurpose(purpose) {
  return {
    purpose,
    candidateCount: 0,
    localStatus: "NOT_RUN",
    providerStatus: "NOT_RUN",
    referenceMatched: false,
    orderMatched: false,
    amountMatched: false,
    refundMatched: false,
    projectionMatched: false,
    duplicateSideEffectsAbsent: false,
    outOfOrderFailClosed: false,
    overRefundRejected: false,
    failureOrCancellationObserved: false,
    status: "NOT_RUN",
  };
}

export function createInitialReceipt(sourceCommit = "unknown") {
  return {
    schemaVersion: "celebratedeal-secure-staging-wp4/v2",
    task: TASK,
    sourceCommit: SAFE_SHA.test(sourceCommit) ? sourceCommit : "unknown",
    result: "BLOCKED",
    executedAtUtc: new Date().toISOString(),
    lineage: { deploymentReads: 0, deploymentMatched: false, sourceMatched: false, preview: false, ready: false, healthStatus: null, noRedirect: false },
    environment: { requiredBindingsPresent: false, payuniSandbox: true, stagingDatabaseMatched: false, productionDetected: false },
    purposes: PURPOSES.map(initialPurpose),
    reconciliation: { callbackConsistency: false, duplicateRejected: false, outOfOrderFailClosed: false, overRefundRejected: false, allPurposesMatched: false },
    network: { policy: "fixed-host-egress", githubDeployments: true, stagingPreview: true, supabaseStaging: true, payuniSandbox: true, arbitraryOutbound: false },
    safety: { sanitized: true, envFilesRead: false, envEnumerated: false, secretValuesPrinted: false, secretValuesPersisted: false, rawOutputPersisted: false, rawDatabaseRowsPersisted: false, rawProviderResponsePersisted: false, customerOrPaymentDataPersisted: false },
    sideEffects: { databaseConnections: 0, databaseReads: 0, databaseWrites: 0, providerQueries: 0, providerWrites: 0, transactionsCreated: 0, payments: 0, refunds: 0, callbackReplays: 0, deployments: 0, aliasMutations: 0, productionOperations: 0 },
    failureCategory: null,
  };
}

const TOP_KEYS = ["schemaVersion", "task", "sourceCommit", "result", "executedAtUtc", "lineage", "environment", "purposes", "reconciliation", "network", "safety", "sideEffects", "failureCategory"];
const PURPOSE_KEYS = ["purpose", "candidateCount", "localStatus", "providerStatus", "referenceMatched", "orderMatched", "amountMatched", "refundMatched", "projectionMatched", "duplicateSideEffectsAbsent", "outOfOrderFailClosed", "overRefundRejected", "failureOrCancellationObserved", "status"];
const NESTED_KEYS = Object.freeze({
  lineage: ["deploymentReads", "deploymentMatched", "sourceMatched", "preview", "ready", "healthStatus", "noRedirect"],
  environment: ["requiredBindingsPresent", "payuniSandbox", "stagingDatabaseMatched", "productionDetected"],
  reconciliation: ["callbackConsistency", "duplicateRejected", "outOfOrderFailClosed", "overRefundRejected", "allPurposesMatched"],
  network: ["policy", "githubDeployments", "stagingPreview", "supabaseStaging", "payuniSandbox", "arbitraryOutbound"],
  safety: ["sanitized", "envFilesRead", "envEnumerated", "secretValuesPrinted", "secretValuesPersisted", "rawOutputPersisted", "rawDatabaseRowsPersisted", "rawProviderResponsePersisted", "customerOrPaymentDataPersisted"],
  sideEffects: ["databaseConnections", "databaseReads", "databaseWrites", "providerQueries", "providerWrites", "transactionsCreated", "payments", "refunds", "callbackReplays", "deployments", "aliasMutations", "productionOperations"],
});

export function validateReceipt(receipt) {
  const errors = [];
  if (!exactKeys(receipt, TOP_KEYS)) errors.push("SCHEMA_KEYS");
  for (const [key, keys] of Object.entries(NESTED_KEYS)) {
    if (!exactKeys(receipt?.[key], keys)) errors.push(`SCHEMA_${key.toUpperCase()}`);
  }
  if (receipt?.schemaVersion !== "celebratedeal-secure-staging-wp4/v2" || receipt?.task !== TASK) errors.push("SCHEMA");
  if (!SAFE_SHA.test(receipt?.sourceCommit ?? "")) errors.push("SOURCE");
  if (!new Set(["PASS", "FAILED", "BLOCKED"]).has(receipt?.result)) errors.push("RESULT");
  if (Number.isNaN(Date.parse(receipt?.executedAtUtc ?? ""))) errors.push("EXECUTED_AT");
  if (receipt?.failureCategory !== null && !/^[A-Z0-9_]+$/u.test(receipt?.failureCategory ?? "")) errors.push("FAILURE_CATEGORY");
  if (!Array.isArray(receipt?.purposes) || receipt.purposes.length !== PURPOSES.length || receipt.purposes.map((item) => item?.purpose).join("|") !== PURPOSES.join("|")) errors.push("PURPOSES");
  for (const item of receipt?.purposes ?? []) {
    if (!exactKeys(item, PURPOSE_KEYS)) errors.push("PURPOSE_SCHEMA");
    if (!Number.isInteger(item?.candidateCount) || item.candidateCount < 0 || item.candidateCount > 2) errors.push("CANDIDATE_BUDGET");
    if (!new Set(["NOT_RUN", "PASS", "FAIL"]).has(item?.status)) errors.push("PURPOSE_STATUS");
  }
  const effects = receipt?.sideEffects ?? {};
  if (!Number.isInteger(effects.databaseConnections) || effects.databaseConnections < 0 || effects.databaseConnections > 1) errors.push("DATABASE_CONNECTION_BUDGET");
  if (!Number.isInteger(effects.databaseReads) || effects.databaseReads < 0 || effects.databaseReads > 4) errors.push("DATABASE_READ_BUDGET");
  if (!Number.isInteger(effects.providerQueries) || effects.providerQueries < 0 || effects.providerQueries > 3) errors.push("PROVIDER_QUERY_BUDGET");
  if (!Number.isInteger(effects.databaseWrites) || effects.databaseWrites < 0 || effects.databaseWrites > 60) errors.push("DATABASE_WRITE_BUDGET");
  if (!Number.isInteger(effects.providerWrites) || effects.providerWrites < 0 || effects.providerWrites > 9) errors.push("PROVIDER_WRITE_BUDGET");
  if (!Number.isInteger(effects.transactionsCreated) || effects.transactionsCreated < 0 || effects.transactionsCreated > 6) errors.push("TRANSACTION_BUDGET");
  if (!Number.isInteger(effects.payments) || effects.payments < 0 || effects.payments > 3) errors.push("PAYMENT_BUDGET");
  if (!Number.isInteger(effects.refunds) || effects.refunds < 0 || effects.refunds > 6) errors.push("REFUND_BUDGET");
  if (!Number.isInteger(effects.callbackReplays) || effects.callbackReplays < 0 || effects.callbackReplays > 6) errors.push("CALLBACK_REPLAY_BUDGET");
  for (const key of ["deployments", "aliasMutations", "productionOperations"]) {
    if (effects[key] !== 0) errors.push("FORBIDDEN_SIDE_EFFECTS");
  }
  if (receipt?.network?.policy !== "fixed-host-egress" || receipt?.network?.arbitraryOutbound !== false || receipt?.network?.payuniSandbox !== true) errors.push("NETWORK_POLICY");
  if (receipt?.safety?.sanitized !== true || Object.entries(receipt?.safety ?? {}).some(([key, value]) => key !== "sanitized" && value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN\s+(?:RSA|OPENSSH|EC)\s+PRIVATE\s+KEY|set-cookie|EncryptInfo|HashInfo|MerchantId|providerTradeNo|orderNumber|transactionReference)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  if (receipt?.result === "PASS") {
    const allPurposes = receipt.purposes.every((item) => item.candidateCount === 2 && item.status === "PASS" && item.referenceMatched && item.orderMatched && item.amountMatched && item.refundMatched && item.projectionMatched && item.duplicateSideEffectsAbsent && item.outOfOrderFailClosed && item.overRefundRejected && item.failureOrCancellationObserved);
    const complete = receipt.lineage?.deploymentMatched && receipt.lineage?.sourceMatched && receipt.lineage?.preview && receipt.lineage?.ready && receipt.lineage?.healthStatus === 200 && receipt.lineage?.noRedirect
      && receipt.environment?.requiredBindingsPresent && receipt.environment?.payuniSandbox && receipt.environment?.stagingDatabaseMatched && !receipt.environment?.productionDetected
      && allPurposes && receipt.reconciliation?.callbackConsistency && receipt.reconciliation?.duplicateRejected && receipt.reconciliation?.outOfOrderFailClosed && receipt.reconciliation?.overRefundRejected && receipt.reconciliation?.allPurposesMatched
      && effects.databaseConnections === 1 && effects.databaseReads >= 2 && effects.providerQueries === 3
      && effects.transactionsCreated === 6 && effects.payments === 3 && effects.refunds === 6
      && effects.providerWrites === 9 && effects.callbackReplays === 6;
    if (!complete) errors.push("PASS_GATE_INCOMPLETE");
  }
  return { ok: errors.length === 0, errors };
}

export async function queryProviderCandidate(row, provider, fetchImpl = fetch) {
  const nativeFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (input, init = {}) => {
    attempts += 1;
    if (attempts !== 1) throw new Error("PROVIDER_QUERY_BUDGET_EXCEEDED");
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.protocol !== "https:" || url.hostname !== PAYUNI_HOST || url.pathname !== PAYUNI_PATH || url.port || url.username || url.password || url.search) throw new Error("PAYUNI_SANDBOX_ALLOWLIST_REJECTED");
    const response = await fetchImpl(url, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new Error("PAYUNI_REDIRECT_REJECTED");
    return response;
  };
  try {
    const result = await provider.queryPayment({ transaction: row.transaction });
    if (attempts !== 1) throw new Error("PROVIDER_QUERY_COUNT_INVALID");
    return { result, attempts };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

function normalizeFailure(error) {
  const value = String(error?.message ?? "");
  return /^[A-Z0-9_]+$/u.test(value) ? value : "NORMALIZED_EXTERNAL_FAILURE";
}

async function runtimeModules() {
  const [{ Prisma, PrismaClient }, { tsImport }] = await Promise.all([import("@prisma/client"), import("tsx/esm/api")]);
  const [provider, fixtures] = await Promise.all([
    tsImport("../src/lib/payment-providers/payuni.ts", import.meta.url),
    tsImport("../src/lib/payment-providers/payuni-fixtures.ts", import.meta.url),
  ]);
  return { Prisma, PrismaClient, provider: provider.payUniPaymentProvider, buildFixture: fixtures.buildPayUniSandboxWebhookFixture };
}

function transactionForProvider(row) {
  return {
    id: row.transaction_id, vendorId: row.vendor_id, providerName: "payuni", providerTradeNo: row.provider_trade_no,
    orderNumber: row.order_number, paymentMode: "platform", grossAmountCents: Number(row.gross_amount_cents), gatewayFeeCents: 0,
    platformFeeCents: 0, netAmountCents: Number(row.gross_amount_cents), currency: "TWD", status: row.local_status,
    refundedAmountCents: Number(row.refunded_amount_cents), refundReason: null, refundedAt: null, occurredAt: new Date(0),
    metadata: { synthetic: true }, checkoutIdempotencyKey: null, createdAt: new Date(0),
  };
}

async function queryCandidates(db, Prisma, sourceCommit) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const rows = await tx.$queryRaw(Prisma.sql`
      WITH tagged AS (
        SELECT
          pt.id AS transaction_id,
          pt."vendorId" AS vendor_id,
          pt."providerTradeNo" AS provider_trade_no,
          pt."orderNumber" AS order_number,
          pt."grossAmountCents" AS gross_amount_cents,
          pt."refundedAmountCents" AS refunded_amount_cents,
          pt.status AS local_status,
          pt."createdAt" AS created_at,
          CASE
            WHEN co.id IS NOT NULL THEN 'buyer_order'
            WHEN pt.metadata->>'billingPurpose' = 'platform_subscription_checkout' THEN 'platform_subscription'
            WHEN pt.metadata->>'billingPurpose' = 'invoice_payment' THEN 'invoice_payment'
          END AS purpose,
          co.status::text AS order_status,
          (SELECT COUNT(*)::int FROM "CommerceOrderEvent" e WHERE e."orderId" = co.id AND e."eventType" = 'payment.paid') AS paid_event_count,
          (SELECT COUNT(*)::int FROM "CommerceOrderEvent" e WHERE e."orderId" = co.id AND e."eventType" = 'refund.processed') AS refund_event_count,
          (SELECT COALESCE(SUM(r."refundAmountCents"), 0)::int FROM "RefundRecord" r WHERE r."paymentTransactionId" = pt.id AND r.status = 'processed') AS processed_refund_cents,
          (SELECT COUNT(*)::int FROM "RefundRecord" r WHERE r."paymentTransactionId" = pt.id AND r.status = 'processed') AS processed_refund_count,
          (SELECT COALESCE(MIN(r."refundAmountCents"), 0)::int FROM "RefundRecord" r WHERE r."paymentTransactionId" = pt.id AND r.status = 'processed') AS minimum_refund_cents,
          CASE
            WHEN co.id IS NOT NULL THEN co.status::text
            WHEN pt.metadata->>'billingPurpose' = 'platform_subscription_checkout' THEN subscription.status
            WHEN pt.metadata->>'billingPurpose' = 'invoice_payment' THEN invoice.status
          END AS projection_status,
          invoice."totalCents" AS projection_amount_cents,
          (usage_limit.id IS NOT NULL) AS usage_limit_present,
          (SELECT COUNT(*)::int FROM "WebhookEvent" we WHERE we.provider = 'payuni' AND we."eventType" = 'paid' AND we.status = 'processed' AND we.payload #>> '{normalized,orderNumber}' = pt."orderNumber") AS paid_webhook_count,
          (SELECT COUNT(*)::int FROM "WebhookEvent" we WHERE we.provider = 'payuni' AND we."eventType" = 'refunded' AND we.status = 'processed' AND we.payload #>> '{normalized,orderNumber}' = pt."orderNumber") AS refunded_webhook_count,
          (SELECT we."eventId" FROM "WebhookEvent" we WHERE we.provider = 'payuni' AND we."eventType" = 'paid' AND we.status = 'processed' AND we.payload #>> '{normalized,orderNumber}' = pt."orderNumber" ORDER BY we."createdAt" DESC LIMIT 1) AS paid_webhook_event_id,
          (SELECT we."eventId" FROM "WebhookEvent" we WHERE we.provider = 'payuni' AND we."eventType" = 'refunded' AND we.status = 'processed' AND we.payload #>> '{normalized,orderNumber}' = pt."orderNumber" ORDER BY we."createdAt" DESC LIMIT 1) AS refunded_webhook_event_id
        FROM "PaymentTransaction" pt
        LEFT JOIN "CommerceOrder" co ON co."primaryPaymentTransactionId" = pt.id AND co."vendorId" = pt."vendorId"
        LEFT JOIN "VendorSubscription" subscription ON subscription.id = pt.metadata->>'platformSubscriptionId' AND subscription."vendorId" = pt."vendorId"
        LEFT JOIN "VendorUsageLimit" usage_limit ON usage_limit."vendorId" = pt."vendorId" AND usage_limit."billingPlanId" = subscription."planId"
        LEFT JOIN "Invoice" invoice ON invoice.id = pt.metadata->>'invoiceId' AND invoice."vendorId" = pt."vendorId"
        WHERE pt."providerName" = 'payuni'
          AND pt.currency = 'TWD'
          AND pt."grossAmountCents" > 0
          AND pt."providerTradeNo" IS NOT NULL
          AND pt."orderNumber" IS NOT NULL
          AND COALESCE(pt.metadata->>'wp4Synthetic', 'false') = 'true'
          AND pt.metadata->>'wp4SourceCommit' = ${sourceCommit}
      )
      SELECT *, current_setting('transaction_read_only') AS transaction_read_only
      FROM tagged WHERE purpose IS NOT NULL
      ORDER BY purpose, created_at DESC
    `);
    return rows;
  });
}

function stableState(rows) {
  return rows.map((row) => ({
    id: row.transaction_id,
    status: row.local_status,
    refunded: Number(row.refunded_amount_cents),
    projection: row.projection_status,
    paidEvents: Number(row.paid_event_count),
    refundEvents: Number(row.refund_event_count),
    refundRecords: Number(row.processed_refund_count),
    paidWebhooks: Number(row.paid_webhook_count),
    refundedWebhooks: Number(row.refunded_webhook_count),
  })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function exactPreviewEndpoint(host, source) {
  const endpoint = new URL("/api/webhooks/payments", `https://${host}`);
  endpoint.searchParams.set("provider", "payuni");
  endpoint.searchParams.set("source", source);
  if (endpoint.protocol !== "https:" || endpoint.hostname !== host || endpoint.port || endpoint.username || endpoint.password) throw new Error("PREVIEW_CALLBACK_ALLOWLIST_REJECTED");
  return endpoint;
}

export async function replayCallbacks(row, buildFixture, source, fetchImpl = fetch) {
  if (Number(row.paid_webhook_count) !== 1 || Number(row.refunded_webhook_count) !== 1 || !row.paid_webhook_event_id || !row.refunded_webhook_event_id) throw new Error("CALLBACK_EVIDENCE_NOT_EXACT");
  const amount = Number(row.gross_amount_cents);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount % 100 !== 0) throw new Error("CALLBACK_AMOUNT_INVALID");
  const common = { MerTradeNo: row.order_number, TradeNo: row.provider_trade_no, TradeAmt: amount / 100 };
  const requests = [
    {
      endpoint: exactPreviewEndpoint(source.CELEBRATEDEAL_DEPLOYMENT_HOST, "return"),
      body: buildFixture({ fixture: "paid", merchantId: source.PAYUNI_MERCHANT_ID, hashKey: source.PAYUNI_HASH_KEY, hashIv: source.PAYUNI_HASH_IV, overrides: { ...common, EventId: row.paid_webhook_event_id } }),
      expectedStatus: 303,
      returnRequest: true,
    },
    {
      endpoint: exactPreviewEndpoint(source.CELEBRATEDEAL_DEPLOYMENT_HOST, "notify"),
      body: buildFixture({ fixture: "refunded", merchantId: source.PAYUNI_MERCHANT_ID, hashKey: source.PAYUNI_HASH_KEY, hashIv: source.PAYUNI_HASH_IV, overrides: { ...common, RefundAmount: amount / 100, EventId: row.refunded_webhook_event_id } }),
      expectedStatus: 200,
      returnRequest: false,
    },
  ];
  for (const request of requests) {
    const response = await fetchImpl(request.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== request.expectedStatus) throw new Error("CALLBACK_RESPONSE_INVALID");
    if (request.returnRequest) {
      const location = response.headers.get("location");
      const destination = location ? new URL(location, request.endpoint) : null;
      if (!destination || destination.hostname !== source.CELEBRATEDEAL_DEPLOYMENT_HOST || destination.pathname !== "/checkout/result" || destination.searchParams.get("payment") !== "updated") throw new Error("RETURN_CALLBACK_REDIRECT_INVALID");
    } else if (response.headers.has("location")) {
      throw new Error("NOTIFY_CALLBACK_REDIRECT_INVALID");
    }
  }
  return { attempts: requests.length };
}

function evaluateLocal(row) {
  const refunded = Number(row.refunded_amount_cents);
  const refundSum = Number(row.processed_refund_cents);
  const gross = Number(row.gross_amount_cents);
  const refundMatched = row.local_status === "refunded"
    && refunded === gross
    && refundSum === gross
    && Number(row.processed_refund_count) === 2
    && Number(row.minimum_refund_cents) > 0
    && Number(row.minimum_refund_cents) < gross;
  const projectionMatched = row.purpose === "buyer_order"
    ? row.projection_status === "refunded" && Number(row.paid_event_count) === 1 && Number(row.refund_event_count) === 2
    : row.purpose === "platform_subscription"
      ? row.projection_status === "payment_refunded" && row.usage_limit_present === true
      : row.projection_status === "refunded" && Number(row.projection_amount_cents) === gross;
  return {
    refundMatched,
    projectionMatched,
    duplicateSideEffectsAbsent: Number(row.paid_event_count) <= 1 && Number(row.processed_refund_count) === 2,
    // A final refunded snapshot cannot prove that an out-of-order callback or
    // an over-refund was actually attempted and rejected during this run.
    outOfOrderFailClosed: false,
    overRefundRejected: false,
  };
}

function failedProjectionMatched(row) {
  if (!new Set(["failed", "cancelled", "canceled", "payment_failed"]).has(row.local_status)) return false;
  if (row.purpose === "buyer_order") return row.projection_status === "payment_failed";
  if (row.purpose === "platform_subscription") return row.projection_status === "payment_failed";
  return new Set(["issued", "overdue"]).has(row.projection_status);
}

async function runChild(source) {
  const receipt = createInitialReceipt(source.CELEBRATEDEAL_SOURCE_SHA);
  let db;
  try {
    const { Prisma, PrismaClient, provider, buildFixture } = await runtimeModules();
    db = new PrismaClient({ datasources: { db: { url: source.STAGING_DATABASE_URL } }, log: [] });
    receipt.sideEffects.databaseConnections = 1;
    await db.$connect();
    const rows = await queryCandidates(db, Prisma, source.CELEBRATEDEAL_SOURCE_SHA);
    receipt.sideEffects.databaseReads = 1;
    const beforeState = stableState(rows);
    let callbackConsistency = true;
    for (const purpose of PURPOSES) {
      const target = receipt.purposes.find((item) => item.purpose === purpose);
      const candidates = rows.filter((row) => row.purpose === purpose).slice(0, 3);
      target.candidateCount = candidates.length;
      const successful = candidates.filter((row) => new Set(["paid", "partially_refunded", "refunded"]).has(row.local_status));
      const failed = candidates.filter((row) => new Set(["failed", "cancelled", "canceled", "payment_failed"]).has(row.local_status));
      if (candidates.length !== 2 || successful.length !== 1 || failed.length !== 1 || candidates.some((row) => row.transaction_read_only !== "on")) throw new Error(`CANDIDATE_${purpose.toUpperCase()}_NOT_EXACT`);
      const row = successful[0];
      const local = evaluateLocal(row);
      const queried = await queryProviderCandidate({ transaction: transactionForProvider(row) }, provider);
      receipt.sideEffects.providerQueries += queried.attempts;
      const callbacks = await replayCallbacks(row, buildFixture, source);
      receipt.sideEffects.callbackReplays += callbacks.attempts;
      const snapshot = queried.result;
      target.localStatus = row.local_status;
      target.providerStatus = snapshot.status;
      target.referenceMatched = snapshot.providerTradeNo === row.provider_trade_no;
      target.orderMatched = snapshot.orderNumber === row.order_number;
      target.amountMatched = snapshot.grossAmountCents === Number(row.gross_amount_cents);
      target.refundMatched = local.refundMatched && snapshot.refundedAmountCents === Number(row.refunded_amount_cents);
      target.projectionMatched = local.projectionMatched;
      target.duplicateSideEffectsAbsent = local.duplicateSideEffectsAbsent;
      target.outOfOrderFailClosed = local.outOfOrderFailClosed;
      target.overRefundRejected = local.overRefundRejected;
      target.failureOrCancellationObserved = failedProjectionMatched(failed[0]);
      const booleanChecksPass = Object.entries(target).every(([key, value]) => !["referenceMatched", "orderMatched", "amountMatched", "refundMatched", "projectionMatched", "duplicateSideEffectsAbsent", "outOfOrderFailClosed", "overRefundRejected", "failureOrCancellationObserved"].includes(key) || value === true);
      target.status = booleanChecksPass && target.localStatus === "refunded" && target.providerStatus === "refunded" ? "PASS" : "FAIL";
    }
    const afterRows = await queryCandidates(db, Prisma, source.CELEBRATEDEAL_SOURCE_SHA);
    receipt.sideEffects.databaseReads = 2;
    callbackConsistency = JSON.stringify(stableState(afterRows)) === JSON.stringify(beforeState);
    if (!callbackConsistency) receipt.purposes.forEach((item) => { item.duplicateSideEffectsAbsent = false; item.outOfOrderFailClosed = false; item.status = "FAIL"; });
    receipt.reconciliation = {
      callbackConsistency: callbackConsistency && receipt.purposes.every((item) => item.referenceMatched && item.orderMatched && item.amountMatched),
      duplicateRejected: receipt.purposes.every((item) => item.duplicateSideEffectsAbsent),
      outOfOrderFailClosed: receipt.purposes.every((item) => item.outOfOrderFailClosed),
      overRefundRejected: receipt.purposes.every((item) => item.overRefundRejected),
      allPurposesMatched: receipt.purposes.every((item) => item.status === "PASS"),
    };
    const boundedProviderEvidenceComplete = receipt.sideEffects.transactionsCreated === 6
      && receipt.sideEffects.payments === 3
      && receipt.sideEffects.refunds === 6
      && receipt.sideEffects.providerWrites === 9;
    receipt.result = Object.values(receipt.reconciliation).every(Boolean) && boundedProviderEvidenceComplete ? "PASS" : "BLOCKED";
    if (!boundedProviderEvidenceComplete) receipt.failureCategory = "SANDBOX_SIDE_EFFECT_EVIDENCE_MISSING";
  } catch (error) {
    receipt.result = "BLOCKED";
    receipt.failureCategory = normalizeFailure(error);
  } finally {
    if (db) await db.$disconnect().catch(() => {});
  }
  return receipt;
}

function childEnvironment(source) {
  return {
    ...systemEnvironment(source),
    STAGING_DATABASE_URL: source.STAGING_DATABASE_URL,
    PAYUNI_ENV: "sandbox",
    PAYUNI_MERCHANT_ID: source.PAYUNI_MERCHANT_ID,
    PAYUNI_HASH_KEY: source.PAYUNI_HASH_KEY,
    PAYUNI_HASH_IV: source.PAYUNI_HASH_IV,
    CELEBRATEDEAL_SOURCE_SHA: source.CELEBRATEDEAL_SOURCE_SHA,
    CELEBRATEDEAL_DEPLOYMENT_HOST: source.CELEBRATEDEAL_DEPLOYMENT_HOST,
  };
}

export function parseChildOutput(stdout, exitCode) {
  const nonEmpty = String(stdout ?? "").split(/\r?\n/u).filter(Boolean);
  const lines = nonEmpty.filter((line) => line.startsWith(CHILD_PREFIX));
  if ((exitCode !== 0 && exitCode !== 2) || lines.length !== 1 || nonEmpty.length !== 1) return { ok: false, reason: "CHILD_OUTPUT_INVALID" };
  try {
    const receipt = JSON.parse(lines[0].slice(CHILD_PREFIX.length));
    const validation = validateReceipt(receipt.result === "PASS" ? {
      ...receipt,
      lineage: { deploymentReads: 2, deploymentMatched: true, sourceMatched: true, preview: true, ready: true, healthStatus: 200, noRedirect: true },
      environment: { requiredBindingsPresent: true, payuniSandbox: true, stagingDatabaseMatched: true, productionDetected: false },
    } : receipt);
    return validation.ok ? { ok: true, receipt } : { ok: false, reason: "CHILD_RECEIPT_INVALID" };
  } catch {
    return { ok: false, reason: "CHILD_OUTPUT_UNREADABLE" };
  }
}

async function writeReceipt(receipt, runnerTemp) {
  const directory = path.resolve(runnerTemp, "celebratedeal-secure-receipts");
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptPath = path.join(directory, RECEIPT_NAME);
  await fsp.writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return receiptPath;
}

async function runParent(source) {
  let receipt = createInitialReceipt(source.CELEBRATEDEAL_SOURCE_SHA);
  const invocation = validateInvocation(TASK, source);
  if (!invocation.ok) {
    receipt.failureCategory = invocation.reason;
    return writeReceipt(receipt, source.RUNNER_TEMP);
  }
  receipt.environment.requiredBindingsPresent = true;
  receipt.environment.stagingDatabaseMatched = true;
  try {
    const lineage = await verifyDeployment(source);
    const health = await fetch(`https://${lineage.host}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const noRedirect = !health.headers.has("location") && health.status === 200;
    if (!noRedirect) throw new Error("PREVIEW_HEALTH_GATE_FAILED");
    receipt.lineage = { deploymentReads: lineage.reads, deploymentMatched: lineage.deploymentMatched, sourceMatched: lineage.sourceMatched, preview: lineage.preview, ready: lineage.ready, healthStatus: health.status, noRedirect };
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child"], {
      cwd: ROOT, env: childEnvironment(source), encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 256 * 1024,
    });
    const parsed = parseChildOutput(child.stdout, child.status ?? 1);
    if (!parsed.ok) throw new Error(parsed.reason);
    receipt = { ...parsed.receipt, lineage: receipt.lineage, environment: receipt.environment };
    const validation = validateReceipt(receipt);
    if (!validation.ok) throw new Error("FINAL_RECEIPT_INVALID");
  } catch (error) {
    receipt.result = "BLOCKED";
    receipt.failureCategory = normalizeFailure(error);
  }
  return writeReceipt(receipt, source.RUNNER_TEMP);
}

async function main() {
  if (process.argv[2] === "--child") {
    const receipt = await runChild({
      STAGING_DATABASE_URL: process.env.STAGING_DATABASE_URL,
      PAYUNI_MERCHANT_ID: process.env.PAYUNI_MERCHANT_ID,
      PAYUNI_HASH_KEY: process.env.PAYUNI_HASH_KEY,
      PAYUNI_HASH_IV: process.env.PAYUNI_HASH_IV,
      CELEBRATEDEAL_SOURCE_SHA: process.env.CELEBRATEDEAL_SOURCE_SHA,
      CELEBRATEDEAL_DEPLOYMENT_HOST: process.env.CELEBRATEDEAL_DEPLOYMENT_HOST,
    });
    process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(receipt)}\n`);
    if (receipt.result !== "PASS") process.exitCode = 2;
    return;
  }
  const receiptPath = await runParent({
    ...systemEnvironment(),
    STAGING_DATABASE_URL: process.env.STAGING_DATABASE_URL,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    PAYUNI_MERCHANT_ID: process.env.PAYUNI_MERCHANT_ID,
    PAYUNI_HASH_KEY: process.env.PAYUNI_HASH_KEY,
    PAYUNI_HASH_IV: process.env.PAYUNI_HASH_IV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    CELEBRATEDEAL_SOURCE_SHA: process.env.CELEBRATEDEAL_SOURCE_SHA,
    CELEBRATEDEAL_DEPLOYMENT_HOST: process.env.CELEBRATEDEAL_DEPLOYMENT_HOST,
  });
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  process.stdout.write(`secure_staging_wp4=${receipt.result}\n`);
  if (receipt.result !== "PASS") process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { process.exitCode = 2; });
