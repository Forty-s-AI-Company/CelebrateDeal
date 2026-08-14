import { Prisma, type Invoice, type Settlement } from "@prisma/client";
import {
  calculateSettlement,
  invoiceDueAt,
  invoiceNumber,
  StreamUsageReconciliationRequiredError,
} from "@/lib/billing";
import { getDb } from "@/lib/db";
import { upsertUsageSnapshot } from "@/lib/usage-estimation";

const TERMINAL_INVOICE_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

const INVOICE_AMOUNT_FIELDS = [
  "monthlyFeeCents",
  "overflowFeeCents",
  "paymentServiceFeeCents",
  "transactionServiceFeeCents",
  "affiliateManagementFeeCents",
  "subtotalCents",
  "taxCents",
  "totalCents",
] as const;

export type BillingCycleErrorCode =
  | "invalid_month"
  | "missing_vendor"
  | "locked"
  | "negative_payout"
  | "conflict"
  | "stream_reconciliation_required"
  | "terminal_invoice_amount_conflict";

/**
 * Domain errors are intentionally finite so server actions and jobs can map
 * them to safe user-facing outcomes without exposing database details.
 */
export class BillingCycleError extends Error {
  readonly code: BillingCycleErrorCode;

  constructor(code: BillingCycleErrorCode) {
    super(code);
    this.name = "BillingCycleError";
    this.code = code;
  }
}

export function isBillingCycleError(error: unknown): error is BillingCycleError {
  return error instanceof BillingCycleError;
}

export function isTerminalInvoiceStatus(status: string) {
  return TERMINAL_INVOICE_STATUSES.has(status);
}

type SettlementCalculation = Awaited<ReturnType<typeof calculateSettlement>>;
type InvoiceAmountSnapshot = ReturnType<typeof invoiceAmountSnapshot>;

function invoiceAmountSnapshot(calculation: SettlementCalculation) {
  const subtotalCents = calculation.monthlyFeeCents
    + calculation.overflowFeeCents
    + calculation.paymentServiceFeeCents
    + calculation.transactionServiceFeeCents
    + calculation.affiliateManagementFeeCents;

  return {
    monthlyFeeCents: calculation.monthlyFeeCents,
    overflowFeeCents: calculation.overflowFeeCents,
    paymentServiceFeeCents: calculation.paymentServiceFeeCents,
    transactionServiceFeeCents: calculation.transactionServiceFeeCents,
    affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
    subtotalCents,
    taxCents: 0,
    totalCents: subtotalCents,
  };
}

export function invoiceAmountsMatch(
  invoice: Pick<Invoice, typeof INVOICE_AMOUNT_FIELDS[number]>,
  expected: Pick<InvoiceAmountSnapshot, typeof INVOICE_AMOUNT_FIELDS[number]>,
) {
  return INVOICE_AMOUNT_FIELDS.every((field) => invoice[field] === expected[field]);
}

export type SettlementGenerationResult = {
  vendor: { id: string; slug: string };
  existingSettlement: Settlement | null;
  calculation: SettlementCalculation;
  settlement: Settlement;
  invoice: Invoice;
  outcome: "created" | "updated" | "terminal_unchanged";
};

/**
 * Generate one vendor's settlement and invoice as one Serializable unit.
 *
 * This is deliberately provider-neutral: it creates an auditable invoice but
 * never attempts a payment-method charge. The existing invoice checkout flow
 * remains the explicit payment boundary until a provider charge contract has
 * been verified in sandbox.
 */
