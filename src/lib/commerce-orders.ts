import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  deriveRefundOrderStatus,
  type CommerceFulfillmentType,
  type CommerceOrderStatus,
} from "@/lib/commerce-order-domain";
import {
  protectCommerceOrderPii,
  type CommerceOrderBuyerContact,
  type CommerceOrderShippingAddress,
} from "@/lib/commerce-order-pii";
import { protectCommerceEntitlementAccess } from "@/lib/commerce-entitlement-access";
import { coursePolicySnapshotFromProduct } from "@/lib/course-policy-snapshot";
import {
  parsePublicHttpsDeliveryUrl,
  protectOrderItemDeliverySnapshot,
  revealProductDeliveryConfig,
} from "@/lib/product-delivery";
import {
  createCustomCheckoutIdentityHash,
  parseCustomCheckoutFields,
  protectCustomCheckoutAnswers,
  validateCustomCheckoutAnswers,
} from "@/lib/commerce-custom-checkout";

/** The deliberately small transaction surface used by the commerce order domain. */
export type CommerceOrdersTransaction = Pick<
  Prisma.TransactionClient,
  | "product"
  | "commerceOrder"
  | "commerceOrderItem"
  | "commerceOrderEvent"
  | "commerceOrderRefund"
  | "shippingFulfillment"
  | "commerceEntitlement"
  | "serviceFulfillment"
  | "commerceOrderItemDeliverySnapshot"
>;

type OrderRecord = {
  id: string;
  vendorId: string;
  status: CommerceOrderStatus;
  totalAmountCents: number;
  paidAmountCents: number;
  refundedAmountCents: number;
};

const COURSE_DOMAIN = "course";
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

export class CommerceOrderValidationError extends Error {
  constructor(message = "Commerce order input is invalid.") {
    super(message);
    this.name = "CommerceOrderValidationError";
  }
}

export class CommerceOrderConflictError extends Error {
  constructor(message = "Commerce order changed concurrently.") {
    super(message);
    this.name = "CommerceOrderConflictError";
  }
}

function assertOpaqueId(value: string, field: string) {
  if (!value || value !== value.trim() || value.length > 191 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new CommerceOrderValidationError(`${field} is invalid.`);
  }
}

function assertPositiveAmount(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CommerceOrderValidationError(`${field} must be a positive safe integer amount.`);
  }
}

function assertNonNegativeAmount(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CommerceOrderValidationError(`${field} must be a non-negative safe integer amount.`);
  }
}

function assertCurrency(currency: string) {
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new CommerceOrderValidationError("currency is invalid.");
  }
}

function assertProductDomain(product: { commerceDomain: string; fulfillmentType: CommerceFulfillmentType }) {
  const isCourse = product.commerceDomain === COURSE_DOMAIN;
  if (isCourse !== (product.fulfillmentType === "course")) {
    throw new CommerceOrderValidationError("Product commerce domain and fulfillment type do not match.");
  }
}

function orderDeliveryFromProduct(product: {
  id: string;
  fulfillmentType: CommerceFulfillmentType;
  deliveryConfig: {
    id: string;
    revision: number;
    status: string;
    fulfillmentType: CommerceFulfillmentType;
    deliveryKind: "digital_link" | "course_portal" | "service_instructions";
    title: string;
    destinationEncryptedEnvelope: string | null;
    destinationMaskedSummary: string | null;
    instructionsEncryptedEnvelope: string | null;
    instructionsMaskedSummary: string | null;
    allowlist: { hostname: string; pathPrefix: string; allowQuery: boolean; status: string } | null;
  } | null;
}, vendorId: string) {
  if (product.fulfillmentType === "physical") return null;
  const config = product.deliveryConfig;
  if (!config || config.status !== "active" || config.fulfillmentType !== product.fulfillmentType) {
    throw new CommerceOrderValidationError("Product delivery is not configured.");
  }
  const revealed = revealProductDeliveryConfig(config, {
    vendorId,
    productId: product.id,
    configId: config.id,
    revision: config.revision,
  });
  if ((product.fulfillmentType === "digital" || product.fulfillmentType === "course") && !revealed.destinationUrl) {
    throw new CommerceOrderValidationError("Product delivery destination is unavailable.");
  }
  if (product.fulfillmentType === "service" && !revealed.instructions) {
    throw new CommerceOrderValidationError("Service delivery instructions are unavailable.");
  }

  let allowlistSnapshot: { hostname: string; pathPrefix: string; allowQuery: false } | null = null;
  if (revealed.destinationUrl) {
    const parsed = parsePublicHttpsDeliveryUrl(revealed.destinationUrl);
    if (
      !config.allowlist
      || config.allowlist.status !== "active"
      || config.allowlist.allowQuery
      || config.allowlist.hostname !== parsed.hostname
      || config.allowlist.pathPrefix !== parsed.pathPrefix
    ) {
      throw new CommerceOrderValidationError("Product delivery allowlist does not match.");
    }
    allowlistSnapshot = { hostname: parsed.hostname, pathPrefix: parsed.pathPrefix, allowQuery: false };
  }
  return { config, revealed, allowlistSnapshot };
}

