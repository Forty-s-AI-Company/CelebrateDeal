import { reference } from "./payuni-sandbox-payment-handoff.mjs";

export const ORIGINAL_REFUND_HANDOFF_SCHEMA = "celebratedeal-q1-original-refund-handoff/v1";
export const ORIGINAL_TRANSACTION_SOURCE = "9acfe8d2dba62430e950cff2c0387841ab91f44b";
const APP_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const PROVIDER_HOST = "sandbox-api.payuni.com.tw";
const VENDOR_ID = "wp4_synthetic_vendor_v1";
function wholeAmount(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.0{1,2})?$/.test(value)) return undefined;
  const amount = Number(value); return Number.isSafeInteger(amount) ? amount : undefined;
}
function requireSafe(condition) {
  if (!condition) throw new Error("Fixed original Sandbox refund handoff rejected.");
}

/** Keep original provenance distinct from executing source. This validates a
 * freshly authenticated fixed-catalog server proof, not a caller-selected order. */
export function assertOriginalRefundProof(proof, executionSource) {
  requireSafe(/^[a-f0-9]{40}$/.test(executionSource ?? "")
    && proof?.schemaVersion === "celebratedeal-payuni-pending-refund-proof/v1"
    && proof.sourceCommit === executionSource && proof.transactionSourceCommit === ORIGINAL_TRANSACTION_SOURCE
    && proof.historicalOriginalBound === true && proof.vendorId === VENDOR_ID
    && proof.environment === "preview" && proof.payuniEnvironment === "sandbox"
    && proof.appHost === APP_HOST && proof.providerHost === PROVIDER_HOST
    && proof.databaseBound === true && proof.nonProductionScope === "fixed-staging-project"
    && proof.paymentCallbackMatched === true && proof.grossAmountCents === 100);
  for (const key of ["transactionRef", "orderRef", "tradeRef"]) requireSafe(/^[a-f0-9]{12}$/.test(proof[key] ?? ""));
}

/** A fresh original refund handoff records the observed finance UI, not a
 * fabricated historical checkout. Raw identifiers stay in process memory.
 * paid must come from the signed Sandbox query adapter; this is no provider call. */
export function createOriginalRefundHandoff({ proof, paid, target, browser, executionSource, startedAt, completedAt, now = new Date() }) {
  assertOriginalRefundProof(proof, executionSource);
  requireSafe(proof.status === "paid" && proof.refundedAmountCents === 0 && proof.refundRecordCount === 0);
  requireSafe(reference(target?.transactionId) === proof.transactionRef && reference(target?.orderNumber) === proof.orderRef
    && reference(target?.providerTradeNo) === proof.tradeRef);
  requireSafe(typeof paid?.MerTradeNo === "string" && paid.MerTradeNo === target.orderNumber
    && typeof paid.TradeNo === "string" && paid.TradeNo === target.providerTradeNo
    && String(paid.TradeStatus) === "1" && wholeAmount(paid.TradeAmt) === 1 && String(paid.PaymentType) === "1"
    && paid.DataSource === "A" && wholeAmount(paid.RemainAmt) === 1 && wholeAmount(paid.RefundAmt) === 0);
  requireSafe(browser?.origin === `https://${APP_HOST}` && browser.exactTransactionRef === proof.transactionRef
    && browser.exactRefundFormCount === 1 && browser.formTransactionRef === proof.transactionRef
    && browser.csrfPresent === true && browser.financeAuthenticated === true);
  const started = new Date(startedAt).getTime(), completed = new Date(completedAt).getTime(), current = now.getTime();
  requireSafe(Number.isFinite(started) && Number.isFinite(completed) && Number.isFinite(current)
    && started <= completed && completed <= current && current - completed <= 300000);
  return Object.freeze({ schemaVersion: ORIGINAL_REFUND_HANDOFF_SCHEMA, status: "PENDING_REFUND", environment: "sandbox",
    appHost: APP_HOST, providerHost: PROVIDER_HOST, executionSource, transactionSourceCommit: ORIGINAL_TRANSACTION_SOURCE,
    transactionRef: proof.transactionRef, orderRef: proof.orderRef, tradeRef: proof.tradeRef, amount: 1,
    startedAt: new Date(started).toISOString(), completedAt: new Date(completed).toISOString(),
    checks: Object.freeze({ originalFinanceRefundForm: "passed", paymentCallbackMatched: "passed", providerReconciliation: "passed" }) });
}

/** Revalidate on every refund observation. Never reinterpret a generic checkout
 * receipt as proof of this historical original or substitute another trade. */
export function assertOriginalProofMatchesHandoff(receipt, proof, transactionId, executionSource, now = new Date()) {
  assertOriginalRefundProof(proof, executionSource);
  requireSafe(receipt?.schemaVersion === ORIGINAL_REFUND_HANDOFF_SCHEMA && receipt.status === "PENDING_REFUND"
    && receipt.environment === "sandbox" && receipt.appHost === APP_HOST && receipt.providerHost === PROVIDER_HOST
    && receipt.executionSource === executionSource && receipt.transactionSourceCommit === ORIGINAL_TRANSACTION_SOURCE
    && receipt.amount === 1 && reference(transactionId) === receipt.transactionRef);
  for (const key of ["transactionRef", "orderRef", "tradeRef"]) requireSafe(receipt[key] === proof[key]);
  for (const key of ["originalFinanceRefundForm", "paymentCallbackMatched", "providerReconciliation"]) requireSafe(receipt.checks?.[key] === "passed");
  const started = new Date(receipt.startedAt).getTime(), completed = new Date(receipt.completedAt).getTime(), current = now.getTime();
  requireSafe(Number.isFinite(started) && Number.isFinite(completed) && Number.isFinite(current)
    && started <= completed && completed <= current && current - completed <= 300000);
}