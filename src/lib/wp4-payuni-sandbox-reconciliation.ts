import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import {
  PayUniRefundReconciliationError,
  reconcilePayUniRefund,
} from "@/lib/payuni-refund-reconciliation";
import { PlatformRefundProjectionConflictError } from "@/lib/platform-refund-projection";
import { getPaymentProvider } from "@/lib/payment-providers";
import { PaymentQueryProviderError } from "@/lib/payment-providers/types";
import { Prisma, type PaymentTransaction, type PrismaClient } from "@prisma/client";

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
  if (purpose === "platform_subscription") {
    return typeof metadata.platformSubscriptionId === "string"
      && metadata.platformSubscriptionId.length > 0
      && metadata.billingPlanId === WP4_SANDBOX_FIXTURE.planId;
  }
  return metadata.invoiceId === WP4_SANDBOX_FIXTURE.invoiceId;
}

export type Wp4PayUniSandboxReconciliationResult = {
  reconciled: boolean;
  status: "RECONCILED" | "FIXTURE_UNAVAILABLE" | "CANDIDATE_AMBIGUOUS" | "PENDING_RESERVATION_UNAVAILABLE" | "REFUND_NOT_CONFIRMED" | "PROJECTION_UNAVAILABLE"
    | "QUERY_AUTHENTICATION_FAILED" | "QUERY_REQUEST_REJECTED" | "QUERY_RESPONSE_REJECTED" | "QUERY_NETWORK_FAILED" | "QUERY_UNKNOWN_FAILED"
    | "RECONCILIATION_TRANSACTION_NOT_FOUND" | "RECONCILIATION_PROVIDER_MISMATCH" | "RECONCILIATION_PROVIDER_REF_MISMATCH"
    | "RECONCILIATION_PROVIDER_AMOUNT_MISMATCH" | "RECONCILIATION_UNSUPPORTED_STATUS" | "RECONCILIATION_LOCAL_AMOUNT_MISMATCH"
    | "RECONCILIATION_LOCAL_STATE_AMBIGUOUS" | "RECONCILIATION_DATABASE_TRANSACTION_FAILED" | "RECONCILIATION_DATABASE_CONFLICT"
    | "RECONCILIATION_DATABASE_CONSTRAINT_FAILED" | "RECONCILIATION_DATABASE_SCHEMA_MISMATCH" | "RECONCILIATION_DATABASE_RECORD_MISSING"
    | "RECONCILIATION_DATABASE_REQUEST_FAILED" | "RECONCILIATION_DATABASE_VALIDATION_FAILED" | "RECONCILIATION_DATABASE_UNAVAILABLE"
    | "RECONCILIATION_DATABASE_ENGINE_FAILED" | "RECONCILIATION_PLATFORM_PROJECTION_REJECTED" | "RECONCILIATION_UNKNOWN_FAILED";
};

/** Historical buyer refund source used only by the bounded recovery endpoint. */
export const WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA = "1052a46d002149b5c06104927ed0fab32b049214";

type Wp4RefundPurpose = "buyer_order" | "platform_subscription";

type Wp4ReconciliationDb = Pick<PrismaClient, "paymentTransaction"> & Parameters<typeof reconcilePayUniRefund>[0]["db"];

type CandidateTransaction = TransactionIdentity & {
  id: string;
  providerTradeNo: string | null;
  orderNumber: string | null;
};

function historicalReconciliationFailureStatus(error: unknown): Wp4PayUniSandboxReconciliationResult["status"] {
  if (error instanceof PlatformRefundProjectionConflictError) return "RECONCILIATION_PLATFORM_PROJECTION_REJECTED";
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const statuses: Record<string, Wp4PayUniSandboxReconciliationResult["status"]> = {
      P2028: "RECONCILIATION_DATABASE_TRANSACTION_FAILED",
      P2034: "RECONCILIATION_DATABASE_CONFLICT",
      P2002: "RECONCILIATION_DATABASE_CONSTRAINT_FAILED",
      P2003: "RECONCILIATION_DATABASE_CONSTRAINT_FAILED",
      P2021: "RECONCILIATION_DATABASE_SCHEMA_MISMATCH",
      P2022: "RECONCILIATION_DATABASE_SCHEMA_MISMATCH",
      P2025: "RECONCILIATION_DATABASE_RECORD_MISSING",
    };
    return Object.hasOwn(statuses, error.code) ? statuses[error.code]! : "RECONCILIATION_DATABASE_REQUEST_FAILED";
  }
  if (error instanceof Prisma.PrismaClientValidationError) return "RECONCILIATION_DATABASE_VALIDATION_FAILED";
  if (error instanceof Prisma.PrismaClientInitializationError) return "RECONCILIATION_DATABASE_UNAVAILABLE";
  if (error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientRustPanicError) {
    return "RECONCILIATION_DATABASE_ENGINE_FAILED";
  }
  if (!(error instanceof PayUniRefundReconciliationError)) return "RECONCILIATION_UNKNOWN_FAILED";
  const statuses = {
    transaction_not_found: "RECONCILIATION_TRANSACTION_NOT_FOUND",
    provider_mismatch: "RECONCILIATION_PROVIDER_MISMATCH",
    provider_ref_mismatch: "RECONCILIATION_PROVIDER_REF_MISMATCH",
    provider_amount_mismatch: "RECONCILIATION_PROVIDER_AMOUNT_MISMATCH",
    unsupported_status: "RECONCILIATION_UNSUPPORTED_STATUS",
    local_amount_mismatch: "RECONCILIATION_LOCAL_AMOUNT_MISMATCH",
    local_state_ambiguous: "RECONCILIATION_LOCAL_STATE_AMBIGUOUS",
  } as const;
  return Object.hasOwn(statuses, error.reason)
    ? statuses[error.reason]
    : "RECONCILIATION_UNKNOWN_FAILED";
}

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