function sanitizedOrderData(
  order: OrderRecord,
  extra: Prisma.InputJsonObject = {},
): Prisma.InputJsonObject {
  return {
    orderId: order.id,
    status: order.status,
    totalAmountCents: order.totalAmountCents,
    ...extra,
  };
}

async function appendEvent(
  tx: CommerceOrdersTransaction,
  input: {
    vendorId: string;
    orderId: string;
    dedupKey: string;
    eventType: string;
    occurredAt: Date;
    data: Prisma.InputJsonObject;
  },
) {
  return tx.commerceOrderEvent.create({
    data: {
      id: randomUUID(),
      vendorId: input.vendorId,
      orderId: input.orderId,
      dedupKey: input.dedupKey,
      eventType: input.eventType,
      actorType: "system",
      actorId: null,
      sanitizedData: input.data,
      occurredAt: input.occurredAt,
    },
  });
}

export type CreateCommerceOrderForCheckoutInput = {
  vendorId: string;
  productId: string;
  orderNumber: string;
  checkoutIdempotencyKey: string;
  paymentTransactionId: string;
  /** The server-authorized order amount, in the product currency's minor unit. */
  totalAmountCents: number;
  /** Optional server-authorized promotion. Never accept this value directly from a browser. */
  discountAmountCents?: number;
  quantity?: number;
  currency: string;
  buyer: CommerceOrderBuyerContact;
  shipping: CommerceOrderShippingAddress | null;
  /** Validated again against the product row inside this transaction. Never add to events or payment metadata. */
  customCheckoutAnswers?: unknown;
  now?: Date;
};

/**
 * Persists the canonical order, immutable line snapshot, sanitized creation event,
 * and exactly one fulfillment placeholder using the caller's transaction.
 */
