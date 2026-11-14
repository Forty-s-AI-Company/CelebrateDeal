import { after } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { dispatchAutomationEvent } from "@/lib/automation-workflow";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * F-4 PR 3: the `payment_paid` automation trigger (docs/domain-workflows.md
 * 「自動化規則」, docs/product/delayed-steps-design.md §8).
 *
 * The payment webhook (src/lib/payment-webhooks.ts) calls
 * `runPaymentPaidAutomationAfterCommit` once, after its serializable
 * transaction has committed, and only when that transaction moved a canonical
 * CommerceOrder to `paid` for the first time. Nothing here can change the
 * payment: the call never throws, it never runs inside the payment
 * transaction, and inside a request it only registers an `after()` hook, so
 * the provider gets its response before any rule runs.
 *
 * Every input is re-read from the server's records here: the order (bound to
 * the vendor the webhook resolved from the server-created checkout), its paid
 * amount, its customer key and the buyer's e-mail. Nothing comes from the
 * provider payload or the request.
 */

/** Outside a request (scripts, tests) the dispatch runs inline; it stops waiting after this long. */
export const PAYMENT_PAID_AUTOMATION_INLINE_TIMEOUT_MS = 15_000;

type PaymentPaidAutomationDb = Parameters<typeof dispatchAutomationEvent>[0] & Pick<PrismaClient, "commerceOrder">;

export type PaymentPaidAutomationOutcome =
  | { status: "not_applicable" }
  | { status: "no_rules" }
  | { status: "dispatched"; results: Array<{ ruleId: string; status: string }> };

/** The buyer's e-mail from the order's encrypted envelope, or null (reported) when it cannot be read. */
function buyerEmail(order: { id: string; buyerEncryptedEnvelope: string; shippingEncryptedEnvelope: string | null }, vendorId: string) {
  try {
    const pii = revealCommerceOrderPii({
      buyerEncrypted: order.buyerEncryptedEnvelope,
      shippingEncrypted: order.shippingEncryptedEnvelope,
    }, { vendorId, orderId: order.id });
    return pii.buyer.email || null;
  } catch (error) {
    // The e-mail action then reports `recipient_not_linked`; tags, vouchers
    // and LINE still run.
    report(error, "buyer_email");
    return null;
  }
}

/**
 * Runs the vendor's active `payment_paid` rules for one order. A vendor without
 * one stops at the first query. The order must
 * be this vendor's, still `paid` with nothing refunded, not a test order, and
 * the vendor not suspended (F-036: a suspended vendor's payment is recorded
 * but nothing is provisioned or sent). Rules only ever see the server's
 * `paidAmountCents`. Idempotent: `dispatchAutomationEvent` claims one
 * execution log per rule and order (`order:{orderId}:version:{n}`), so a
 * second call for the same order repeats nothing a completed execution did.
 */
export async function dispatchPaymentPaidAutomationForOrder(
  input: { vendorId: string; orderId: string },
  db: PaymentPaidAutomationDb = getDb(),
): Promise<PaymentPaidAutomationOutcome> {
  // Most vendors have no payment rule: they never read (or decrypt) the order.
  const rule = await db.automationRule.findFirst({
    where: { vendorId: input.vendorId, trigger: "payment_paid", isActive: true },
    select: { id: true },
  });
  if (!rule) return { status: "no_rules" };
  const order = await db.commerceOrder.findFirst({
    where: {
      id: input.orderId,
      vendorId: input.vendorId,
      status: "paid",
      refundedAmountCents: 0,
      isTestOrder: false,
      vendor: { is: { suspendedAt: null } },
    },
    select: {
      id: true,
      paidAmountCents: true,
      currency: true,
      checkoutIdentityHash: true,
      automationCustomerKeyHash: true,
      buyerEncryptedEnvelope: true,
      shippingEncryptedEnvelope: true,
    },
  });
  if (!order) return { status: "not_applicable" };
  const recipientEmail = buyerEmail(order, input.vendorId);
  const results = await dispatchAutomationEvent(db, {
    vendorId: input.vendorId,
    // The execution's idempotency key is bound to the order, not to this id.
    eventId: `payment-paid:${order.id}`,
    trigger: "payment_paid",
    subjectType: "buyer_order",
    subjectId: order.id,
    subjectKeyHash: order.automationCustomerKeyHash ?? order.checkoutIdentityHash,
    orderAmountCents: order.paidAmountCents,
    currency: order.currency,
    ...(recipientEmail ? { recipientEmail } : {}),
  });
  return { status: "dispatched", results };
}

/** What a report says: which step failed. */
export type PaymentPaidAutomationReport = "dispatch" | "rule_failed" | "buyer_email" | "inline" | "inline_timeout";

/**
 * Only keys of monitoring.ts SAFE_CONTEXT_KEYS reach Sentry, so the report is
 * `source` + `operation` (fixed values, no vendor, order or buyer data).
 */
function report(error: unknown, operation: PaymentPaidAutomationReport) {
  try {
    captureOperationalError(error, { source: "payment_paid_automation", operation });
  } catch {
    // Monitoring must never reach the payment.
  }
}

/**
 * Never rejects. A failed rule (an action that threw, or an automation e-mail
 * without its unsubscribe link) is recorded as `failed` on its execution log
 * and reported here; it is not retried automatically.
 */
async function runContained(input: { vendorId: string; orderId: string }) {
  try {
    const outcome = await dispatchPaymentPaidAutomationForOrder(input);
    if (outcome.status !== "dispatched") return;
    // Which rule and why stays on its execution log, visible to the merchant.
    if (outcome.results.some((result) => result.status === "failed")) report(new Error("Payment-paid automation rule failed."), "rule_failed");
  } catch (error) {
    report(error, "dispatch");
  }
}

async function waitAtMost(work: Promise<void>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    const result = await Promise.race([work.then(() => "done" as const), timedOut]);
    if (result === "timeout") report(new Error("Payment-paid automation timed out."), "inline_timeout");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Called by the payment webhook after its transaction committed the order's
 * first paid transition. In a request (the PayUni notify/return route, the
 * webhook-retry job, the admin replay routes) it registers an `after()` hook
 * and returns at once, so the webhook response is not delayed; the hook runs
 * within the route's `maxDuration`. Outside a request (`after` throws there)
 * it runs inline and waits at most PAYMENT_PAID_AUTOMATION_INLINE_TIMEOUT_MS.
 * Never throws in either case.
 */
export async function runPaymentPaidAutomationAfterCommit(input: { vendorId: string; orderId: string }): Promise<"scheduled" | "ran_inline"> {
  try {
    after(() => runContained(input));
    return "scheduled";
  } catch {
    // Outside a request scope (or `after` unavailable): run it now instead.
  }
  try {
    await waitAtMost(runContained(input), PAYMENT_PAID_AUTOMATION_INLINE_TIMEOUT_MS);
  } catch (error) {
    report(error, "inline");
  }
  return "ran_inline";
}
