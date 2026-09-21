import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { createEmailUnsubscribeUrl, protectEmailDeliveryPayload } from "@/lib/email-delivery-pii";
import { hashInteractionBearer } from "@/lib/live-interaction";
import { stableLineIdempotencyKey } from "@/lib/line-notification";

type ManualVoucherDb = {
  automationVoucherGrant: { create: (args: Prisma.AutomationVoucherGrantCreateArgs) => PromiseLike<{ id: string }> };
  emailDelivery: { create: (args: Prisma.EmailDeliveryCreateArgs) => PromiseLike<{ id: string }> };
};

/**
 * Creates one tenant-bound voucher and a durable encrypted email delivery in a
 * single transaction supplied by the caller. The raw bearer exists only long
 * enough to build the encrypted message payload and is never persisted.
 */
export async function issueManualCustomerVoucher(input: {
  db: ManualVoucherDb;
  vendorId: string;
  customerKeyHash: string;
  product: { id: string; name: string; currency: string };
  recipientEmail: string;
  discountPercentage?: number;
  expiresAt?: Date;
}) {
  const discountValue = input.discountPercentage ?? 10;
  if (!Number.isInteger(discountValue) || discountValue < 1 || discountValue > 99) throw new Error("Invalid voucher discount.");
  const grantId = `manual_voucher_${randomBytes(16).toString("hex")}`;
  const deliveryId = `manual_voucher_email_${randomBytes(16).toString("hex")}`;
  const bearer = randomBytes(32).toString("base64url");
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 72 * 60 * 60 * 1000);
  const voucherUrl = new URL("/api/automation/vouchers/redeem", getCanonicalAppUrl());
  voucherUrl.searchParams.set("token", bearer);
  await input.db.automationVoucherGrant.create({ data: {
    id: grantId, vendorId: input.vendorId, customerKeyHash: input.customerKeyHash,
    productId: input.product.id, claimTokenHash: hashInteractionBearer(bearer),
    discountType: "percentage", discountValue, currency: input.product.currency, expiresAt,
  } });
  const protectedPayload = protectEmailDeliveryPayload({
    recipientEmail: input.recipientEmail,
    subject: `為您保留的 ${input.product.name} 專屬優惠`,
    body: `顧問為您補發了 ${discountValue}% 限時專屬優惠，請在期限內使用：\n${voucherUrl.toString()}\n\n退訂：${createEmailUnsubscribeUrl(deliveryId)}`,
  }, { vendorId: input.vendorId, deliveryId });
  await input.db.emailDelivery.create({ data: {
    id: deliveryId, vendorId: input.vendorId, sourceTemplateId: "manual_customer_voucher_v1",
    trigger: "manual_customer_voucher", ...protectedPayload,
    idempotencyKey: stableLineIdempotencyKey(["manual-customer-voucher", grantId]),
    status: "queued", nextAttemptAt: new Date(),
  } });
  return { grantId, deliveryId, expiresAt };
}
