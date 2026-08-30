import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { protectCommerceEntitlementAccess } from "@/lib/commerce-entitlement-access";

export type CommerceFulfillmentTransaction = Pick<
  Prisma.TransactionClient,
  "shippingFulfillment" | "commerceEntitlement" | "serviceFulfillment" | "commerceOrderEvent"
>;

type FulfillmentActor = { id: string };

export class CommerceFulfillmentValidationError extends Error {
  constructor(message = "Fulfillment input is invalid.") {
    super(message);
    this.name = "CommerceFulfillmentValidationError";
  }
}

export class CommerceFulfillmentConflictError extends Error {
  constructor() {
    super("Fulfillment changed concurrently.");
    this.name = "CommerceFulfillmentConflictError";
  }
}

function opaqueId(value: string, field: string) {
  if (!value || value !== value.trim() || value.length > 191 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new CommerceFulfillmentValidationError(`${field} is invalid.`);
  }
  return value;
}

function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CommerceFulfillmentValidationError("revision is invalid.");
  }
  return value;
}

function optionalSingleLine(value: string | null | undefined, maximumLength: number) {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new CommerceFulfillmentValidationError();
  }
  return normalized;
}

function assertPaidOrder(status: string) {
  if (status !== "paid" && status !== "partially_refunded") {
    throw new CommerceFulfillmentValidationError("Only paid orders can be fulfilled.");
  }
}

function assertShippingOrderCanTransition(
  orderStatus: string,
  currentStatus: string,
  nextStatus: string,
) {
  if (orderStatus === "paid" || orderStatus === "partially_refunded") return;
  if (
    orderStatus === "refunded"
    && currentStatus === "refund_review"
    && (nextStatus === "returned" || nextStatus === "delivered")
  ) return;
  throw new CommerceFulfillmentValidationError("Shipping cannot transition for this order state.");
}

async function appendFulfillmentEvent(
  tx: CommerceFulfillmentTransaction,
  input: {
    vendorId: string;
    orderId: string;
    fulfillmentId: string;
    revision: number;
    eventType: string;
    actor: FulfillmentActor;
    occurredAt: Date;
    sanitizedData: Prisma.InputJsonObject;
  },
) {
  await tx.commerceOrderEvent.create({
    data: {
      id: randomUUID(),
      vendorId: input.vendorId,
      orderId: input.orderId,
      dedupKey: `${input.eventType}:${input.fulfillmentId}:revision:${input.revision}`,
      eventType: input.eventType,
      actorType: "vendor_member",
      actorId: input.actor.id,
      sanitizedData: input.sanitizedData,
      occurredAt: input.occurredAt,
    },
  });
}

const SHIPPING_TRANSITIONS = {
  pending: ["packing", "shipped"],
  packing: ["shipped"],
  shipped: ["delivered"],
  refund_review: ["returned", "delivered"],
  delivered: [],
  returned: [],
  cancelled: [],
} as const;

export async function transitionShippingFulfillment(
  tx: CommerceFulfillmentTransaction,
  input: {
    vendorId: string;
    fulfillmentId: string;
    expectedRevision: number;
    nextStatus: "packing" | "shipped" | "delivered" | "returned";
    carrierName?: string | null;
    trackingNumber?: string | null;
    trackingUrl?: string | null;
    actor: FulfillmentActor;
    now?: Date;
  },
) {
  opaqueId(input.vendorId, "vendorId");
  opaqueId(input.fulfillmentId, "fulfillmentId");
  opaqueId(input.actor.id, "actorId");
  revision(input.expectedRevision);
  const current = await tx.shippingFulfillment.findFirst({
    where: { id: input.fulfillmentId, vendorId: input.vendorId },
    include: { orderItem: { select: { id: true, orderId: true, order: { select: { status: true } } } } },
  });
  if (!current) throw new CommerceFulfillmentValidationError("Shipping fulfillment was not found.");
  assertShippingOrderCanTransition(current.orderItem.order.status, current.status, input.nextStatus);
  const allowed = SHIPPING_TRANSITIONS[current.status];
  if (!(allowed as readonly string[]).includes(input.nextStatus)) {
    throw new CommerceFulfillmentValidationError("Shipping status transition is invalid.");
  }

  const carrierName = optionalSingleLine(input.carrierName, 120);
  const trackingNumber = optionalSingleLine(input.trackingNumber, 160);
  const trackingUrlInput = optionalSingleLine(input.trackingUrl, 2_048);
  const trackingUrl = trackingUrlInput ? parseSafeExternalHttpUrl(trackingUrlInput) : null;
  if (trackingUrlInput && (!trackingUrl || new URL(trackingUrl).protocol !== "https:")) {
    throw new CommerceFulfillmentValidationError("Tracking URL is invalid.");
  }
  if (input.nextStatus === "shipped" && !carrierName) {
    throw new CommerceFulfillmentValidationError("Carrier is required when marking an order shipped.");
  }

  const now = input.now ?? new Date();
  const nextRevision = current.revision + 1;
  const updated = await tx.shippingFulfillment.updateMany({
    where: {
      id: current.id,
      vendorId: input.vendorId,
      revision: input.expectedRevision,
      status: current.status,
    },
    data: {
      status: input.nextStatus,
      revision: { increment: 1 },
      ...(input.nextStatus === "packing" ? { packingAt: now } : {}),
      ...(input.nextStatus === "shipped" ? {
        carrierName,
        trackingNumber,
        trackingUrl,
        shippedAt: now,
      } : {}),
      ...(input.nextStatus === "delivered" ? { deliveredAt: now } : {}),
      ...(input.nextStatus === "returned" ? { returnedAt: now } : {}),
    },
  });
  if (updated.count !== 1) throw new CommerceFulfillmentConflictError();
  await appendFulfillmentEvent(tx, {
    vendorId: input.vendorId,
    orderId: current.orderItem.orderId,
    fulfillmentId: current.id,
    revision: nextRevision,
    eventType: `fulfillment.shipping.${input.nextStatus}`,
    actor: input.actor,
    occurredAt: now,
    sanitizedData: {
      fulfillmentId: current.id,
      orderItemId: current.orderItem.id,
      previousStatus: current.status,
      nextStatus: input.nextStatus,
      ...(carrierName ? { carrierName } : {}),
      ...(trackingNumber ? { trackingSuffix: trackingNumber.slice(-4) } : {}),
    },
  });
  return { orderId: current.orderItem.orderId, status: input.nextStatus, revision: nextRevision };
}

