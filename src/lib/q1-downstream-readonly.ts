import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { wp4HistoricalBuyerWhere } from "./wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
import { revealCommerceOrderPii } from "./commerce-order-pii";
import { protectEmailDeliveryPayload } from "./email-delivery-pii";
import { classifyPaymentWebhookErrorClass } from "./payment-webhook-errors";
import { coursePolicySnapshotFromMetadata } from "./course-policy-snapshot";

export const Q1_ORIGINAL_SOURCE = "9acfe8d2dba62430e950cff2c0387841ab91f44b";
// All unconditional paid-path dependencies and relations, reviewed together.
export const Q1_DOWNSTREAM_MODELS = ["PaymentTransaction", "RefundRecord", "CommerceOrder",
  "CommerceOrderItem", "CommerceOrderEvent", "CommerceEntitlement", "EmailDelivery",
  "MerchantAffiliateCheckoutSnapshot", "MerchantAffiliatePolicy", "MerchantAffiliateCheckoutRecipient",
  "MerchantAffiliateCalculation", "MerchantAffiliateSalesCounter", "AffiliateCommission"] as const;
const models = Q1_DOWNSTREAM_MODELS.map(name => {
  const model = Prisma.dmmf.datamodel.models.find(candidate => candidate.name === name);
  if (!model) throw new Error("Reviewed processing model unavailable.");
  return model;
});
const scalarNames = [...new Set(models.flatMap(model => model.fields.filter(f => f.kind !== "object").map(f => f.name)))];
const enumNames = [...new Set(models.flatMap(model => model.fields.filter(f => f.kind === "enum").map(f => f.type)))];
const enums = Prisma.dmmf.datamodel.enums.filter(value => enumNames.includes(value.name));
const enumLabels = [...new Set(enums.flatMap(value => value.values.map(label => label.name)))];
const CryptoState = z.enum(["OK", "SENSITIVE_KEY_MISSING", "SENSITIVE_KEY_TOO_SHORT", "SENSITIVE_ENVELOPE_INVALID",
  "SENSITIVE_ENVELOPE_AUTH_FAILED", "CommerceOrderPiiValidationError", "EMAIL_BINDING", "EMAIL_RECIPIENT", "OTHER", "NOT_RUN"]);
export const Q1DownstreamReceipt = z.object({
  classification: z.enum(["DOWNSTREAM_OBSERVED", "FIXTURE_UNAVAILABLE", "ORDER_UNAVAILABLE", "SCHEMA_INCOMPATIBLE", "READ_FAILED"]),
  readStage: z.enum(["NONE", "SCHEMA", "PAYMENT", "ORDER", "MERCHANT_AFFILIATE", "PAYMENT_RELATIONS",
    "LEGACY_COMMISSION", "ORDER_ITEMS", "ENTITLEMENT", "PAID_DELIVERY", "ORDER_EVENT", "CRYPTO"]),
  readClass: z.enum(["NONE", "P2002", "P2010", "P2021", "P2022", "P2028", "P2034",
    "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientInitializationError", "PrismaClientValidationError", "OTHER"]),
  schema: z.array(z.object({ model: z.enum(Q1_DOWNSTREAM_MODELS), compatible: z.boolean(),
    missingColumns: z.array(z.string().refine(value => scalarNames.includes(value))) }).strict()),
  enums: z.array(z.object({ name: z.string().refine(value => enumNames.includes(value)), compatible: z.boolean(),
    missingLabels: z.array(z.string().refine(value => enumLabels.includes(value))) }).strict()),
  decrypt: CryptoState, protect: CryptoState,
  billingPurposeClass: z.enum(["buyer_order", "platform_subscription_checkout", "invoice_payment", "NONE", "OTHER", "NOT_RUN"]),
  coursePolicySnapshotClass: z.enum(["ABSENT", "VALID", "INVALID", "NOT_RUN"]),
  merchantSnapshotExists: z.boolean().nullable(), emailDeliveryExists: z.boolean().nullable(), paidOrderEventExists: z.boolean().nullable(),
  databaseWrites: z.literal(false), callbackPosts: z.literal(0), callbackReplayAuthorized: z.literal(false),
}).strict();
const base = { readStage: "NONE", readClass: "NONE", schema: [], enums: [], decrypt: "NOT_RUN", protect: "NOT_RUN", billingPurposeClass: "NOT_RUN",
  coursePolicySnapshotClass: "NOT_RUN", merchantSnapshotExists: null, emailDeliveryExists: null, paidOrderEventExists: null,
  databaseWrites: false, callbackPosts: 0, callbackReplayAuthorized: false } as const;

