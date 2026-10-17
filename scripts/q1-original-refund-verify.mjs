import { assertOriginalRefundProof, ORIGINAL_TRANSACTION_SOURCE } from "./q1-original-refund-handoff.mjs";
import { reference } from "./payuni-sandbox-payment-handoff.mjs";
import { isCompletedFullCreditRefund } from "./payuni-credit-refund-query-contract.mjs";
const rejected = () => { throw new Error("Original refund readonly verification rejected."); };

/** Fresh protected proof/query, independent of expired historical handoffs.
 * No browser, click, reservation writer or provider close adapter is accepted. */
export async function verifyReservedOriginalRefund({ target, executionSource, loadProof, queryProvider,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onStage, now = () => new Date() }) {
  if (target?.reservationVerified !== true) rejected();
  const references = { transactionRef: reference(target.transactionId), orderRef: reference(target.orderNumber), tradeRef: reference(target.providerTradeNo), amount: 1 };
  let terminal;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await onStage?.({ stage: "readonly-original-refund-verification" });
    const proof = await loadProof(); assertOriginalRefundProof(proof, executionSource);
    if (proof.status !== "refunded" || proof.refundedAmountCents !== 100 || proof.refundRecordCount !== 1
      || proof.singleProcessedRefund !== true || proof.refundPersistencePassed !== true) rejected();
    for (const key of ["transactionRef", "orderRef", "tradeRef"]) if (proof[key] !== references[key]) rejected();
    if (isCompletedFullCreditRefund(await queryProvider(target.orderNumber), references)) { terminal = proof; break; }
    // Pending 1/8 only permits another observation, never another submission.
    await sleep(2000);
  }
  if (!terminal) rejected();
  return Object.freeze({ schemaVersion: "celebratedeal-q1-original-refund-terminal/v1", status: "ORIGINAL_REFUND_TERMINAL_VERIFIED",
    executionSource, transactionSourceCommit: ORIGINAL_TRANSACTION_SOURCE, ...references, completedAt: now().toISOString(),
    checks: { paymentTransactionRefunded: "passed", refundRecordProcessed: "passed", singleRefundRecord: "passed",
      refundVisibleInProviderQuery: "passed", refundIdempotency: target.duplicateUIVerified === true ? "passed" : "not-observed-by-readonly-resume" },
    refundSubmitted: false, readonlyResume: true, productionOperations: false });
}