import { Prisma, type PrismaClient } from "@prisma/client";
import { assertOpaqueId } from "../src/lib/commerce-orders";
import { snapshotReservationItems } from "../src/lib/inventory-reservations";
import { wp4HistoricalBuyerWhere } from "../src/lib/wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE } from "../src/lib/wp4-sandbox-fixture";

const SOURCE = "9acfe8d2dba62430e950cff2c0387841ab91f44b";
type EventScalars = { provider: string | null; eventIdentity: string | null; eventIdentityType: string | null; occurredAt: string | null; occurredAtType: string | null };
type MetadataHints = { platformSubscriptionId: boolean; formSubmissionId: boolean; affiliateClickId: boolean; referralCode: boolean };
const safe = { callbackPosts: 0, callbackReplayAuthorized: false, databaseWrites: false } as const;

function opaque(value: unknown) {
  if (typeof value !== "string") return false;
  try { assertOpaqueId(value, "diagnostic"); return true; } catch { return false; }
}

/** Read the original synthetic event only; no retry, marker reset or mutation API. */
export async function readProcessingPreconditions(db: Pick<PrismaClient, "$transaction">) {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(SOURCE), take: 2,
        select: { id: true, vendorId: true, providerName: true, orderNumber: true } });
      if (payments.length !== 1) return { classification: payments.length ? "PAYMENT_AMBIGUOUS" : "PAYMENT_UNAVAILABLE", ...safe };
      const payment = payments[0]!;
      if (!payment.orderNumber) return { classification: "REFERENCE_UNAVAILABLE", ...safe };
      const events = await tx.webhookEvent.findMany({ where: { provider: "payuni", eventType: "paid",
        payload: { path: ["normalized", "orderNumber"], equals: payment.orderNumber } }, take: 2,
        select: { id: true, vendorId: true } });
      if (events.length !== 1) return { classification: events.length ? "EVENT_AMBIGUOUS" : "EVENT_UNAVAILABLE", ...safe };
      const event = events[0]!;
      if (event.vendorId !== null && event.vendorId !== WP4_SANDBOX_FIXTURE.vendorId) return { classification: "EVENT_SCOPE_MISMATCH", ...safe };
      // Parameterized scalar JSON paths: never load an entire payload or metadata value.
      const scalars = await tx.$queryRaw<EventScalars[]>(Prisma.sql`
        SELECT "payload"->'normalized'->>'provider' AS "provider",
          "payload"->'normalized'->>'eventId' AS "eventIdentity",
          jsonb_typeof("payload"->'normalized'->'eventId') AS "eventIdentityType",
          "payload"->'normalized'->>'occurredAt' AS "occurredAt",
          jsonb_typeof("payload"->'normalized'->'occurredAt') AS "occurredAtType"
        FROM "WebhookEvent" WHERE "id" = ${event.id} AND "provider" = 'payuni' AND "eventType" = 'paid'
          AND ("vendorId" IS NULL OR "vendorId" = ${WP4_SANDBOX_FIXTURE.vendorId}) LIMIT 2
      `);
      if (scalars.length !== 1 || scalars[0]!.provider !== "payuni") return { classification: "PAYLOAD_SCOPE_INVALID", ...safe };
      const scalar = scalars[0]!;
      const siblings = await tx.paymentTransaction.findMany({ where: { vendorId: payment.vendorId,
        providerName: scalar.provider!, orderNumber: payment.orderNumber }, take: 2, select: { id: true } });
      const reservations = await tx.inventoryReservation.findMany({ where: { paymentTransactionId: payment.id }, take: 2,
        select: { vendorId: true, productId: true, quantity: true, items: true } });
      if (reservations.length !== 1) return { classification: reservations.length ? "RESERVATION_AMBIGUOUS" : "RESERVATION_UNAVAILABLE", ...safe };
      const reservation = reservations[0]!;
      let reservationSnapshotClass: "NULL_LEGACY" | "VALID" | "INVALID";
      try { snapshotReservationItems(reservation); reservationSnapshotClass = reservation.items === null ? "NULL_LEGACY" : "VALID"; }
      catch { reservationSnapshotClass = "INVALID"; }
      const hints = await tx.$queryRaw<MetadataHints[]>(Prisma.sql`
        SELECT COALESCE("metadata" ? 'platformSubscriptionId', false) AS "platformSubscriptionId",
          COALESCE("metadata" ? 'formSubmissionId', false) AS "formSubmissionId",
          COALESCE("metadata" ? 'affiliateClickId', false) AS "affiliateClickId",
          COALESCE("metadata" ? 'referralCode', false) AS "referralCode"
        FROM "PaymentTransaction" WHERE "id" = ${payment.id} AND "vendorId" = ${WP4_SANDBOX_FIXTURE.vendorId} LIMIT 2
      `);
      if (hints.length !== 1) return { classification: "METADATA_SCOPE_UNAVAILABLE", ...safe };
      const occurredAtClass = scalar.occurredAtType === null ? "ABSENT"
        : scalar.occurredAtType === "string" && scalar.occurredAt !== null && Number.isFinite(new Date(scalar.occurredAt).getTime()) ? "VALID" : "INVALID";
      return { classification: "PROCESSING_PRECONDITIONS_OBSERVED", paymentProviderIsPayuni: payment.providerName === "payuni",
        scopeSiblingCount: siblings.length === 0 ? "ZERO" : siblings.length === 1 ? "ONE" : "MANY",
        fixedPaymentIsSoleScopeRow: siblings.length === 1 && siblings[0]!.id === payment.id,
        reservationSnapshotClass, reservationVendorMatches: reservation.vendorId === payment.vendorId,
        eventIdentityOpaque: scalar.eventIdentityType === "string" && opaque(scalar.eventIdentity), paymentIdOpaque: opaque(payment.id), vendorIdOpaque: opaque(payment.vendorId),
        occurredAtClass, metadataHints: { platformSubscriptionId: hints[0]!.platformSubscriptionId === true,
          formSubmissionId: hints[0]!.formSubmissionId === true, affiliateClickId: hints[0]!.affiliateClickId === true,
          referralCode: hints[0]!.referralCode === true }, ...safe };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
  } catch (error) {
    const missingSchema = error instanceof Prisma.PrismaClientKnownRequestError && (["P2021", "P2022"].includes(error.code)
      || (error.code === "P2010" && ["42703", "42P01"].includes(String(error.meta?.code ?? ""))));
    return { classification: missingSchema ? "SCHEMA_UNVERIFIED" : "PRECONDITIONS_READ_FAILED", ...safe };
  }
}
