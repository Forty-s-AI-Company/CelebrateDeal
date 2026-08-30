import { invoiceDueAt, monthRange } from "@/lib/billing";
import { BillingCycleError, generateSettlementForVendor } from "@/lib/billing-cycle";
import { getDb } from "@/lib/db";

export type BillingCycleJobResult = {
  monthKey: string;
  processed: number;
  skippedNotDue: number;
  locked: number;
  conflicts: number;
  terminalInvoiceConflicts: number;
  streamReconciliationRequired: number;
  missingSubscription: number;
  failed: number;
  overdueMarked: number;
  automaticCharges: 0;
};

function monthKeyForPreviousMonth(now: Date) {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Generate due monthly invoices and mark issued invoices overdue.
 *
 * The job intentionally stops at invoice generation. It does not charge a
 * stored payment method, because the provider-neutral application contract
 * does not yet prove a PayUni recurring-charge request in sandbox.
 */
export async function runBillingCycleJob(now = new Date()): Promise<BillingCycleJobResult> {
  const db = getDb();
  const monthKey = monthKeyForPreviousMonth(now);
  const { start, end } = monthRange(monthKey);
  const subscriptions = await db.vendorSubscription.findMany({
    where: {
      status: "active",
      startedAt: { lt: end },
      OR: [{ endedAt: null }, { endedAt: { gte: start } }],
    },
    select: { vendorId: true, billingCycleDay: true, startedAt: true },
    orderBy: { startedAt: "desc" },
  });

  const result: BillingCycleJobResult = {
    monthKey,
    processed: 0,
    skippedNotDue: 0,
    locked: 0,
    conflicts: 0,
    terminalInvoiceConflicts: 0,
    streamReconciliationRequired: 0,
    missingSubscription: 0,
    failed: 0,
    overdueMarked: 0,
    automaticCharges: 0,
  };
  const seenVendorIds = new Set<string>();

  // calculateSettlement selects the newest active subscription. Mirror that
  // deterministic ordering here so one vendor is never generated twice.
  for (const subscription of subscriptions) {
    if (seenVendorIds.has(subscription.vendorId)) continue;
    seenVendorIds.add(subscription.vendorId);

    if (invoiceDueAt(monthKey, subscription.billingCycleDay) > now) {
      result.skippedNotDue += 1;
      continue;
    }

    try {
      await generateSettlementForVendor(subscription.vendorId, monthKey);
      result.processed += 1;
    } catch (error) {
      if (error instanceof BillingCycleError) {
        if (error.code === "locked") result.locked += 1;
        else if (error.code === "conflict") result.conflicts += 1;
        else if (error.code === "terminal_invoice_amount_conflict") result.terminalInvoiceConflicts += 1;
        else if (error.code === "stream_reconciliation_required") result.streamReconciliationRequired += 1;
        else if (error.code === "missing_vendor") result.missingSubscription += 1;
        else result.failed += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  const overdue = await db.invoice.updateMany({
    where: { status: "issued", dueAt: { lt: now } },
    data: { status: "overdue" },
  });
  result.overdueMarked = overdue.count;
  return result;
}
