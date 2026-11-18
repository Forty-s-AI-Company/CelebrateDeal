import { z } from "zod";

/**
 * Payment adapter contract (F-008). Provider adapters normalize a verified
 * callback into this payload, and the webhook engine (`@/lib/payment-webhooks`)
 * consumes it. Both sides depend on this module; adapters must never import
 * the webhook engine (enforced in `scripts/architecture-boundaries.test.ts`).
 * `@/lib/payment-webhooks` re-exports the same schema object for its callers.
 */
export const PaymentWebhookPayload = z.object({
  provider: z.string().min(1),
  eventId: z.string().min(1),
  eventType: z.enum(["paid", "refunded", "partially_refunded", "failed", "dispute_opened", "dispute_released", "dispute_lost"]),
  vendorSlug: z.string().optional(),
  vendorId: z.string().optional(),
  orderNumber: z.string().min(1),
  providerTradeNo: z.string().optional(),
  paymentMode: z.enum(["platform", "byo"]).default("platform"),
  grossAmountCents: z.number().int().nonnegative().default(0),
  gatewayFeeCents: z.number().int().nonnegative().default(0),
  platformFeeCents: z.number().int().nonnegative().default(0),
  netAmountCents: z.number().int().nonnegative().optional(),
  currency: z.string().trim().length(3).optional(),
  occurredAt: z.string().datetime().optional(),
  refundAmountCents: z.number().int().nonnegative().default(0),
  gatewayFeeRefundCents: z.number().int().nonnegative().default(0),
  platformFeeRefundCents: z.number().int().nonnegative().default(0),
  refundReason: z.string().optional(),
  disputeCaseId: z.string().trim().min(1).optional(),
  // No referralCode/commissionRateBps: attribution and rates come only from the
  // server-created checkout transaction and the stored affiliate (F-048).
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type PaymentWebhookPayloadInput = z.infer<typeof PaymentWebhookPayload>;
