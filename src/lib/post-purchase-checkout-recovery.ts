import { Prisma, type PostPurchaseCredit } from "@prisma/client";
import { getDb } from "@/lib/db";
import { getCanonicalAppUrl, isExplicitLocalE2eRuntime } from "@/lib/app-url";
import { getPaymentProvider } from "@/lib/payment-providers";
import { checkoutReadinessAllowsNewTransaction, checkoutSessionHasUsableDestination } from "@/lib/payment-providers/types";
import { assertPostPurchaseCreditReplay, PostPurchaseUnavailableError, postPurchaseRequestCookies } from "@/lib/post-purchase-credit";
import { reacquireReleasedCheckoutInventory } from "@/lib/inventory-reservations";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const recoveryInclude = { vendor: true, inventoryReservation: true, primaryCommerceOrder: { include: { items: true } } } as const;
type RecoveryPayment = Prisma.PaymentTransactionGetPayload<{ include: typeof recoveryInclude }>;

function assertUnissuedRecovery(payment: RecoveryPayment, metadata: Record<string, unknown>, credit: PostPurchaseCredit, productId: string) {
  const order = payment.primaryCommerceOrder;
  if (!order || payment.status !== "failed" || metadata.postPurchaseSessionState !== "unissued" || metadata.checkoutSession
    || payment.providerTradeNo || payment.refundedAmountCents !== 0 || order.status !== "payment_failed"
    || order.paidAmountCents !== 0 || order.refundedAmountCents !== 0 || order.isTestOrder
    || order.totalAmountCents !== credit.checkoutAmountCents || payment.grossAmountCents !== credit.checkoutAmountCents
    || payment.currency !== credit.currency || order.currency !== credit.currency
    || order.subtotalAmountCents - order.totalAmountCents !== credit.creditAmountCents + credit.offerDiscountCents
    || order.items.length !== 1 || order.items[0].productId !== productId || order.items[0].quantity !== 1
    || !["provider_checkout_failed", "checkout_metadata_failed"].includes(payment.inventoryReservation?.releaseReason ?? "")) {
    throw new PostPurchaseUnavailableError();
  }
}

/**
 * Recover only a locally prepared session that was never issued. An issued
 * form, provider reference or ambiguous payment requires provider observation;
 * none of those states authorizes a replacement transaction here.
 */
export async function resumeUnissuedPostPurchaseCheckout(request: Request, input: {
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
        if (payment.status === "pending" && metadata.postPurchaseSessionState === "issued") return false;
        assertUnissuedRecovery(payment, metadata, credit, input.productId);
        const provider = getPaymentProvider(payment.providerName);
        const readiness = provider.checkoutReadiness();
        if (provider.checkoutSessionPreparation !== "local" || !provider.createCheckoutSession
          || !checkoutReadinessAllowsNewTransaction(readiness, process.env.NODE_ENV, isExplicitLocalE2eRuntime())) throw new PostPurchaseUnavailableError();
        // This capability promises no network or provider mutation; keep it in
        // the serializable transaction so refund/concurrent recovery rolls back.
        const session = await provider.createCheckoutSession({ transaction: payment, vendor: payment.vendor,
          description: order.items[0].productName, appUrl: getCanonicalAppUrl() });
        if (session.provider !== payment.providerName || !checkoutSessionHasUsableDestination(session, readiness)) throw new PostPurchaseUnavailableError();
        await reacquireReleasedCheckoutInventory(tx, { vendorId: input.vendorId, transactionId: payment.id, productId: input.productId });
        const { checkoutUrl, ...sessionFields } = session;
        const changed = await tx.paymentTransaction.updateMany({
          where: { id: payment.id, vendorId: input.vendorId, status: "failed", providerTradeNo: null, refundedAmountCents: 0 },
          data: { status: "pending", metadata: { ...metadata, postPurchaseSessionState: "issued",
            checkoutSession: { ...sessionFields, ...(checkoutUrl ? { checkoutUrl } : {}) } } as Prisma.InputJsonObject },
        });
        const resumed = await tx.commerceOrder.updateMany({
          where: { id: order.id, vendorId: input.vendorId, status: "payment_failed", paidAmountCents: 0, refundedAmountCents: 0 },
          data: { status: "pending_payment", failedAt: null },
        });
        if (changed.count !== 1 || resumed.count !== 1) throw new PostPurchaseUnavailableError();
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new PostPurchaseUnavailableError();
}
