import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { revokeAllStudentPortalSessionsForVendor } from "@/lib/student-portal-auth";
import {
  isVendorAvailableForPublic,
  VENDOR_SUSPENDED_CODE,
  VENDOR_SUSPENSION_REASON_MAX_LENGTH,
  type VendorReader,
} from "@/lib/vendor-suspension-state";

/**
 * F-036 (B02-14): platform-wide tenant suspension.
 *
 * `Vendor.suspendedAt` is the only switch. Every surface reads it through
 * this module so the rule lives in one place:
 *
 * - Back office: `getCurrentAuth` (src/lib/auth.ts) never hands out a
 *   suspended vendor or its membership. Pages redirect to
 *   {@link VENDOR_SUSPENDED_PATH}; Server Actions hit the same guards; API
 *   routes see no vendor and answer 401/403 (`requireMerchantApiActor`
 *   answers {@link VENDOR_SUSPENDED_CODE}).
 * - Public (buyer, viewer, learner): the shared loaders add
 *   {@link ACTIVE_VENDOR_RELATION} / {@link ACTIVE_VENDOR_WHERE}, so the
 *   record simply does not exist (404) and nothing reveals the suspension.
 * - Payments: provider callbacks are still recorded (money already moved);
 *   `reconcileCommerceOrderPaymentTransition` keeps entitlements pending and
 *   {@link resumeVendor} grants them when the suspension is lifted.
 * - Jobs: email and LINE dispatch skip the vendor; rows stay queued.
 */

export {
  ACTIVE_VENDOR_RELATION,
  ACTIVE_VENDOR_WHERE,
  isVendorAvailableForPublic,
  isVendorSuspended,
  isVendorSuspendedById,
  VENDOR_SUSPENDED_CODE,
  VENDOR_SUSPENDED_PATH,
  VENDOR_SUSPENSION_REASON_MAX_LENGTH,
  type VendorSuspensionState,
} from "@/lib/vendor-suspension-state";

/** Server components: a suspended vendor's public page is the regular zh-TW 404. */
export async function requirePublicVendorOrNotFound(db: VendorReader, vendorId: string): Promise<void> {
  if (!await isVendorAvailableForPublic(db, vendorId)) notFound();
}

/** Public route handlers: indistinguishable from an unknown record. */
export function publicVendorUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Not found", code: "NOT_FOUND" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Back-office API routes: the member is signed in but the tenant is suspended. */
export function vendorSuspendedApiResponse(): NextResponse {
  return NextResponse.json(
    { error: { code: VENDOR_SUSPENDED_CODE } },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function normalizeVendorSuspensionReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason.length >= 1 && reason.length <= VENDOR_SUSPENSION_REASON_MAX_LENGTH ? reason : null;
}

const VENDOR_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export type SuspendVendorResult =
  | { status: "suspended"; vendorId: string; suspendedAt: Date; revokedStudentPortalTokenCount: number }
  | { status: "not_found" | "already_suspended" | "conflict" | "invalid" };

export type ReleaseHeldEntitlementsResult = {
  /** false when a batch failed; the rest stays pending and `releaseHeldEntitlements` can be run again. */
  complete: boolean;
  grantedEntitlementCount: number;
  orderIds: string[];
};

export type ResumeVendorResult =
  | ({ status: "resumed"; vendorId: string; previousSuspendedAt: Date } & Omit<ReleaseHeldEntitlementsResult, "orderIds">)
  | { status: "not_found" | "not_suspended" | "conflict" | "invalid" };

type SuspensionDatabase = Pick<PrismaClient, "$transaction">;

/** Request metadata recorded on the audit row written inside the transaction. */
type AuditRequestMeta = { ipAddress?: string | null; userAgent?: string | null };

/**
 * Suspends one vendor. In the same transaction it deletes every student
 * portal capability row of that vendor, which (with the F-030 grant check)
 * ends every learner portal session of the tenant in one batch statement.
 * Back-office sessions are kept: `getCurrentAuth` gates them on every request,
 * and lifting the suspension restores access without forcing new sign-ins.
 */
export async function suspendVendor(
  db: SuspensionDatabase,
  input: { vendorId: string; reason: string; actorUserId: string; now?: Date } & AuditRequestMeta,
): Promise<SuspendVendorResult> {
  const reason = normalizeVendorSuspensionReason(input.reason);
  if (!VENDOR_ID.test(input.vendorId) || !reason) return { status: "invalid" };
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true, suspendedAt: true } });
    if (!vendor) return { status: "not_found" as const };
    if (vendor.suspendedAt) return { status: "already_suspended" as const };
    // Compare-and-set: two administrators cannot both "win" the transition.
    const updated = await tx.vendor.updateMany({
      where: { id: vendor.id, suspendedAt: null },
      data: { suspendedAt: now, suspendedReason: reason },
    });
    if (updated.count !== 1) return { status: "conflict" as const };
    const revokedCount = await revokeAllStudentPortalSessionsForVendor(tx, { vendorId: vendor.id });
    const revoked = { count: revokedCount };
    await tx.auditLog.create({
      data: {
        vendorId: vendor.id,
        actorId: input.actorUserId,
        actorLabel: "platform_admin",
        action: "vendor_suspended",
        targetType: "Vendor",
        targetId: vendor.id,
        before: { suspendedAt: null },
        // The vendor row loses its reason when the suspension is lifted; the audit trail keeps it.
        after: { suspendedAt: now.toISOString(), reason, revokedStudentPortalTokenCount: revoked.count },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return { status: "suspended" as const, vendorId: vendor.id, suspendedAt: now, revokedStudentPortalTokenCount: revoked.count };
  });
}