function cryptoState(error: unknown) {
  if (error instanceof Error && error.message === "Invalid email delivery binding.") return "EMAIL_BINDING" as const;
  if (error instanceof Error && error.message === "Invalid email delivery recipient.") return "EMAIL_RECIPIENT" as const;
  const result = CryptoState.safeParse(classifyPaymentWebhookErrorClass(error));
  return result.success ? result.data : "OTHER" as const;
}

/** Runs inside the deployment process, so crypto uses the checkout/retry runtime
 * binding, never a separately copied key. Plaintext stays in memory and is discarded.
 * No enqueue, provider call, transaction replay or durable marker update occurs. */
export async function readQ1Downstream(db: Pick<PrismaClient, "$transaction">) {
  let readStage: z.infer<typeof Q1DownstreamReceipt>["readStage"] = "SCHEMA";
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const columns = await tx.$queryRaw<{ table_name: string; column_name: string }[]>(Prisma.sql`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name IN (${Prisma.join(models.map(m => m.dbName ?? m.name))})`);
      const labels = await tx.$queryRaw<{ type_name: string; label: string }[]>(Prisma.sql`
        SELECT t.typname AS type_name, e.enumlabel AS label FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema() AND t.typname IN (${Prisma.join(enums.map(e => e.dbName ?? e.name))})`);
      const schema = models.map(model => {
        const observed = new Set(columns.filter(c => c.table_name === (model.dbName ?? model.name)).map(c => c.column_name));
        const missingColumns = model.fields.filter(f => f.kind !== "object" && !observed.has(f.dbName ?? f.name)).map(f => f.name);
        return { model: model.name, compatible: missingColumns.length === 0, missingColumns };
      });
      const enumReport = enums.map(value => {
        const observed = new Set(labels.filter(l => l.type_name === (value.dbName ?? value.name)).map(l => l.label));
        const missingLabels = value.values.filter(l => !observed.has(l.dbName ?? l.name)).map(l => l.name);
        return { name: value.name, compatible: missingLabels.length === 0, missingLabels };
      });
      const common = { ...base, schema, enums: enumReport };
      // A missing downstream column stops before reading any protected values.
      if (schema.some(item => !item.compatible) || enumReport.some(item => !item.compatible)) {
        return Q1DownstreamReceipt.parse({ ...common, classification: "SCHEMA_INCOMPATIBLE" });
      }
      readStage = "PAYMENT";
      const payments = await tx.paymentTransaction.findMany({ where: wp4HistoricalBuyerWhere(Q1_ORIGINAL_SOURCE), take: 2,
        select: { id: true, vendorId: true, metadata: true } });
      if (payments.length !== 1) return Q1DownstreamReceipt.parse({ ...common, classification: "FIXTURE_UNAVAILABLE" });
      const payment = payments[0]!;
      readStage = "ORDER";
      const orders = await tx.commerceOrder.findMany({ where: { vendorId: payment.vendorId, primaryPaymentTransactionId: payment.id }, take: 2,
        select: { id: true, buyerEncryptedEnvelope: true, shippingEncryptedEnvelope: true } });
      if (orders.length !== 1) return Q1DownstreamReceipt.parse({ ...common, classification: "ORDER_UNAVAILABLE" });
      const order = orders[0]!;
      const metadata = payment.metadata && typeof payment.metadata === "object" && !Array.isArray(payment.metadata) ? payment.metadata : {};
      const purpose = metadata.billingPurpose;
      const billingPurposeClass = ["buyer_order", "platform_subscription_checkout", "invoice_payment"].includes(String(purpose))
        ? purpose : purpose === undefined ? "NONE" : "OTHER";
      const coursePolicySnapshotClass = !Object.hasOwn(metadata, "coursePolicySnapshot") ? "ABSENT"
        : coursePolicySnapshotFromMetadata(metadata) ? "VALID" : "INVALID";
      // Exercise the same relation shapes without calling mutating reconcilers.
      readStage = "MERCHANT_AFFILIATE";
      const merchant = await tx.merchantAffiliateCheckoutSnapshot.findUnique({
        where: { vendorId_paymentTransactionId: { vendorId: payment.vendorId, paymentTransactionId: payment.id } },
        include: { policy: true, recipients: { orderBy: { level: "asc" } }, calculation: true },
      });
      readStage = "PAYMENT_RELATIONS";
      await tx.paymentTransaction.findFirst({ where: { id: payment.id, vendorId: payment.vendorId },
        include: { refunds: true, primaryCommerceOrder: { select: { id: true } } } });
      readStage = "LEGACY_COMMISSION";
      await tx.affiliateCommission.findFirst({ where: { vendorId: payment.vendorId, sourceType: "webhook", sourceId: payment.id } });
      readStage = "ORDER_ITEMS";
      await tx.commerceOrderItem.findMany({ where: { vendorId: payment.vendorId, orderId: order.id } });
      readStage = "ENTITLEMENT";
      await tx.commerceEntitlement.findFirst({ where: { vendorId: payment.vendorId, orderItem: { orderId: order.id } }, select: { id: true } });
      readStage = "PAID_DELIVERY";
      const email = await tx.emailDelivery.findUnique({ where: { vendorId_idempotencyKey: { vendorId: payment.vendorId,
        idempotencyKey: `order-paid:v1:${order.id}` } }, select: { id: true } });
      readStage = "ORDER_EVENT";
      const event = await tx.commerceOrderEvent.findFirst({ where: { vendorId: payment.vendorId, orderId: order.id,
        eventType: "payment.paid" }, select: { id: true } });
      readStage = "CRYPTO";
      let decrypt: z.infer<typeof CryptoState> = "NOT_RUN", protect: z.infer<typeof CryptoState> = "NOT_RUN";
      try {
        const pii = revealCommerceOrderPii({ buyerEncrypted: order.buyerEncryptedEnvelope, shippingEncrypted: order.shippingEncryptedEnvelope },
          { vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: order.id });
        decrypt = "OK";
        try {
          protectEmailDeliveryPayload({ recipientEmail: pii.buyer.email, subject: "Synthetic diagnostic", body: "Synthetic diagnostic" },
            { vendorId: payment.vendorId, deliveryId: `order_paid_${order.id}` });
          protect = "OK";
        } catch (error) { protect = cryptoState(error); }
      } catch (error) { decrypt = cryptoState(error); }
      return Q1DownstreamReceipt.parse({ ...common, classification: "DOWNSTREAM_OBSERVED", decrypt, protect,
        billingPurposeClass, coursePolicySnapshotClass, merchantSnapshotExists: merchant !== null,
        emailDeliveryExists: email !== null, paidOrderEventExists: event !== null });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
  } catch (error) {
    const parsed = Q1DownstreamReceipt.shape.readClass.safeParse(classifyPaymentWebhookErrorClass(error));
    return Q1DownstreamReceipt.parse({ ...base, classification: "READ_FAILED", readStage, readClass: parsed.success ? parsed.data : "OTHER" });
  }
}