export async function createCommerceOrderForCheckout(
  tx: CommerceOrdersTransaction,
  input: CreateCommerceOrderForCheckoutInput,
) {
  assertOpaqueId(input.vendorId, "vendorId");
  assertOpaqueId(input.productId, "productId");
  assertOpaqueId(input.orderNumber, "orderNumber");
  assertOpaqueId(input.checkoutIdempotencyKey, "checkoutIdempotencyKey");
  assertOpaqueId(input.paymentTransactionId, "paymentTransactionId");
  assertCurrency(input.currency);
  assertPositiveAmount(input.totalAmountCents, "totalAmountCents");
  const quantity = input.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new CommerceOrderValidationError("quantity must be a positive safe integer.");
  }

  const product = await tx.product.findFirst({
    where: { id: input.productId, vendorId: input.vendorId, isActive: true, fulfillmentTypeConfirmed: true },
    select: {
      id: true,
      name: true,
      slug: true,
      priceCents: true,
      currency: true,
      imageUrl: true,
      commerceDomain: true,
      fulfillmentType: true,
      courseContentOwnerMembershipId: true,
      coursePromoterShareBps: true,
      coursePolicyVersion: true,
      customCheckoutFields: true,
      deliveryConfig: {
        select: {
          id: true,
          revision: true,
          status: true,
          fulfillmentType: true,
          deliveryKind: true,
          title: true,
          destinationEncryptedEnvelope: true,
          destinationMaskedSummary: true,
          instructionsEncryptedEnvelope: true,
          instructionsMaskedSummary: true,
          allowlist: { select: { hostname: true, pathPrefix: true, allowQuery: true, status: true } },
        },
      },
    },
  });
  if (!product) throw new CommerceOrderValidationError("Product is unavailable.");
  assertProductDomain(product);
  assertPositiveAmount(product.priceCents, "product price");
  if (product.currency !== input.currency) throw new CommerceOrderValidationError("currency does not match product.");
  const calculatedTotal = product.priceCents * quantity;
  const discountAmountCents = input.discountAmountCents ?? 0;
  if (
    !Number.isSafeInteger(calculatedTotal)
    || !Number.isSafeInteger(discountAmountCents)
    || discountAmountCents < 0
    || discountAmountCents >= calculatedTotal
    || calculatedTotal - discountAmountCents !== input.totalAmountCents
  ) {
    throw new CommerceOrderValidationError("totalAmountCents does not match the immutable product price.");
  }

  const now = input.now ?? new Date();
  const coursePolicySnapshot = coursePolicySnapshotFromProduct(product);
  const orderDelivery = orderDeliveryFromProduct(product, input.vendorId);
  const orderId = randomUUID();
  const orderItemId = randomUUID();
  // Re-read and re-validate the product definition in the same transaction so
  // stale client fields cannot be persisted when a merchant edits the product.
  const customCheckoutFields = parseCustomCheckoutFields(product.customCheckoutFields);
  const customCheckoutAnswers = validateCustomCheckoutAnswers(customCheckoutFields, input.customCheckoutAnswers);
  const customCheckoutAnswersEncryptedEnvelope = customCheckoutFields.length > 0
    ? protectCustomCheckoutAnswers(customCheckoutFields, customCheckoutAnswers, {
        vendorId: input.vendorId,
        orderId,
        orderItemId,
      })
    : null;
  const deliverySnapshotId = orderDelivery ? randomUUID() : null;
  // This is the only plaintext PII handling point. Nothing below receives it.
  const pii = protectCommerceOrderPii({ buyer: input.buyer, shipping: input.shipping }, {
    vendorId: input.vendorId,
    orderId,
  });
  // Recompute from the transaction's product row so the persisted identity
  // cannot be rebound to different custom answers by an idempotency retry.
  const checkoutIdentityHash = createCustomCheckoutIdentityHash({
    vendorId: input.vendorId,
    productId: product.id,
    basePiiHash: pii.checkoutIdentityHash,
    definitions: customCheckoutFields,
    answers: customCheckoutAnswers,
  });
  const orderData = {
    id: orderId,
    vendorId: input.vendorId,
    orderNumber: input.orderNumber,
    checkoutIdempotencyKey: input.checkoutIdempotencyKey,
    checkoutIdentityHash,
    primaryPaymentTransactionId: input.paymentTransactionId,
    status: "pending_payment" as const,
    currency: input.currency,
    subtotalAmountCents: calculatedTotal,
    totalAmountCents: calculatedTotal - discountAmountCents,
    paidAmountCents: 0,
    refundedAmountCents: 0,
    buyerEncryptedEnvelope: pii.buyerEncrypted,
    buyerMaskedName: pii.buyerNameMasked,
    buyerMaskedEmail: pii.buyerEmailMasked,
    buyerMaskedPhone: pii.buyerPhoneMasked,
    shippingEncryptedEnvelope: pii.shippingEncrypted,
    shippingMaskedSummary: pii.shippingSummaryMasked,
    createdAt: now,
  };
  await tx.commerceOrder.create({ data: orderData });
  await tx.commerceOrderItem.create({
    data: {
      id: orderItemId,
      vendorId: input.vendorId,
      orderId,
      productId: product.id,
      lineIndex: 0,
      productName: product.name,
      productSlug: product.slug,
      commerceDomain: product.commerceDomain,
      fulfillmentType: product.fulfillmentType,
      unitPriceCents: product.priceCents,
      quantity,
      lineTotalCents: calculatedTotal,
      imageUrl: product.imageUrl,
      customCheckoutAnswersEncryptedEnvelope,
      nonSensitiveSnapshot: {
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
        commerceDomain: product.commerceDomain,
        fulfillmentType: product.fulfillmentType,
        unitPriceCents: product.priceCents,
        quantity,
        lineTotalCents: calculatedTotal,
        ...(discountAmountCents > 0 ? { discountAmountCents } : {}),
        imageUrl: product.imageUrl,
        // Definition only: answers stay in the separate encrypted envelope.
        customCheckoutFields,
        ...(coursePolicySnapshot ? { coursePolicySnapshot } : {}),
      },
      createdAt: now,
    },
  });
  if (orderDelivery && deliverySnapshotId) {
    const protectedSnapshot = protectOrderItemDeliverySnapshot(orderDelivery.revealed, {
      vendorId: input.vendorId,
      orderId,
      orderItemId,
      snapshotId: deliverySnapshotId,
    });
    await tx.commerceOrderItemDeliverySnapshot.create({
      data: {
        id: deliverySnapshotId,
        vendorId: input.vendorId,
        orderId,
        orderItemId,
        productDeliveryConfigId: orderDelivery.config.id,
        productDeliveryConfigRevision: orderDelivery.config.revision,
        fulfillmentType: product.fulfillmentType,
        deliveryKind: orderDelivery.config.deliveryKind,
        title: orderDelivery.config.title,
        ...protectedSnapshot,
        destinationMaskedSummary: orderDelivery.config.destinationMaskedSummary,
        instructionsMaskedSummary: orderDelivery.config.instructionsMaskedSummary,
        ...(orderDelivery.allowlistSnapshot
          ? { allowlistSnapshot: orderDelivery.allowlistSnapshot }
          : {}),
        createdAt: now,
      },
    });
  }
  await appendEvent(tx, {
    vendorId: input.vendorId,
    orderId,
    dedupKey: `order.created:${input.checkoutIdempotencyKey}`,
    eventType: "order.created",
    occurredAt: now,
    data: {
      orderId,
      orderItemId,
      productId: product.id,
      status: "pending_payment",
      totalAmountCents: calculatedTotal,
      fulfillmentType: product.fulfillmentType,
      ...(orderDelivery && deliverySnapshotId
        ? { deliverySnapshotId, deliveryKind: orderDelivery.config.deliveryKind }
        : {}),
    },
  });

  if (product.fulfillmentType === "physical") {
    await tx.shippingFulfillment.create({ data: { id: randomUUID(), vendorId: input.vendorId, orderItemId, status: "pending", revision: 1, createdAt: now } });
  } else if (product.fulfillmentType === "service") {
    await tx.serviceFulfillment.create({ data: { id: randomUUID(), vendorId: input.vendorId, orderItemId, status: "pending", revision: 1, scheduledAt: null, completedAt: null, cancelledAt: null, serviceEncryptedEnvelope: null, serviceMaskedSummary: null, createdAt: now } });
  } else {
    const entitlementId = randomUUID();
    const access = protectCommerceEntitlementAccess({ vendorId: input.vendorId, entitlementId, orderItemId });
    await tx.commerceEntitlement.create({ data: { id: entitlementId, vendorId: input.vendorId, orderItemId, status: "pending", revision: 1, ...access, grantedAt: null, expiresAt: null, revokedAt: null, createdAt: now } });
  }

  return { id: orderId, itemId: orderItemId, deliverySnapshotId, status: "pending_payment" as const };
}

