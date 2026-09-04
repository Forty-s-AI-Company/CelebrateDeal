import { Prisma, type PrismaClient } from "@prisma/client";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { wp4PayUniPurposeFromMetadata, wp4SourceCommitFromMetadata } from "@/lib/wp4-payuni-sandbox-reconciliation";

const RESERVATION_MARKER = "wp4PaymentSubmissionReserved";
type Wp4PaymentAttemptPurpose = "buyer_order" | "platform_subscription";

type PaymentAttemptDb = Pick<PrismaClient, "$transaction">;

export type Wp4PaymentAttemptResult = {
  status: "SUBMIT_ALLOWED" | "ALREADY_PAID" | "ALREADY_RESERVED" | "ALREADY_FINISHED" | "FIXTURE_UNAVAILABLE" | "CANDIDATE_AMBIGUOUS";
  reservationCreated: boolean;
};

function metadataObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function matchesFixedPurpose(metadata: Record<string, unknown> | null, sourceCommit: string, purpose: Wp4PaymentAttemptPurpose) {
  if (!metadata || wp4SourceCommitFromMetadata(metadata) !== sourceCommit || wp4PayUniPurposeFromMetadata(metadata) !== purpose) {
    return false;
  }
  if (purpose === "buyer_order") return metadata.productId === WP4_SANDBOX_FIXTURE.productId;
  return typeof metadata.platformSubscriptionId === "string"
    && metadata.platformSubscriptionId.length > 0
    && metadata.billingPlanId === WP4_SANDBOX_FIXTURE.planId;
}

async function reserveFixedWp4PayUniPaymentAttempt(
  db: PaymentAttemptDb,
  sourceCommit: string,
  purpose: Wp4PaymentAttemptPurpose,
): Promise<Wp4PaymentAttemptResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.paymentTransaction.findMany({
      where: {
        vendorId: WP4_SANDBOX_FIXTURE.vendorId,
        providerName: "payuni",
        status: { in: ["pending", "paid", "partially_refunded", "refunded"] },
      },
      select: { id: true, status: true, metadata: true },
    });
    const candidates = rows.filter((row) => {
      const metadata = metadataObject(row.metadata);
      return matchesFixedPurpose(metadata, sourceCommit, purpose);
    });
    if (candidates.length === 0) return { status: "FIXTURE_UNAVAILABLE", reservationCreated: false };
    if (candidates.length > 1) return { status: "CANDIDATE_AMBIGUOUS", reservationCreated: false };

    const candidate = candidates[0]!;
    if (candidate.status === "paid") return { status: "ALREADY_PAID", reservationCreated: false };
    if (candidate.status !== "pending") return { status: "ALREADY_FINISHED", reservationCreated: false };

    const metadata = metadataObject(candidate.metadata);
    if (!metadata) return { status: "FIXTURE_UNAVAILABLE", reservationCreated: false };
    if (metadata[RESERVATION_MARKER] === true) return { status: "ALREADY_RESERVED", reservationCreated: false };

    await tx.paymentTransaction.update({
      where: { id: candidate.id },
      data: { metadata: { ...metadata, [RESERVATION_MARKER]: true } as Prisma.InputJsonObject },
    });
    return { status: "SUBMIT_ALLOWED", reservationCreated: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Atomically reserves only the source-owned buyer payment form submission.
 * SaaS payment attempts cannot satisfy this buyer authorization.
 */
export async function reserveWp4PayUniPaymentAttempt(
  db: PaymentAttemptDb,
  sourceCommit: string,
): Promise<Wp4PaymentAttemptResult> {
  return reserveFixedWp4PayUniPaymentAttempt(db, sourceCommit, "buyer_order");
}

/**
 * Atomically reserves only the source-owned platform-subscription payment form
 * submission. The purpose is fixed in this wrapper and never comes from HTTP.
 */
export async function reserveWp4PayUniSubscriptionPaymentAttempt(
  db: PaymentAttemptDb,
  sourceCommit: string,
): Promise<Wp4PaymentAttemptResult> {
  return reserveFixedWp4PayUniPaymentAttempt(db, sourceCommit, "platform_subscription");
}