const RELEASE_BATCH_SIZE = 500;
const RELEASED_ORDER_AUDIT_LIMIT = 1_000;
const RELEASE_BATCH_TIMEOUT_MS = 30_000;

type HeldBatch = { granted: number; orderIds: string[]; done: boolean; suspended: boolean };

/**
 * One short transaction: re-checks under `FOR SHARE` (the lock the payment
 * path takes) that the vendor is still not suspended, grants up to
 * RELEASE_BATCH_SIZE pending digital/course entitlements of paid (or partially
 * refunded) orders, and appends one `fulfillment.released_after_suspension`
 * event per order. The event dedupKey names the lifted suspension, so a rerun
 * never writes an order's event twice; granted rows are no longer pending, so
 * a rerun never grants twice.
 */
async function releaseHeldBatch(db: SuspensionDatabase, vendorId: string, releasedFrom: string, now: Date): Promise<HeldBatch> {
  return db.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`SELECT "suspendedAt" FROM "Vendor" WHERE "id" = ${vendorId} FOR SHARE`;
    if (!lock[0] || lock[0].suspendedAt instanceof Date) return { granted: 0, orderIds: [], done: true, suspended: true };
    const batch = await tx.commerceEntitlement.findMany({
      where: {
        vendorId,
        status: "pending",
        orderItem: {
          is: {
            vendorId,
            fulfillmentType: { in: ["digital", "course"] },
            order: { is: { vendorId, status: { in: ["paid", "partially_refunded"] } } },
          },
        },
      },
      orderBy: { id: "asc" },
      take: RELEASE_BATCH_SIZE,
      select: { id: true, orderItem: { select: { orderId: true } } },
    });
    if (batch.length === 0) return { granted: 0, orderIds: [], done: true, suspended: false };
    const granted = await tx.commerceEntitlement.updateMany({
      where: { vendorId, status: "pending", id: { in: batch.map((row) => row.id) } },
      data: { status: "granted", grantedAt: now, revision: { increment: 1 } },
    });
    const orderIds = [...new Set(batch.map((row) => row.orderItem.orderId))];
    await tx.commerceOrderEvent.createMany({
      data: orderIds.map((orderId) => ({
        id: randomUUID(),
        vendorId,
        orderId,
        dedupKey: `fulfillment.released_after_suspension:${releasedFrom}`,
        eventType: "fulfillment.released_after_suspension",
        actorType: "system",
        actorId: null,
        sanitizedData: { orderId, suspendedAt: releasedFrom, releasedAt: now.toISOString() },
        occurredAt: now,
      })),
      skipDuplicates: true,
    });
    return { granted: granted.count, orderIds, done: batch.length < RELEASE_BATCH_SIZE, suspended: false };
  }, { timeout: RELEASE_BATCH_TIMEOUT_MS });
}

/**
 * Releases what the payment path held back while the vendor was suspended,
 * in batches that each commit on their own (no long transaction). Safe to run
 * again: after a failed batch the remaining entitlements stay pending and the
 * platform admin can repeat the release from /admin/vendor-features. Stops at
 * once if the vendor is suspended again. One audit row records the outcome.
 */
