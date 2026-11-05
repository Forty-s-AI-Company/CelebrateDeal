import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
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

export type ResumeVendorResult =
  | { status: "resumed"; vendorId: string; previousSuspendedAt: Date; grantedEntitlementCount: number }
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

/**
 * Grants, in id-ordered batches, every pending digital/course entitlement of a
 * paid (or partially refunded) order of this vendor, and appends one
 * `fulfillment.released_after_suspension` event per order. The dedupKey names
 * the suspension being lifted, so a retried resume cannot write it twice.
 */
async function releaseHeldEntitlements(
  tx: Prisma.TransactionClient,
  vendorId: string,
  suspendedAt: Date,
  now: Date,
) {
  const orderIds = new Set<string>();
  let grantedEntitlementCount = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await tx.commerceEntitlement.findMany({
      where: {
        vendorId,
        status: "pending",
        ...(cursor ? { id: { gt: cursor } } : {}),
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
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;
    const granted = await tx.commerceEntitlement.updateMany({
      where: { vendorId, status: "pending", id: { in: batch.map((row) => row.id) } },
      data: { status: "granted", grantedAt: now, revision: { increment: 1 } },
    });
    grantedEntitlementCount += granted.count;
    const batchOrders = [...new Set(batch.map((row) => row.orderItem.orderId))].filter((orderId) => !orderIds.has(orderId));
    batchOrders.forEach((orderId) => orderIds.add(orderId));
    if (batchOrders.length > 0) {
      await tx.commerceOrderEvent.createMany({
        data: batchOrders.map((orderId) => ({
          id: randomUUID(),
          vendorId,
          orderId,
          dedupKey: `fulfillment.released_after_suspension:${suspendedAt.toISOString()}`,
          eventType: "fulfillment.released_after_suspension",
          actorType: "system",
          actorId: null,
          sanitizedData: { orderId, suspendedAt: suspendedAt.toISOString(), releasedAt: now.toISOString() },
          occurredAt: now,
        })),
        skipDuplicates: true,
      });
    }
    if (batch.length < RELEASE_BATCH_SIZE) break;
  }
  return { grantedEntitlementCount, orderIds: [...orderIds] };
}

/**
 * Lifts a suspension and releases what the payment path held back: every
 * pending digital/course entitlement of an order that is already paid (or
 * partially refunded) is granted, exactly what `grantPaidEntitlements` would
 * have done when the callback arrived. Refunded orders stay revoked.
 */
export async function resumeVendor(
  db: SuspensionDatabase,
  input: { vendorId: string; actorUserId: string; now?: Date } & AuditRequestMeta,
): Promise<ResumeVendorResult> {
  if (!VENDOR_ID.test(input.vendorId)) return { status: "invalid" };
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { id: input.vendorId }, select: { id: true, suspendedAt: true } });
    if (!vendor) return { status: "not_found" as const };
    if (!vendor.suspendedAt) return { status: "not_suspended" as const };
    const updated = await tx.vendor.updateMany({
      where: { id: vendor.id, suspendedAt: vendor.suspendedAt },
      data: { suspendedAt: null, suspendedReason: null },
    });
    if (updated.count !== 1) return { status: "conflict" as const };
    const released = await releaseHeldEntitlements(tx, vendor.id, vendor.suspendedAt, now);
    const granted = { count: released.grantedEntitlementCount };
    await tx.auditLog.create({
      data: {
        vendorId: vendor.id,
        actorId: input.actorUserId,
        actorLabel: "platform_admin",
        action: "vendor_suspension_lifted",
        targetType: "Vendor",
        targetId: vendor.id,
        before: { suspendedAt: vendor.suspendedAt.toISOString() },
        after: {
          suspendedAt: null,
          grantedEntitlementCount: granted.count,
          releasedOrderCount: released.orderIds.length,
          // Bounded so a long suspension cannot produce an oversized audit row; every order also has its own event.
          releasedOrderIds: released.orderIds.slice(0, RELEASED_ORDER_AUDIT_LIMIT),
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
    return { status: "resumed" as const, vendorId: vendor.id, previousSuspendedAt: vendor.suspendedAt, grantedEntitlementCount: granted.count };
  });
}