type PaymentTransitionInput = {
  vendorId: string;
  paymentTransactionId: string;
  eventIdentity: string;
  occurredAt?: Date;
};

async function canonicalOrderForPayment(tx: CommerceOrdersTransaction, vendorId: string, paymentTransactionId: string) {
  return tx.commerceOrder.findFirst({
    where: { vendorId, primaryPaymentTransactionId: paymentTransactionId },
    select: { id: true, vendorId: true, status: true, totalAmountCents: true, paidAmountCents: true, refundedAmountCents: true },
  }) as Promise<OrderRecord | null>;
}

async function eventExists(tx: CommerceOrdersTransaction, vendorId: string, orderId: string, dedupKey: string) {
  return tx.commerceOrderEvent.findUnique({
    where: { vendorId_orderId_dedupKey: { vendorId, orderId, dedupKey } },
    select: { id: true },
  });
}

async function grantPaidEntitlements(
  tx: CommerceOrdersTransaction,
  vendorId: string,
  orderId: string,
  now: Date,
) {
  const items = await tx.commerceOrderItem.findMany({
    where: { vendorId, orderId, fulfillmentType: { in: ["digital", "course"] } },
    select: { id: true },
  });
  if (items.length === 0) return 0;
  const granted = await tx.commerceEntitlement.updateMany({
    where: {
      vendorId,
      orderItemId: { in: items.map((item) => item.id) },
      status: "pending",
    },
    data: { status: "granted", grantedAt: now, revision: { increment: 1 } },
  });
  return granted.count;
}

