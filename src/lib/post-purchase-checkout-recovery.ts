import { Prisma, type PostPurchaseCredit } from "@prisma/client";
import { getDb } from "@/lib/db";
import { getCanonicalAppUrl, isExplicitLocalE2eRuntime } from "@/lib/app-url";
import { getPaymentProvider } from "@/lib/payment-providers";
import { checkoutReadinessAllowsNewTransaction, checkoutSessionHasUsableDestination, type CheckoutSessionResult } from "@/lib/payment-providers/types";
import { assertPostPurchaseCreditReplay, PostPurchaseUnavailableError, postPurchaseRequestCookies } from "@/lib/post-purchase-credit";
import { reacquireReleasedCheckoutInventory } from "@/lib/inventory-reservations";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const recoveryInclude = { vendor: true, inventoryReservation: true, primaryCommerceOrder: { include: { items: true } } } as const;
type RecoveryPayment = Prisma.PaymentTransactionGetPayload<{ include: typeof recoveryInclude }>;

function assertRecoveryMoney(payment: RecoveryPayment, credit: PostPurchaseCredit, productId: string) {
  const order = payment.primaryCommerceOrder;
  const primaryItem = order?.items[0];
  const recoverableState = (payment.status === "failed" && order?.status === "payment_failed")
    || (payment.status === "expired" && order?.status === "expired")
    || (payment.status === "pending" && order?.status === "pending_payment");
  if (!order || !primaryItem || !recoverableState || payment.refundedAmountCents !== 0
    || order.paidAmountCents !== 0 || order.refundedAmountCents !== 0 || order.isTestOrder
    || order.totalAmountCents !== credit.checkoutAmountCents || payment.grossAmountCents !== credit.checkoutAmountCents
    || payment.currency !== credit.currency || order.currency !== credit.currency
    || order.subtotalAmountCents - order.totalAmountCents !== credit.creditAmountCents + credit.offerDiscountCents
    || order.items.length !== 1 || primaryItem.productId !== productId || primaryItem.quantity !== 1) {
    throw new PostPurchaseUnavailableError();
  }
  return primaryItem;
}

/** Demo's original manual session cannot have created a remote trade. */
function originalLocalManualSession(payment: RecoveryPayment, metadata: Record<string, unknown>): CheckoutSessionResult {
  const session = object(metadata.checkoutSession);
  const payload = object(session.formPayload);
  if (payment.providerName !== "demo" || payment.providerTradeNo || metadata.postPurchaseSessionState !== "issued"
    || session.provider !== "demo" || session.mode !== "manual" || session.externalRequired === true
    || session.checkoutUrl || session.formAction || session.nextAction !== "demo_checkout_transaction_created"
    || payload.transactionId !== payment.id || payload.orderNumber !== (payment.orderNumber ?? payment.id)) {
    throw new PostPurchaseUnavailableError();
  }
  return session as CheckoutSessionResult;
}

async function recoverySession(payment: RecoveryPayment, metadata: Record<string, unknown>, productName: string) {
  const provider = getPaymentProvider(payment.providerName);
  const readiness = provider.checkoutReadiness();
  if (provider.checkoutSessionPreparation !== "local" || !provider.createCheckoutSession
    || !checkoutReadinessAllowsNewTransaction(readiness, process.env.NODE_ENV, isExplicitLocalE2eRuntime())) throw new PostPurchaseUnavailableError();
  if (metadata.postPurchaseSessionState === "issued") {
    if (readiness !== "local_only") throw new PostPurchaseUnavailableError();
    return originalLocalManualSession(payment, metadata);
  }
  if (payment.status !== "failed" || metadata.postPurchaseSessionState !== "unissued" || metadata.checkoutSession
    || payment.providerTradeNo || !["provider_checkout_failed", "checkout_metadata_failed"].includes(payment.inventoryReservation?.releaseReason ?? "")) {
    throw new PostPurchaseUnavailableError();
  }
  // Local preparation is the sole operation allowed here. Issued external
  // sessions require an independent provider observation contract.
  const session = await provider.createCheckoutSession({ transaction: payment, vendor: payment.vendor,
    description: productName, appUrl: getCanonicalAppUrl() });
  if (session.provider !== payment.providerName || !checkoutSessionHasUsableDestination(session, readiness)) throw new PostPurchaseUnavailableError();
  return session;
}

/**
 * Recover unissued local preparation or reuse an original local manual
 * session. Issued external forms and ambiguous payments require provider
 * observation; none authorizes a replacement transaction here.
 */
export async function resumePostPurchaseCheckout(request: Request, input: {
  vendorId: string; productId: string; idempotencyKey: string;
}) {
  const db = getDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const payment = await tx.paymentTransaction.findUnique({
          where: { vendorId_checkoutIdempotencyKey: { vendorId: input.vendorId, checkoutIdempotencyKey: input.idempotencyKey } },
          include: recoveryInclude,
        });
        const metadata = object(payment?.metadata);
        const order = payment?.primaryCommerceOrder;
        if (!payment || !order || metadata.productId !== input.productId || !metadata.postPurchaseCredit) throw new PostPurchaseUnavailableError();
        const credit = await assertPostPurchaseCreditReplay(tx, postPurchaseRequestCookies(request), {
          vendorId: input.vendorId, targetOrderId: order.id, productId: input.productId,
        });
        const primaryItem = assertRecoveryMoney(payment, credit, input.productId);
        if (payment.status === "pending" && metadata.postPurchaseSessionState === "issued") return false;
        if (!["provider_checkout_failed", "checkout_metadata_failed", "payment_failed", "expired"].includes(payment.inventoryReservation?.releaseReason ?? "")) {
          throw new PostPurchaseUnavailableError();
        }
        const session = await recoverySession(payment, metadata, primaryItem.productName);
        await reacquireReleasedCheckoutInventory(tx, { vendorId: input.vendorId, transactionId: payment.id, productId: input.productId });
        const { checkoutUrl, ...sessionFields } = session;
        const changed = await tx.paymentTransaction.updateMany({
          where: { id: payment.id, vendorId: input.vendorId, status: payment.status, providerTradeNo: null, refundedAmountCents: 0 },
          data: { status: "pending", metadata: { ...metadata, postPurchaseSessionState: "issued",
            checkoutSession: { ...sessionFields, ...(checkoutUrl ? { checkoutUrl } : {}) } } as Prisma.InputJsonObject },
        });
        const resumed = await tx.commerceOrder.updateMany({
          where: { id: order.id, vendorId: input.vendorId, status: order.status, paidAmountCents: 0, refundedAmountCents: 0 },
          data: { status: "pending_payment", failedAt: null },
        });
        if (changed.count !== 1 || resumed.count !== 1) throw new PostPurchaseUnavailableError();
        await tx.commerceOrderEvent.create({ data: { vendorId: input.vendorId, orderId: order.id,
          dedupKey: `checkout.recovered:${payment.id}:${payment.inventoryReservation?.expiresAt.toISOString()}`,
          eventType: "payment.checkout_recovered", actorType: "system",
          sanitizedData: { previousStatus: order.status, status: "pending_payment", provider: payment.providerName,
            amountCents: credit.checkoutAmountCents, mode: metadata.postPurchaseSessionState === "issued" ? "original_manual" : "unissued_preparation" } } });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new PostPurchaseUnavailableError();
}
