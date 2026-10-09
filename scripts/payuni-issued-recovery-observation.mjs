import { createHash } from "node:crypto";

const TERMINAL_UNPAID = new Set(["2", "3", "4"]);
const digest = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function reject() {
  // Provider responses and identifiers must never enter failure output.
  throw new Error("PAYUNI_ORIGINAL_RECOVERY_OBSERVATION_REJECTED");
}

function identity(row, expected) {
  if (!row || row.MerTradeNo !== expected.orderNumber
    || typeof row.TradeNo !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(row.TradeNo)
    || String(row.TradeAmt) !== String(expected.amount)
    || String(row.PaymentType) !== "1") reject();
  return row.TradeNo;
}

/** Observe one failed Sandbox trade and at most one original-page retry.
 * The caller must prepare the fixed synthetic checkout and keep its original
 * browser page. This function cannot create a checkout or select another order.
 * Query responses must come from the authenticated fixed Sandbox query adapter.
 * A processing/unknown response never authorizes another payment attempt.
 */
export async function observeIssuedRecovery({ expected, queryProvider, originalPage }) {
  if (!expected || !/^[A-Za-z0-9_-]{1,25}$/.test(expected.orderNumber ?? "")
    || !Number.isSafeInteger(expected.amount) || expected.amount <= 0
    || typeof queryProvider !== "function"
    || typeof originalPage?.retryAvailable !== "function"
    || typeof originalPage?.retryOnce !== "function") reject();

  const before = await queryProvider(expected.orderNumber);
  const tradeNo = identity(before, expected);
  if (!TERMINAL_UNPAID.has(String(before.TradeStatus))) reject();
  const common = {
    schemaVersion: "celebratedeal-payuni-issued-recovery-observation/v1",
    orderRef: digest(expected.orderNumber), tradeRef: digest(tradeNo),
    failedTradeStatus: String(before.TradeStatus), amount: expected.amount,
    initialProviderQueries: 1, retryAttempts: 0, finalProviderQueries: 0,
    replacementCheckoutRequested: false,
  };
  if (await originalPage.retryAvailable() !== true) {
    return { ...common, result: "ORIGINAL_PAGE_RETRY_UNAVAILABLE", sameTrade: null, paid: false };
  }
  // There is no fallback that reposts UPP or creates a replacement transaction.
  await originalPage.retryOnce();
  const after = await queryProvider(expected.orderNumber);
  const afterTradeNo = identity(after, expected);
  const sameTrade = afterTradeNo === tradeNo;
  const paid = String(after.TradeStatus) === "1";
  return {
    ...common, retryAttempts: 1, finalProviderQueries: 1, sameTrade, paid,
    result: !sameTrade ? "REPLACEMENT_TRADE_DETECTED"
      : paid ? "SAME_TRADE_PAYMENT_OBSERVED" : "SAME_TRADE_NOT_PAID",
  };
}