async function reconcileFixedWp4PayUniSandboxRefund(
  db: Wp4ReconciliationDb,
  sourceCommit: string,
  purpose: Wp4RefundPurpose,
  queryFailureStatuses = false,
): Promise<Wp4PayUniSandboxReconciliationResult> {
  const selected = await db.paymentTransaction.findMany({
    where: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      status: { in: ["paid", "partially_refunded", "refunded"] },
    },
    orderBy: { occurredAt: "desc" },
  });
  const candidates = selected
    .map(candidateTransaction)
    .filter((row): row is CandidateTransaction => Boolean(
      row
      && isWp4PayUniSandboxTransactionForSource(row, sourceCommit)
      && wp4PayUniPurposeFromMetadata(row.metadata) === purpose,
    ));
  if (candidates.length === 0) {
    return { reconciled: false, status: "FIXTURE_UNAVAILABLE" };
  }
  if (candidates.length > 1) return { reconciled: false, status: "CANDIDATE_AMBIGUOUS" };

  const row = candidates[0]!;
  const transaction = selected.find((item) => candidateTransaction(item)?.id === row.id);
  if (!transaction || !row.providerTradeNo || !row.orderNumber) {
    return { reconciled: false, status: "FIXTURE_UNAVAILABLE" };
  }

  const provider = getPaymentProvider("payuni");
  if (!provider.queryPayment) return { reconciled: false, status: "PROJECTION_UNAVAILABLE" };

  let snapshot;
  try {
    snapshot = await provider.queryPayment({ transaction: transaction as PaymentTransaction });
  } catch (error) {
    if (error instanceof PaymentQueryProviderError && error.category === "pending") {
      // Preserve the reservation while PAYUNi reports a requested/processing
      // refund; no accounting projection or further provider write is allowed.
      return { reconciled: false, status: "REFUND_NOT_CONFIRMED" };
    }
    if (queryFailureStatuses && error instanceof PaymentQueryProviderError) {
      const status = error.category === "authentication"
        ? "QUERY_AUTHENTICATION_FAILED"
        : error.category === "request_contract"
          ? "QUERY_REQUEST_REJECTED"
          : error.category === "provider_response"
            ? "QUERY_RESPONSE_REJECTED"
            : error.category === "network"
              ? "QUERY_NETWORK_FAILED"
              : "QUERY_UNKNOWN_FAILED";
      return { reconciled: false, status };
    }
    if (queryFailureStatuses) return { reconciled: false, status: "QUERY_UNKNOWN_FAILED" };
    return { reconciled: false, status: "PROJECTION_UNAVAILABLE" };
  }
  // PayUni's query projection is eventually consistent after a successful
  // close request. Keep the ambiguous reservation intact while the provider
  // still reports paid; the bounded runner may safely query again later.
  if (snapshot.status === "paid") return { reconciled: false, status: "REFUND_NOT_CONFIRMED" };

  try {
    const outcome = await reconcilePayUniRefund({
      db,
      transactionId: row.id,
      providerSnapshot: snapshot,
      actor: { id: WP4_SANDBOX_FIXTURE.userId, label: "wp4_sandbox_runner" },
    });
    if (outcome.disposition === "reconciled" || outcome.disposition === "already_reconciled") {
      return { reconciled: true, status: "RECONCILED" };
    }
    return { reconciled: false, status: "REFUND_NOT_CONFIRMED" };
  } catch (error) {
    if (queryFailureStatuses) return { reconciled: false, status: historicalReconciliationFailureStatus(error) };
    return { reconciled: false, status: "PENDING_RESERVATION_UNAVAILABLE" };
  }
}

/**
 * Verifies only the current-source buyer-order refund. This fixed wrapper is
 * intentionally retained for the buyer receipt contract: SaaS state can never
 * satisfy a buyer reconciliation result.
 */
export async function reconcileWp4PayUniSandboxRefund(
  db: Wp4ReconciliationDb,
  sourceCommit: string,
): Promise<Wp4PayUniSandboxReconciliationResult> {
  return reconcileFixedWp4PayUniSandboxRefund(db, sourceCommit, "buyer_order");
}

/**
 * Verifies only the current-source platform-subscription refund. The purpose
 * remains server-owned so a caller cannot select an unrelated transaction.
 */
export async function reconcileWp4PayUniSandboxSubscriptionRefund(
  db: Wp4ReconciliationDb,
  sourceCommit: string,
): Promise<Wp4PayUniSandboxReconciliationResult> {
  return reconcileFixedWp4PayUniSandboxRefund(db, sourceCommit, "platform_subscription");
}

/**
 * Recovers only the historical buyer-order fixture. The source SHA and purpose
 * are intentionally server-owned constants; this function accepts no caller
 * supplied transaction or source selector.
 */
export async function reconcileWp4PayUniSandboxHistoricalRefund(
  db: Wp4ReconciliationDb,
): Promise<Wp4PayUniSandboxReconciliationResult> {
  return reconcileFixedWp4PayUniSandboxRefund(
    db,
    WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA,
    "buyer_order",
    true,
  );
}
