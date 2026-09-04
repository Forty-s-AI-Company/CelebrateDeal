import { Prisma, type Invoice, type Settlement } from "@prisma/client";
import {
  calculateSettlement,
  invoiceDueAt,
  invoiceNumber,
  monthRange,
  PlatformSubscriptionMonthlyFeeCreditConflictError,
  platformSubscriptionCheckoutPaymentSnapshot,
  platformSubscriptionCheckoutPaymentSnapshotsMatch,
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

const SETTLEMENT_AMOUNT_FIELDS = [
  "monthlyFeeCents",
  "overflowFeeCents",
  "paymentServiceFeeCents",
  "transactionServiceFeeCents",
  "affiliateManagementFeeCents",
  "paymentGatewayFeeCents",
  "grossRevenueCents",
  "payoutableAmountCents",
  "adjustmentAmountCents",
  "finalPayoutAmountCents",
] as const;

export type BillingCycleErrorCode =
  | "invalid_month"
  | "missing_vendor"
  | "locked"
  | "negative_payout"
  | "conflict"
  | "stream_reconciliation_required"
  | "terminal_invoice_amount_conflict"
  | "terminal_settlement_amount_conflict"
  | "historical_monthly_fee_conflict"
  | "platform_subscription_monthly_fee_credit_conflict";

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
type SettlementAmountSnapshot = ReturnType<typeof settlementAmountSnapshot>;

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

function calculationWithHistoricalInvoiceAmounts(
  calculation: SettlementCalculation,
  amounts: Pick<Invoice,
    "monthlyFeeCents" | "overflowFeeCents" | "paymentServiceFeeCents" | "transactionServiceFeeCents" | "affiliateManagementFeeCents"
  >,
) {
  return { ...calculation, ...amounts };
}

function canApplyTrustedMonthlyFeeCreditToOpenInvoice(
  invoice: Invoice,
  calculation: SettlementCalculation,
) {
  const planMonthlyPriceCents = calculation.subscription?.plan.monthlyPriceCents;
  return calculation.platformSubscriptionCheckoutCreditApplied
    && (invoice.status === "issued" || invoice.status === "overdue")
    && typeof planMonthlyPriceCents === "number"
    && invoice.monthlyFeeCents === planMonthlyPriceCents;
}

async function assertCalculationEvidenceIsUnchanged(
  tx: Prisma.TransactionClient,
  calculation: SettlementCalculation,
  vendorId: string,
  monthKey: string,
  start: Date,
  end: Date,
) {
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
    if (blockingStreamReconciliation) throw new BillingCycleError("stream_reconciliation_required");

    const latestStreamReconciliation = await tx.streamUsageReconciliation.findFirst({
      where: { vendorId, monthKey },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if ((latestStreamReconciliation?.id ?? null) !== calculation.streamUsageReconciliationId) {
      throw new BillingCycleError("conflict");
    }
  }

  const checkoutTransactions = await tx.paymentTransaction.findMany({
    where: { vendorId, occurredAt: { gte: start, lt: end } },
    select: {
      id: true,
      vendorId: true,
      status: true,
      grossAmountCents: true,
      currency: true,
      occurredAt: true,
      refundedAmountCents: true,
      metadata: true,
    },
  });
  if (!platformSubscriptionCheckoutPaymentSnapshotsMatch(
    calculation.platformSubscriptionCheckoutPaymentSnapshot,
    platformSubscriptionCheckoutPaymentSnapshot(checkoutTransactions),
  )) {
    throw new BillingCycleError("platform_subscription_monthly_fee_credit_conflict");
  }
}

async function currentInvoiceWithPersistedAmounts(
  tx: Prisma.TransactionClient,
  invoiceNo: string,
  existingSettlement: Settlement | null,
  calculation: SettlementCalculation,
  vendorId: string,
) {
  const currentInvoice = await tx.invoice.findUnique({ where: { invoiceNumber: invoiceNo } });
  const trustedOpenInvoiceMonthlyFeeCredit = currentInvoice
    && canApplyTrustedMonthlyFeeCreditToOpenInvoice(currentInvoice, calculation);
  if (
    currentInvoice
    && calculation.platformSubscriptionCheckoutCreditApplied
    && !trustedOpenInvoiceMonthlyFeeCredit
    && !isTerminalInvoiceStatus(currentInvoice.status)
  ) {
    throw new BillingCycleError("historical_monthly_fee_conflict");
  }
  if (currentInvoice && existingSettlement && currentInvoice.monthlyFeeCents !== existingSettlement.monthlyFeeCents) {
    throw new BillingCycleError("historical_monthly_fee_conflict");
  }
  if (trustedOpenInvoiceMonthlyFeeCredit) {
    // Invoice checkout transactions can be created in a later month, so this
    // guard deliberately covers all transactions for this invoice.
    const invoicePaymentTransactions = await tx.paymentTransaction.findMany({
      where: {
        vendorId,
        AND: [
          { metadata: { path: ["billingPurpose"], equals: "invoice_payment" } },
          { metadata: { path: ["invoiceId"], equals: currentInvoice.id } },
        ],
      },
      select: { id: true },
    });
    if (invoicePaymentTransactions.length > 0) {
      throw new BillingCycleError("platform_subscription_monthly_fee_credit_conflict");
    }
  }

  const calculationForPersistedAmounts = calculationWithHistoricalInvoiceAmounts(
    calculation,
    currentInvoice
      ? {
        monthlyFeeCents: trustedOpenInvoiceMonthlyFeeCredit ? 0 : currentInvoice.monthlyFeeCents,
        overflowFeeCents: currentInvoice.overflowFeeCents,
        paymentServiceFeeCents: currentInvoice.paymentServiceFeeCents,
        transactionServiceFeeCents: currentInvoice.transactionServiceFeeCents,
        affiliateManagementFeeCents: currentInvoice.affiliateManagementFeeCents,
      }
      : {
        monthlyFeeCents: existingSettlement?.monthlyFeeCents ?? calculation.monthlyFeeCents,
        overflowFeeCents: existingSettlement?.overflowFeeCents ?? calculation.overflowFeeCents,
        paymentServiceFeeCents: existingSettlement?.paymentServiceFeeCents ?? calculation.paymentServiceFeeCents,
        transactionServiceFeeCents: existingSettlement?.transactionServiceFeeCents ?? calculation.transactionServiceFeeCents,
        affiliateManagementFeeCents: existingSettlement?.affiliateManagementFeeCents ?? calculation.affiliateManagementFeeCents,
      },
  );
  return { currentInvoice, calculationForPersistedAmounts };
}

function settlementAmountSnapshot(
  calculation: SettlementCalculation,
  adjustmentAmountCents: number,
  finalPayoutAmountCents: number,
) {
  return {
    monthlyFeeCents: calculation.monthlyFeeCents,
    overflowFeeCents: calculation.overflowFeeCents,
    paymentServiceFeeCents: calculation.paymentServiceFeeCents,
    transactionServiceFeeCents: calculation.transactionServiceFeeCents,
    affiliateManagementFeeCents: calculation.affiliateManagementFeeCents,
    paymentGatewayFeeCents: calculation.paymentGatewayFeeCents,
    grossRevenueCents: calculation.grossRevenueCents,
    payoutableAmountCents: calculation.payoutableAmountCents,
    adjustmentAmountCents,
    finalPayoutAmountCents,
  };
}

export function invoiceAmountsMatch(
  invoice: Pick<Invoice, typeof INVOICE_AMOUNT_FIELDS[number]>,
  expected: Pick<InvoiceAmountSnapshot, typeof INVOICE_AMOUNT_FIELDS[number]>,
) {
  return INVOICE_AMOUNT_FIELDS.every((field) => invoice[field] === expected[field]);
}

export function settlementAmountsMatch(
  settlement: Pick<Settlement, typeof SETTLEMENT_AMOUNT_FIELDS[number]>,
  expected: Pick<SettlementAmountSnapshot, typeof SETTLEMENT_AMOUNT_FIELDS[number]>,
) {
  return SETTLEMENT_AMOUNT_FIELDS.every((field) => settlement[field] === expected[field]);
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
    if (error instanceof PlatformSubscriptionMonthlyFeeCreditConflictError) {
      throw new BillingCycleError("platform_subscription_monthly_fee_credit_conflict");
    }
    throw error;
  }
  const adjustmentAmountCents = existingSettlement?.adjustmentAmountCents ?? 0;
  const adjustmentReason = existingSettlement?.adjustmentReason ?? null;
  const finalPayoutAmountCents = calculation.payoutableAmountCents + adjustmentAmountCents;
  if (finalPayoutAmountCents < 0) throw new BillingCycleError("negative_payout");

  const invoiceNo = invoiceNumber(vendor.slug, monthKey, vendorId);
  const dueAt = invoiceDueAt(monthKey, calculation.subscription?.billingCycleDay ?? 5);
  const { start, end } = monthRange(monthKey);

  try {
    const result = await db.$transaction(async (tx) => {
      await assertCalculationEvidenceIsUnchanged(tx, calculation, vendorId, monthKey, start, end);
      const { currentInvoice, calculationForPersistedAmounts } = await currentInvoiceWithPersistedAmounts(
        tx,
        invoiceNo,
        existingSettlement,
        calculation,
        vendorId,
      );
      const settlementAmounts = settlementAmountSnapshot(
        calculationForPersistedAmounts,
        adjustmentAmountCents,
        finalPayoutAmountCents,
      );
      const amounts = {
        ...settlementAmounts,
        status: "draft",
      } as const;
      const expectedInvoiceAmounts = invoiceAmountSnapshot(calculationForPersistedAmounts);

      if (currentInvoice && isTerminalInvoiceStatus(currentInvoice.status)) {
        const currentSettlement = existingSettlement
          ? await tx.settlement.findUnique({ where: { id: existingSettlement.id } })
          : null;
        if (!currentSettlement || !settlementAmountsMatch(currentSettlement, settlementAmounts)) {
          throw new BillingCycleError("terminal_settlement_amount_conflict");
        }
        if (!invoiceAmountsMatch(currentInvoice, expectedInvoiceAmounts)) {
          throw new BillingCycleError("terminal_invoice_amount_conflict");
        }

        // Terminal records are immutable after both accounting snapshots match.
        return { settlement: currentSettlement, invoice: currentInvoice, outcome: "terminal_unchanged" as const };
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