export async function grantCommerceEntitlement(
  tx: CommerceFulfillmentTransaction,
  input: {
    vendorId: string;
    entitlementId: string;
    expectedRevision: number;
    actor: FulfillmentActor;
    now?: Date;
  },
) {
  opaqueId(input.vendorId, "vendorId");
  opaqueId(input.entitlementId, "entitlementId");
  opaqueId(input.actor.id, "actorId");
  revision(input.expectedRevision);
  const current = await tx.commerceEntitlement.findFirst({
    where: { id: input.entitlementId, vendorId: input.vendorId },
    include: { orderItem: { select: { id: true, orderId: true, order: { select: { status: true } } } } },
  });
  if (!current) throw new CommerceFulfillmentValidationError("Entitlement was not found.");
  assertPaidOrder(current.orderItem.order.status);
  if (current.status === "granted") {
    return { orderId: current.orderItem.orderId, status: "granted" as const, revision: current.revision, changed: false };
  }
  if (current.status !== "pending") throw new CommerceFulfillmentValidationError("Entitlement cannot be granted.");
  const now = input.now ?? new Date();
  const access = current.accessEncryptedEnvelope && current.accessMaskedSummary
    ? { accessEncryptedEnvelope: current.accessEncryptedEnvelope, accessMaskedSummary: current.accessMaskedSummary }
    : protectCommerceEntitlementAccess({
        vendorId: input.vendorId,
        entitlementId: current.id,
        orderItemId: current.orderItem.id,
      });
  const updated = await tx.commerceEntitlement.updateMany({
    where: { id: current.id, vendorId: input.vendorId, revision: input.expectedRevision, status: "pending" },
    data: { status: "granted", grantedAt: now, revision: { increment: 1 }, ...access },
  });
  if (updated.count !== 1) throw new CommerceFulfillmentConflictError();
  await appendFulfillmentEvent(tx, {
    vendorId: input.vendorId,
    orderId: current.orderItem.orderId,
    fulfillmentId: current.id,
    revision: current.revision + 1,
    eventType: "fulfillment.entitlement.granted",
    actor: input.actor,
    occurredAt: now,
    sanitizedData: { fulfillmentId: current.id, orderItemId: current.orderItem.id, nextStatus: "granted" },
  });
  return { orderId: current.orderItem.orderId, status: "granted" as const, revision: current.revision + 1, changed: true };
}

export async function transitionServiceFulfillment(
  tx: CommerceFulfillmentTransaction,
  input: {
    vendorId: string;
    fulfillmentId: string;
    expectedRevision: number;
    nextStatus: "scheduled" | "completed";
    scheduledAt?: Date | null;
    actor: FulfillmentActor;
    now?: Date;
  },
) {
  opaqueId(input.vendorId, "vendorId");
  opaqueId(input.fulfillmentId, "fulfillmentId");
  opaqueId(input.actor.id, "actorId");
  revision(input.expectedRevision);
  const current = await tx.serviceFulfillment.findFirst({
    where: { id: input.fulfillmentId, vendorId: input.vendorId },
    include: { orderItem: { select: { id: true, orderId: true, order: { select: { status: true } } } } },
  });
  if (!current) throw new CommerceFulfillmentValidationError("Service fulfillment was not found.");
  assertPaidOrder(current.orderItem.order.status);
  if (input.nextStatus === "scheduled" && !["pending", "scheduling", "scheduled"].includes(current.status)) {
    throw new CommerceFulfillmentValidationError("Service cannot be scheduled.");
  }
  if (input.nextStatus === "completed" && current.status !== "scheduled") {
    throw new CommerceFulfillmentValidationError("Only a scheduled service can be completed.");
  }
  const now = input.now ?? new Date();
  const scheduledAt = input.nextStatus === "scheduled" ? input.scheduledAt : current.scheduledAt;
  if (input.nextStatus === "scheduled" && (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime()))) {
    throw new CommerceFulfillmentValidationError("scheduledAt is invalid.");
  }
  const updated = await tx.serviceFulfillment.updateMany({
    where: { id: current.id, vendorId: input.vendorId, revision: input.expectedRevision, status: current.status },
    data: {
      status: input.nextStatus,
      revision: { increment: 1 },
      ...(input.nextStatus === "scheduled" ? { scheduledAt } : { completedAt: now }),
    },
  });
  if (updated.count !== 1) throw new CommerceFulfillmentConflictError();
  await appendFulfillmentEvent(tx, {
    vendorId: input.vendorId,
    orderId: current.orderItem.orderId,
    fulfillmentId: current.id,
    revision: current.revision + 1,
    eventType: `fulfillment.service.${input.nextStatus}`,
    actor: input.actor,
    occurredAt: now,
    sanitizedData: {
      fulfillmentId: current.id,
      orderItemId: current.orderItem.id,
      previousStatus: current.status,
      nextStatus: input.nextStatus,
      ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
    },
  });
  return { orderId: current.orderItem.orderId, status: input.nextStatus, revision: current.revision + 1 };
}
