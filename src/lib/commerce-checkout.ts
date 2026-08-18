import { z } from "zod";

import { allowedPaymentUrl } from "@/lib/payment-checkout-presentation";

export const COMMERCE_FULFILLMENT_TYPES = ["physical", "digital", "service", "course"] as const;
export type CommerceCheckoutFulfillmentType = (typeof COMMERCE_FULFILLMENT_TYPES)[number];

const checkoutText = z.string().trim().min(1).max(128);

export const CommerceCheckoutRequestSchema = z.object({
  vendorId: checkoutText,
  productId: checkoutText,
  idempotencyKey: z.string().uuid(),
  admissionToken: z.string().regex(/^ca1\.[A-Za-z0-9_-]{1,768}\.[A-Za-z0-9_-]{43}$/u).max(900),
  buyer: z.unknown(),
  shipping: z.unknown().nullable().optional(),
  customCheckoutAnswers: z.unknown().optional(),
}).strict();

export const CommerceCheckoutAdmissionResponseSchema = z.object({
  admissionToken: z.string().regex(/^ca1\.[A-Za-z0-9_-]{1,768}\.[A-Za-z0-9_-]{43}$/u).max(900),
  idempotencyKey: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const CommerceCheckoutResponseSchema = z.object({
  ok: z.literal(true),
  provider: z.string().min(1).max(64),
  orderNumber: z.string().min(1).max(128),
  transactionId: z.string().min(1).max(128),
  amountCents: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  checkoutUrl: z.string().url().nullable().optional(),
  formAction: z.string().url().optional(),
  formMethod: z.literal("POST").optional(),
  formPayload: z.record(z.string(), z.string()).optional(),
  nextAction: z.string().min(1).max(128),
  externalRequired: z.boolean(),
}).strict();

export type CommerceCheckoutResponse = z.infer<typeof CommerceCheckoutResponseSchema>;

export function checkoutRequiresShipping(fulfillmentType: CommerceCheckoutFulfillmentType) {
  return fulfillmentType === "physical";
}

export function checkoutRequiresPhone(fulfillmentType: CommerceCheckoutFulfillmentType) {
  return fulfillmentType === "physical" || fulfillmentType === "service";
}

export function isAllowedCheckoutDestination(value: string, currentOrigin: string, provider: string) {
  try {
    const destination = new URL(value, currentOrigin);
    const origin = new URL(currentOrigin).origin;
    if (destination.origin === origin) return true;
    return provider === "payuni" && allowedPaymentUrl(destination.toString()) !== null;
  } catch {
    return false;
  }
}

export function checkoutErrorMessage(status: number) {
  if (status === 400) return "請確認聯絡與收件資料是否完整。";
  if (status === 404) return "這個商品目前無法購買。";
  if (status === 409) return "商品可能已售完，或這次結帳資料已變更；請重新整理後再試一次。";
  if (status === 425) return "訂單正在建立中，請稍候後重試；系統會沿用同一筆訂單。";
  if (status === 429) return "操作太頻繁，請稍候再試。";
  return "目前無法開始付款；尚未向你收款，請稍後重試。";
}

/**
 * A 5xx response can happen after the checkout transaction committed but
 * before its response reached the browser. Keep the server-issued identity so
 * the next submit resolves that same checkout instead of reserving stock twice.
 */
export function shouldDiscardCheckoutAdmission(status: number) {
  return status === 409;
}
