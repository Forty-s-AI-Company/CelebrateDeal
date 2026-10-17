import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SCHEMA_VERSION = "celebratedeal-payuni-payment-handoff/v1";
const HANDOFF_DIRECTORY_SEGMENTS = [".ai-team", "reports", "payuni-payment-handoff"];
const SANDBOX_PROVIDER_HOST = "sandbox-api.payuni.com.tw";
const REFUND_STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const REFERENCE = /^[a-f0-9]{12}$/;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// The runner never persists raw order, transaction, or provider identifiers.
// A browser verifier can derive the same short reference locally to locate the
// pending Sandbox transaction without sending its raw identifier to evidence.
function reference(value) {
  const input = String(value ?? "").trim();
  assert(input.length > 0, "Sandbox 交接缺少必要的交易參照。");
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function safeTimestamp(value) {
  const parsed = new Date(value);
  assert(!Number.isNaN(parsed.getTime()), "Sandbox 交接時間格式無效。");
  return parsed.toISOString();
}

function createPendingRefundHandoff({ startedAt, completedAt, appUrl, checkout, paid }) {
  const app = new URL(String(appUrl));
  assert(app.protocol === "https:" && !app.username && !app.password && !app.port, "Sandbox 交接 Staging host 無效。");
  assert(Number.isInteger(checkout?.amount) && checkout.amount > 0, "Sandbox 交接金額無效。");
  assert(String(paid?.TradeStatus ?? "") === "1", "Sandbox 交接必須以已付款查詢結果建立。");
  assert(Number(paid?.TradeAmt) === checkout.amount, "Sandbox 交接金額與 PayUni 查詢不一致。");

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    status: "PENDING_REFUND",
    environment: "sandbox",
    appHost: app.hostname,
    providerHost: SANDBOX_PROVIDER_HOST,
    startedAt: safeTimestamp(startedAt),
    completedAt: safeTimestamp(completedAt),
    orderRef: reference(checkout.orderNumber),
    transactionRef: reference(checkout.transactionId),
    tradeRef: reference(paid.TradeNo),
    amount: checkout.amount,
    checks: Object.freeze({
      browserCheckout: "passed",
      paymentCallbackMatched: "passed",
      providerReconciliation: "passed",
      sandboxRefundAccepted: "pending-chrome",
      refundVisibleInProviderQuery: "pending-chrome",
      refundIdempotency: "pending-chrome",
      paymentTransactionRefunded: "pending-chrome",
      refundRecordProcessed: "pending-chrome",
      singleRefundRecord: "pending-chrome",
    }),
    nextAction: "chrome-staging-refund-and-duplicate-refund",
    productionValidation: Object.freeze({
      status: "human-approval-required",
      automatedChargeAllowed: false,
    }),
  });
}

async function writePaymentHandoff(receipt, rootDirectory = process.cwd()) {
  assert(receipt?.schemaVersion === SCHEMA_VERSION && receipt?.status === "PENDING_REFUND", "Sandbox 交接收據格式無效。");
  for (const value of [receipt.orderRef, receipt.transactionRef, receipt.tradeRef]) {
    assert(REFERENCE.test(String(value)), "Sandbox 交接參照格式無效。");
  }

  const directory = resolve(rootDirectory, ...HANDOFF_DIRECTORY_SEGMENTS);
  const timestamp = receipt.completedAt.replace(/[-:.]/g, "").replace("Z", "Z");
  const artifactPath = resolve(directory, `${timestamp}-${receipt.transactionRef}.json`);
  assert(artifactPath.startsWith(`${directory}\\`) || artifactPath.startsWith(`${directory}/`), "Sandbox 交接收據路徑無效。");
  await mkdir(directory, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  return receipt;
}

/** Bind the pending receipt to one caller-specified transaction before any write.
 * The runtime proof must come from the authenticated deployment, not its URL.
 * Raw identifiers remain in memory and are never returned as evidence.
 */
function assertPendingRefundTarget({ receipt, target, runtime, now = new Date() }) {
  assert(receipt?.schemaVersion === SCHEMA_VERSION && receipt.status === "PENDING_REFUND", "退款交接狀態無效。");
  assert(receipt.environment === "sandbox" && receipt.providerHost === SANDBOX_PROVIDER_HOST, "退款交接 provider 綁定無效。");
  assert(runtime?.environment === "preview" && runtime.payuniEnvironment === "sandbox"
    && runtime.providerHost === SANDBOX_PROVIDER_HOST && runtime.appHost === REFUND_STAGING_HOST
    && runtime.appHost === receipt.appHost
    && /^[a-f0-9]{40}$/.test(runtime.sourceCommit ?? ""), "退款交接必須綁定已驗證的非 Production 部署。");
  const completedAt = new Date(receipt.completedAt).getTime();
  const startedAt = new Date(receipt.startedAt).getTime();
  const current = now.getTime();
  assert(Number.isFinite(current) && Number.isFinite(completedAt) && Number.isFinite(startedAt)
    && startedAt <= completedAt && completedAt <= current && current - completedAt <= 24 * 60 * 60 * 1000,
  "退款交接已過期或時間無效。");
  assert(target?.vendorId && target.vendorId === runtime.vendorId
    && target.providerName === "payuni" && target.status === "paid"
    && target.refundedAmountCents === 0, "指定交易不符合租戶或退款條件。");
  assert(Number.isSafeInteger(receipt.amount) && receipt.amount > 0
    && Number.isSafeInteger(receipt.amount * 100) && target.grossAmountCents === receipt.amount * 100,
  "指定交易金額與交接不一致。");
  for (const [expected, value] of [
    [receipt.transactionRef, target.id], [receipt.orderRef, target.orderNumber], [receipt.tradeRef, target.providerTradeNo],
  ]) {
    assert(REFERENCE.test(String(expected)) && reference(value) === expected, "指定交易與交接參照不一致。");
  }
  for (const check of ["browserCheckout", "paymentCallbackMatched", "providerReconciliation"]) {
    assert(receipt.checks?.[check] === "passed", "退款交接缺少付款驗證。");
  }
  return Object.freeze({ transactionRef: receipt.transactionRef, sourceCommit: runtime.sourceCommit, amountCents: target.grossAmountCents });
}

export {
  SCHEMA_VERSION,
  createPendingRefundHandoff,
  reference,
  writePaymentHandoff,
  assertPendingRefundTarget,
};