/** Reconciles a provider paid or failed notification without ever downgrading paid money. */
export async function reconcileCommerceOrderPaymentTransition(
  tx: CommerceOrdersTransaction,
  input: PaymentTransitionInput & { transition: "paid" | "failed" },
) {
  assertOpaqueId(input.vendorId, "vendorId");
  assertOpaqueId(input.paymentTransactionId, "paymentTransactionId");
  assertOpaqueId(input.eventIdentity, "eventIdentity");
  const order = await canonicalOrderForPayment(tx, input.vendorId, input.paymentTransactionId);
  if (!order) return null; // A legacy transaction remains outside the canonical order domain.
  const dedupKey = `payment.${input.transition}:${input.eventIdentity}`;
  const now = input.occurredAt ?? new Date();
  if (await eventExists(tx, input.vendorId, order.id, dedupKey)) {
    if (input.transition === "paid" && ["paid", "partially_refunded"].includes(order.status)) {
      await grantPaidEntitlements(tx, input.vendorId, order.id, now);
    }
    return { orderId: order.id, changed: false, status: order.status };
  }

  if (input.transition === "paid") {
    if (["paid", "partially_refunded", "refunded"].includes(order.status)) {
      if (order.status !== "refunded") {
        await grantPaidEntitlements(tx, input.vendorId, order.id, now);
      }
      return { orderId: order.id, changed: false, status: order.status };
    }
    if (order.status === "cancelled") throw new CommerceOrderValidationError("Cancelled orders cannot be paid.");
    if (!["pending_payment", "payment_failed", "expired"].includes(order.status)) {
      throw new CommerceOrderValidationError("Order cannot accept this payment transition.");
    }
    const updated = await tx.commerceOrder.updateMany({
      where: { id: order.id, vendorId: input.vendorId, status: order.status },
      data: { status: "paid", paidAmountCents: order.totalAmountCents, paidAt: now, failedAt: null },
    });
    if (updated.count !== 1) throw new CommerceOrderConflictError();
    const grantedEntitlementCount = await grantPaidEntitlements(tx, input.vendorId, order.id, now);
    await appendEvent(tx, { vendorId: input.vendorId, orderId: order.id, dedupKey, eventType: "payment.paid", occurredAt: now, data: sanitizedOrderData({ ...order, status: "paid", paidAmountCents: order.totalAmountCents }, { paymentTransactionId: input.paymentTransactionId, paidAmountCents: order.totalAmountCents, grantedEntitlementCount }) });
    return { orderId: order.id, changed: true, status: "paid" as const };
  }

  if (order.status !== "pending_payment") return { orderId: order.id, changed: false, status: order.status };
  const updated = await tx.commerceOrder.updateMany({
    where: { id: order.id, vendorId: input.vendorId, status: "pending_payment" },
    data: { status: "payment_failed", failedAt: now },
  });
  if (updated.count !== 1) throw new CommerceOrderConflictError();
  await appendEvent(tx, { vendorId: input.vendorId, orderId: order.id, dedupKey, eventType: "payment.failed", occurredAt: now, data: sanitizedOrderData({ ...order, status: "payment_failed" }, { paymentTransactionId: input.paymentTransactionId }) });
  return { orderId: order.id, changed: true, status: "payment_failed" as const };
}

/** Expires an unpaid canonical order; paid and legacy transactions are intentionally untouched. */
export async function expireCommerceOrderForPayment(
  tx: CommerceOrdersTransaction,
  input: Omit<PaymentTransitionInput, "eventIdentity"> & { eventIdentity: string },
) {
  assertOpaqueId(input.vendorId, "vendorId");
  assertOpaqueId(input.paymentTransactionId, "paymentTransactionId");
  assertOpaqueId(input.eventIdentity, "eventIdentity");
  const order = await canonicalOrderForPayment(tx, input.vendorId, input.paymentTransactionId);
  if (!order) return null;
  const dedupKey = `payment.expired:${input.eventIdentity}`;
  if (await eventExists(tx, input.vendorId, order.id, dedupKey)) return { orderId: order.id, changed: false, status: order.status };
  if (order.status !== "pending_payment") return { orderId: order.id, changed: false, status: order.status };
  const now = input.occurredAt ?? new Date();
  const updated = await tx.commerceOrder.updateMany({
    where: { id: order.id, vendorId: input.vendorId, status: "pending_payment" },
    data: { status: "expired" },
  });
  if (updated.count !== 1) throw new CommerceOrderConflictError();
  await appendEvent(tx, { vendorId: input.vendorId, orderId: order.id, dedupKey, eventType: "payment.expired", occurredAt: now, data: sanitizedOrderData({ ...order, status: "expired" }, { paymentTransactionId: input.paymentTransactionId }) });
  return { orderId: order.id, changed: true, status: "expired" as const };
}

