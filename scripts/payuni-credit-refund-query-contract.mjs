import { reference } from "./payuni-sandbox-payment-handoff.mjs";

function wholeAmount(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.0{1,2})?$/.test(value)) return undefined;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : undefined;
}

/** CREDIT query v2.0: status 2 is terminal; 1/8 only acknowledge pending work.
 * RefundAmt is the last refund. Only the remaining balance proves full refund.
 * This predicate validates an observation; it never authorizes another refund.
 */
export function isCompletedFullCreditRefund(provider, receipt) {
  if (typeof provider?.MerTradeNo !== "string" || !provider.MerTradeNo || provider.MerTradeNo.trim() !== provider.MerTradeNo
    || typeof provider?.TradeNo !== "string" || !provider.TradeNo || provider.TradeNo.trim() !== provider.TradeNo) return false;
  const lastRefund = wholeAmount(provider?.RefundAmt);
  return reference(provider?.MerTradeNo) === receipt.orderRef && reference(provider?.TradeNo) === receipt.tradeRef
    && wholeAmount(provider?.TradeAmt) === receipt.amount && String(provider?.TradeStatus) === "1"
    && String(provider?.PaymentType) === "1" && provider?.DataSource === "A"
    && String(provider?.RefundStatus) === "2" && wholeAmount(provider?.RemainAmt) === 0
    && lastRefund !== undefined && lastRefund > 0 && lastRefund <= receipt.amount;
}
