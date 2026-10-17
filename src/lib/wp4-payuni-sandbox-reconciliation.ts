import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { reconcilePayUniRefund } from "@/lib/payuni-refund-reconciliation";
import { getPaymentProvider } from "@/lib/payment-providers";
import type { PaymentTransaction, PrismaClient } from "@prisma/client";

export const WP4_PAYUNI_PURPOSES = [
  "buyer_order",
  "platform_subscription",
  "invoice_payment",
] as const;

export type Wp4PayUniPurpose = typeof WP4_PAYUNI_PURPOSES[number];

const SOURCE_SHA = /^[a-f0-9]{40}$/u;

type TransactionIdentity = {
  vendorId: string;
  providerName: string;
  grossAmountCents: number;
  status: string;
  metadata: unknown;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * An exact commit marker separates the current bounded run from any historical
 * staging fixture transaction. It is server-owned metadata: external routes
 * must compare it with their deployment lineage, never accept it as input.
 */
export function wp4SourceCommitFromMetadata(metadata: unknown): string | null {
  const sourceCommit = objectValue(metadata)?.wp4SourceCommit;
  return typeof sourceCommit === "string" && SOURCE_SHA.test(sourceCommit)
    ? sourceCommit
    : null;
}

export function isWp4PayUniSandboxTransactionForSource(
  transaction: TransactionIdentity,
  sourceCommit: string,
): boolean {
  return SOURCE_SHA.test(sourceCommit)
    && isWp4PayUniSandboxTransaction(transaction)
    && wp4SourceCommitFromMetadata(transaction.metadata) === sourceCommit;
}

/**
 * Resolves only the three server-owned WP4 payment purposes. Unknown metadata
 * is deliberately not coerced: callers must not be able to turn an unrelated
 * payment into a Sandbox reconciliation candidate.
 */
export function wp4PayUniPurposeFromMetadata(metadata: unknown): Wp4PayUniPurpose | null {
  const billingPurpose = objectValue(metadata)?.billingPurpose;
  // The platform-plan checkout has a deliberately more specific persisted
  // marker than the release gate's business-purpose label. Keep that mapping
  // here, rather than accepting a synthetic `platform_subscription` marker
  // that the production checkout core never writes.
  if (billingPurpose === "platform_subscription_checkout") return "platform_subscription";
  return typeof billingPurpose === "string" && (WP4_PAYUNI_PURPOSES as readonly string[]).includes(billingPurpose)
    ? billingPurpose as Wp4PayUniPurpose
    : null;
}

/**
 * Tests a row selected by the server against the deterministic staging-only
 * fixture boundary. It does not accept a transaction identifier, amount, or
 * provider value from an HTTP caller.
 */
export function isWp4PayUniSandboxTransaction(transaction: TransactionIdentity): boolean {
  if (
    transaction.vendorId !== WP4_SANDBOX_FIXTURE.vendorId
    || transaction.providerName !== "payuni"
    || !Number.isSafeInteger(transaction.grossAmountCents)
    || transaction.grossAmountCents <= 0
    || !["paid", "partially_refunded", "refunded"].includes(transaction.status)
  ) return false;

  const purpose = wp4PayUniPurposeFromMetadata(transaction.metadata);
  const metadata = objectValue(transaction.metadata);
  if (!purpose || !metadata) return false;

  if (purpose === "buyer_order") return metadata.productId === WP4_SANDBOX_FIXTURE.productId;
  if (purpose === "platform_subscription") return metadata.planId === WP4_SANDBOX_FIXTURE.planId;
  return metadata.invoiceId === WP4_SANDBOX_FIXTURE.invoiceId;
}

export type Wp4PayUniSandboxReconciliationResult = {
  reconciled: boolean;
  status: "RECONCILED" | "FIXTURE_UNAVAILABLE" | "PENDING_RESERVATION_UNAVAILABLE" | "REFUND_NOT_CONFIRMED" | "PROJECTION_UNAVAILABLE";
};

type Wp4ReconciliationDb = Pick<PrismaClient, "paymentTransaction"> & Parameters<typeof reconcilePayUniRefund>[0]["db"];

type CandidateTransaction = TransactionIdentity & {
  id: string;
  providerTradeNo: string | null;
  orderNumber: string | null;
};

function candidateTransaction(value: unknown): CandidateTransaction | null {
  const row = objectValue(value);
  if (!row
    || typeof row.id !== "string"
    || (typeof row.providerTradeNo !== "string" && row.providerTradeNo !== null)
    || (typeof row.orderNumber !== "string" && row.orderNumber !== null)
    || typeof row.vendorId !== "string"
    || typeof row.providerName !== "string"
    || typeof row.grossAmountCents !== "number"
    || typeof row.status !== "string") return null;
  return row as CandidateTransaction;
}

/**
 * Reconciles the three already-reserved, fixture-owned PayUni refunds as one
 * fixed current-source receipt. The caller cannot choose a transaction,
 * amount, provider, or purpose. Every purpose must have exactly one eligible
 * candidate before the first provider query, so a partial fixture set or a
 * duplicate candidate fails closed without reconciling a different purpose.
 */
export async function reconcileWp4PayUniSandboxRefund(
  db: Wp4ReconciliationDb,
  sourceCommit: string,
): Promise<Wp4PayUniSandboxReconciliationResult> {
  const selected = await db.paymentTransaction.findMany({
    where: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      status: { in: ["paid", "partially_refunded"] },
      refunds: { some: { status: "pending" } },
    },
  }) as CandidateTransaction[];

  const candidates = WP4_PAYUNI_PURPOSES.map((purpose) => {
    const matches = selected.filter((value) => {
      const row = candidateTransaction(value);
      return row !== null
        && isWp4PayUniSandboxTransactionForSource(row, sourceCommit)
        && wp4PayUniPurposeFromMetadata(row.metadata) === purpose
        && row.providerTradeNo !== null
        && row.orderNumber !== null;
    });
    return matches.length === 1 ? matches[0] ?? null : null;
  });
  if (candidates.some((candidate) => candidate === null)) {
    return { reconciled: false, status: "FIXTURE_UNAVAILABLE" };
  }

  const provider = getPaymentProvider("payuni");
  if (!provider.queryPayment) return { reconciled: false, status: "PROJECTION_UNAVAILABLE" };

  const snapshots = [];
  try {
    for (const candidate of candidates) {
      if (!candidate) return { reconciled: false, status: "FIXTURE_UNAVAILABLE" };
      const snapshot = await provider.queryPayment({ transaction: candidate as PaymentTransaction });
      if (snapshot.status === "paid") return { reconciled: false, status: "REFUND_NOT_CONFIRMED" };
      if (snapshot.providerTradeNo !== candidate.providerTradeNo
        || snapshot.orderNumber !== candidate.orderNumber
        || snapshot.grossAmountCents !== candidate.grossAmountCents
        || !["partially_refunded", "refunded"].includes(snapshot.status)) {
        return { reconciled: false, status: "PROJECTION_UNAVAILABLE" };
      }
      snapshots.push(snapshot);
    }
  } catch {
    return { reconciled: false, status: "PROJECTION_UNAVAILABLE" };
  }

  try {
    for (const [index, candidate] of candidates.entries()) {
      const snapshot = snapshots[index];
      if (!candidate || !snapshot) return { reconciled: false, status: "PENDING_RESERVATION_UNAVAILABLE" };
      const outcome = await reconcilePayUniRefund({
        db,
        transactionId: candidate.id,
        providerSnapshot: snapshot,
        actor: { id: WP4_SANDBOX_FIXTURE.userId, label: "wp4_sandbox_runner" },
      });
      if (outcome.disposition !== "reconciled" && outcome.disposition !== "already_reconciled") {
        return { reconciled: false, status: "REFUND_NOT_CONFIRMED" };
      }
    }
    return { reconciled: true, status: "RECONCILED" };
  } catch {
    return { reconciled: false, status: "PENDING_RESERVATION_UNAVAILABLE" };
  }
}
