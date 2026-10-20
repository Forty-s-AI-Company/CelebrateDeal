import type { PaymentTransactionPurpose } from "@prisma/client";

/**
 * F-038 (PR #458 review m-3): a demo-provider transaction never moves money,
 * so it is always `demo`: excluded from the monthly settlement without
 * blocking it. Every other provider keeps the creator's business purpose.
 */
export function paymentTransactionPurposeFor(
  providerId: string,
  purpose: Extract<PaymentTransactionPurpose, "buyer_order" | "platform_subscription" | "invoice_payment">,
): PaymentTransactionPurpose {
  return providerId === "demo" ? "demo" : purpose;
}