export type ReconcileCommerceOrderRefundInput = {
  vendorId: string;
  orderId: string;
  providerName: string;
  eventIdentity: string;
  amountCents: number;
  paymentTransactionId?: string | null;
  refundRecordId?: string | null;
  occurredAt: Date;
};

type FullRefundFulfillmentSummary = {
  revokedDeliverySnapshotCount: number;
  revokedEntitlementCount: number;
  cancelledShippingCount: number;
  shippingRefundReviewCount: number;
  cancelledServiceCount: number;
};

async function convergeFullRefundFulfillment(
  tx: CommerceOrdersTransaction,
  vendorId: string,
  orderId: string,
  now: Date,
): Promise<FullRefundFulfillmentSummary> {
  const items = await tx.commerceOrderItem.findMany({ where: { vendorId, orderId }, select: { id: true } });
  const orderItemIds = items.map((item) => item.id);
  if (orderItemIds.length === 0) {
    return {
      revokedDeliverySnapshotCount: 0,
      revokedEntitlementCount: 0,
      cancelledShippingCount: 0,
      shippingRefundReviewCount: 0,
      cancelledServiceCount: 0,
    };
  }
  // Keep interactive-transaction writes ordered on a single connection.
  const revokedDeliverySnapshots = await tx.commerceOrderItemDeliverySnapshot.updateMany({
    where: { vendorId, orderId, orderItemId: { in: orderItemIds }, revokedAt: null },
    data: { revokedAt: now },
  });
  const revokedEntitlements = await tx.commerceEntitlement.updateMany({
    where: { vendorId, orderItemId: { in: orderItemIds }, status: { in: ["pending", "granted"] } },
    data: {
      status: "revoked",
      revokedAt: now,
      accessEncryptedEnvelope: null,
      accessMaskedSummary: null,
      revision: { increment: 1 },
    },
  });
  const cancelledShipping = await tx.shippingFulfillment.updateMany({
    where: { vendorId, orderItemId: { in: orderItemIds }, status: { in: ["pending", "packing"] } },
    data: { status: "cancelled", cancelledAt: now, revision: { increment: 1 } },
  });
  const shippingRefundReview = await tx.shippingFulfillment.updateMany({
    where: { vendorId, orderItemId: { in: orderItemIds }, status: "shipped" },
    data: { status: "refund_review", refundReviewAt: now, revision: { increment: 1 } },
  });
  const cancelledServices = await tx.serviceFulfillment.updateMany({
    where: { vendorId, orderItemId: { in: orderItemIds }, status: { in: ["pending", "scheduling", "scheduled"] } },
    data: { status: "cancelled", cancelledAt: now, revision: { increment: 1 } },
  });
  return {
    revokedDeliverySnapshotCount: revokedDeliverySnapshots.count,
    revokedEntitlementCount: revokedEntitlements.count,
    cancelledShippingCount: cancelledShipping.count,
    shippingRefundReviewCount: shippingRefundReview.count,
    cancelledServiceCount: cancelledServices.count,
  };
}