export async function generateSettlementForVendor(vendorId: string, monthKey: string): Promise<SettlementGenerationResult> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new BillingCycleError("invalid_month");
  }

  const db = getDb();
  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, slug: true },
  });
  if (!vendor) throw new BillingCycleError("missing_vendor");

  const existingSettlement = await db.settlement.findUnique({
    where: { vendorId_monthKey: { vendorId, monthKey } },
  });
  if (existingSettlement?.lockedAt) throw new BillingCycleError("locked");

  await upsertUsageSnapshot(vendorId, monthKey);
  let calculation: SettlementCalculation;
  try {
    calculation = await calculateSettlement(vendorId, monthKey);
  } catch (error) {
    if (error instanceof StreamUsageReconciliationRequiredError) {
      throw new BillingCycleError("stream_reconciliation_required");
    }
    throw error;
  }
  const adjustmentAmountCents = existingSettlement?.adjustmentAmountCents ?? 0;
  const adjustmentReason = existingSettlement?.adjustmentReason ?? null;
  const finalPayoutAmountCents = calculation.payoutableAmountCents + adjustmentAmountCents;
  if (finalPayoutAmountCents < 0) throw new BillingCycleError("negative_payout");

  const amounts = {
    monthlyFeeCents: calculation.monthlyFeeCents,
    overflowFeeCents: calculation.overflowFeeCents,
    paymentServiceFeeCents: calculation.paymentServiceFeeCents,
    transactionServiceFeeCents: calculation.transactionServiceFeeCents,
    affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
    paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
    grossRevenueCents: calculation.grossRevenueCents,
    payoutableAmountCents: calculation.payoutableAmountCents,
    finalPayoutAmountCents,
    status: "draft",
  } as const;
  const expectedInvoiceAmounts = invoiceAmountSnapshot(calculation);
  const invoiceNo = invoiceNumber(vendor.slug, monthKey, vendorId);
  const dueAt = invoiceDueAt(monthKey, calculation.subscription?.billingCycleDay ?? 5);

  try {
    const result = await db.$transaction(async (tx) => {
      // Recheck inside the same Serializable transaction that writes the
      // settlement/invoice. A mismatch imported after calculateSettlement()
      // must either be observed here or force a serialization conflict; it
      // cannot slip through the calculation-to-write race window.
      if (calculation.streamUsageReconciliationStatus !== "MIGRATION_REQUIRED") {
        const blockingStreamReconciliation = await tx.streamUsageReconciliation.findFirst({
          where: {
            vendorId,
            monthKey,
            OR: [
              { status: "MISMATCH" },
              { status: "RESOLVED", resolution: "ESCALATED" },
            ],
          },
          select: { id: true },
        });
        if (blockingStreamReconciliation) {
          throw new BillingCycleError("stream_reconciliation_required");
        }
        const latestStreamReconciliation = await tx.streamUsageReconciliation.findFirst({
          where: { vendorId, monthKey },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if ((latestStreamReconciliation?.id ?? null) !== calculation.streamUsageReconciliationId) {
          throw new BillingCycleError("conflict");
        }
      }

      let settlement;
      if (existingSettlement) {
        const updated = await tx.settlement.updateMany({
          where: { id: existingSettlement.id, lockedAt: null, updatedAt: existingSettlement.updatedAt },
          data: amounts,
        });
        if (updated.count !== 1) throw new BillingCycleError("conflict");
        settlement = await tx.settlement.findUnique({ where: { id: existingSettlement.id } });
        if (!settlement) throw new BillingCycleError("conflict");
      } else {
        settlement = await tx.settlement.create({
          data: {
            vendorId,
            monthKey,
            ...amounts,
            adjustmentAmountCents,
            adjustmentReason,
          },
        });
      }

      const currentInvoice = await tx.invoice.findUnique({ where: { invoiceNumber: invoiceNo } });
      if (currentInvoice && isTerminalInvoiceStatus(currentInvoice.status)) {
        if (!invoiceAmountsMatch(currentInvoice, expectedInvoiceAmounts)) {
          throw new BillingCycleError("terminal_invoice_amount_conflict");
        }

        const invoice = await tx.invoice.update({ where: { id: currentInvoice.id }, data: { dueAt } });
        return { settlement, invoice, outcome: "terminal_unchanged" as const };
      }

      const invoice = await tx.invoice.upsert({
        where: { invoiceNumber: invoiceNo },
        create: {
          vendorId,
          monthKey,
          invoiceNumber: invoiceNo,
          invoiceType: "monthly",
          ...expectedInvoiceAmounts,
          dueAt,
          status: "issued",
        },
        update: {
          ...expectedInvoiceAmounts,
          // Regeneration can refresh an open invoice, but never changes its
          // status or paidAt. Terminal invoices use the guarded branch above.
          dueAt,
        },
      });

      return { settlement, invoice, outcome: existingSettlement ? "updated" as const : "created" as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return { vendor, existingSettlement, calculation, ...result };
  } catch (error) {
    if (error instanceof BillingCycleError) throw error;
    if (typeof error === "object" && error !== null && "code" in error
      && ["P2002", "P2025", "P2034"].includes(String(error.code))) {
      throw new BillingCycleError("conflict");
    }
    throw error;
  }
}