export async function releaseHeldEntitlements(
  db: SuspensionDatabase,
  input: { vendorId: string; actorUserId: string; releasedFrom?: Date | null; now?: Date } & AuditRequestMeta,
): Promise<ReleaseHeldEntitlementsResult> {
  if (!VENDOR_ID.test(input.vendorId)) return { complete: false, grantedEntitlementCount: 0, orderIds: [] };
  const now = input.now ?? new Date();
  const releasedFrom = input.releasedFrom?.toISOString() ?? "manual_release";
  const orderIds = new Set<string>();
  let grantedEntitlementCount = 0;
  let complete = false;
  try {
    for (;;) {
      const batch = await releaseHeldBatch(db, input.vendorId, releasedFrom, now);
      grantedEntitlementCount += batch.granted;
      batch.orderIds.forEach((orderId) => orderIds.add(orderId));
      if (batch.suspended) break;
      if (batch.done) { complete = true; break; }
    }
  } catch {
    // A failed batch rolled back on its own; what is left stays pending, is audited below and can be released again.
  }
  const releasedOrderIds = [...orderIds];
  await db.$transaction((tx) => tx.auditLog.create({
    data: {
      vendorId: input.vendorId,
      actorId: input.actorUserId,
      actorLabel: "platform_admin",
      action: complete ? "vendor_suspension_release_completed" : "vendor_suspension_release_incomplete",
      targetType: "Vendor",
      targetId: input.vendorId,
      after: {
        releasedFrom,
        grantedEntitlementCount,
        releasedOrderCount: releasedOrderIds.length,
        // Bounded so a long suspension cannot produce an oversized audit row; every order also has its own event.
        releasedOrderIds: releasedOrderIds.slice(0, RELEASED_ORDER_AUDIT_LIMIT),
      },
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  }));
  return { complete, grantedEntitlementCount, orderIds: releasedOrderIds };
}

/**
 * Lifts a suspension in one short transaction (compare-and-set + audit),
 * then releases what the payment path held back: every pending
 * digital/course entitlement of an already paid (or partially refunded)
 * order is granted, exactly what `grantPaidEntitlements` would have done
 * when the callback arrived. Refunded orders stay revoked. A payment
 * transaction that read the suspension under `FOR SHARE` commits before the
 * lifting UPDATE proceeds, so the release batches see its pending rows.
 */
export async function resumeVendor(
  db: SuspensionDatabase,
  input: { vendorId: string; actorUserId: string; now?: Date } & AuditRequestMeta,
): Promise<ResumeVendorResult> {
  if (!VENDOR_ID.test(input.vendorId)) return { status: "invalid" };
  const now = input.now ?? new Date();
  const lifted = await db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true, suspendedAt: true } });
    if (!vendor) return { status: "not_found" as const };
    if (!vendor.suspendedAt) return { status: "not_suspended" as const };
    const updated = await tx.vendor.updateMany({
      where: { id: vendor.id, suspendedAt: vendor.suspendedAt },
      data: { suspendedAt: null, suspendedReason: null },
    });
    if (updated.count !== 1) return { status: "conflict" as const };
    await tx.auditLog.create({
      data: {
        vendorId: vendor.id,
        actorId: input.actorUserId,
        actorLabel: "platform_admin",
        action: "vendor_suspension_lifted",
        targetType: "Vendor",
        targetId: vendor.id,
        before: { suspendedAt: vendor.suspendedAt.toISOString() },
        after: { suspendedAt: null },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return { status: "lifted" as const, vendorId: vendor.id, suspendedAt: vendor.suspendedAt };
  });
  if (lifted.status !== "lifted") return lifted;
  const released = await releaseHeldEntitlements(db, {
    vendorId: lifted.vendorId, actorUserId: input.actorUserId, releasedFrom: lifted.suspendedAt, now,
    ipAddress: input.ipAddress, userAgent: input.userAgent,
  });
  return {
    status: "resumed",
    vendorId: lifted.vendorId,
    previousSuspendedAt: lifted.suspendedAt,
    complete: released.complete,
    grantedEntitlementCount: released.grantedEntitlementCount,
  };
}

/** Pending digital/course entitlements of paid orders per (not suspended) vendor: what a release would grant. */
export async function countHeldEntitlements(db: Pick<PrismaClient, "commerceEntitlement">, vendorIds: string[]) {
  if (vendorIds.length === 0) return new Map<string, number>();
  const rows = await db.commerceEntitlement.groupBy({
    by: ["vendorId"],
    where: {
      vendorId: { in: vendorIds },
      status: "pending",
      vendor: { is: { suspendedAt: null } },
      orderItem: { is: { fulfillmentType: { in: ["digital", "course"] }, order: { is: { status: { in: ["paid", "partially_refunded"] } } } } },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.vendorId, row._count._all]));
}