/** Records an immutable provider refund after a guarded cumulative-order update. */
export async function reconcileCommerceOrderRefund(
  tx: CommerceOrdersTransaction,
  input: ReconcileCommerceOrderRefundInput,
) {
  assertOpaqueId(input.vendorId, "vendorId");
  assertOpaqueId(input.orderId, "orderId");
  assertOpaqueId(input.providerName, "providerName");
  assertOpaqueId(input.eventIdentity, "eventIdentity");
  assertPositiveAmount(input.amountCents, "amountCents");
  if (input.paymentTransactionId) assertOpaqueId(input.paymentTransactionId, "paymentTransactionId");
  if (input.refundRecordId) assertOpaqueId(input.refundRecordId, "refundRecordId");

  const existing = await tx.commerceOrderRefund.findUnique({
    where: { vendorId_providerName_eventIdentity: { vendorId: input.vendorId, providerName: input.providerName, eventIdentity: input.eventIdentity } },
    select: { id: true, orderId: true, paymentTransactionId: true, amountCents: true, refundRecordId: true },
  });
  if (existing) {
    if (
      existing.orderId !== input.orderId
      || existing.amountCents !== input.amountCents
      || existing.refundRecordId !== (input.refundRecordId ?? null)
      || (input.paymentTransactionId && existing.paymentTransactionId !== input.paymentTransactionId)
    ) {
      throw new CommerceOrderValidationError("Refund event identity conflicts with immutable data.");
    }
    return { orderId: input.orderId, refundId: existing.id, changed: false };
  }

  const order = await tx.commerceOrder.findUnique({
    where: { vendorId_id: { vendorId: input.vendorId, id: input.orderId } },
    select: { id: true, vendorId: true, status: true, totalAmountCents: true, paidAmountCents: true, refundedAmountCents: true, primaryPaymentTransactionId: true },
  }) as (OrderRecord & { primaryPaymentTransactionId: string | null }) | null;
  if (!order) throw new CommerceOrderValidationError("Canonical commerce order was not found.");
  if (input.paymentTransactionId && order.primaryPaymentTransactionId !== input.paymentTransactionId) {
    throw new CommerceOrderValidationError("Refund payment transaction does not match order.");
  }
  assertNonNegativeAmount(order.refundedAmountCents, "stored refunded amount");
  const nextRefundedAmount = order.refundedAmountCents + input.amountCents;
  if (!Number.isSafeInteger(nextRefundedAmount)) throw new CommerceOrderValidationError("Refund amount is too large.");
  const nextStatus = deriveRefundOrderStatus({
    paidAmountCents: order.paidAmountCents,
    totalAmountCents: order.totalAmountCents,
    refundedAmountCents: nextRefundedAmount,
  });
  if (order.status !== "paid" && order.status !== "partially_refunded") {
    throw new CommerceOrderValidationError("Order cannot accept a refund.");
  }

  const updated = await tx.commerceOrder.updateMany({
    where: { id: order.id, vendorId: input.vendorId, status: order.status, refundedAmountCents: order.refundedAmountCents },
    data: { status: nextStatus, refundedAmountCents: nextRefundedAmount, refundedAt: nextStatus === "refunded" ? input.occurredAt : null },
  });
  if (updated.count !== 1) throw new CommerceOrderConflictError("Commerce order refund changed concurrently.");
  const refundId = randomUUID();
  await tx.commerceOrderRefund.create({
    data: { id: refundId, vendorId: input.vendorId, orderId: order.id, paymentTransactionId: input.paymentTransactionId ?? order.primaryPaymentTransactionId, refundRecordId: input.refundRecordId ?? null, providerName: input.providerName, eventIdentity: input.eventIdentity, amountCents: input.amountCents, cumulativeAmountCents: nextRefundedAmount, status: "processed", occurredAt: input.occurredAt },
  });
  const fulfillmentConvergence = nextStatus === "refunded"
    ? await convergeFullRefundFulfillment(tx, input.vendorId, order.id, input.occurredAt)
    : null;
  await appendEvent(tx, {
    vendorId: input.vendorId,
    orderId: order.id,
    dedupKey: `refund.processed:${input.providerName}:${input.eventIdentity}`,
    eventType: "refund.processed",
    occurredAt: input.occurredAt,
    data: sanitizedOrderData(
      { ...order, status: nextStatus, refundedAmountCents: nextRefundedAmount },
      {
        refundId,
        amountCents: input.amountCents,
        cumulativeAmountCents: nextRefundedAmount,
        ...(fulfillmentConvergence ? { fulfillmentConvergence } : {}),
      },
    ),
  });
  return { orderId: order.id, refundId, changed: true, status: nextStatus, refundedAmountCents: nextRefundedAmount };
}

export async function reconcileCommerceOrderRefundForPayment(
  tx: CommerceOrdersTransaction,
  input: Omit<ReconcileCommerceOrderRefundInput, "orderId" | "paymentTransactionId"> & {
    paymentTransactionId: string;
  },
) {
  assertOpaqueId(input.vendorId, "vendorId");
  assertOpaqueId(input.paymentTransactionId, "paymentTransactionId");
  const order = await canonicalOrderForPayment(tx, input.vendorId, input.paymentTransactionId);
  if (!order) return null;
  return reconcileCommerceOrderRefund(tx, {
    ...input,
    orderId: order.id,
    paymentTransactionId: input.paymentTransactionId,
  });
}
