import type { WebhookEvent } from "@prisma/client";
import { getDb } from "@/lib/db";
import { PaymentWebhookPayload } from "@/lib/payment-webhooks";

export type ReconciliationCheck = {
  key: string;
  label: string;
  status: "pass" | "warning" | "fail";
  expected: string;
  actual: string;
  detail?: string;
};

function payloadFromEvent(event: WebhookEvent) {
  const payload = event.payload as { normalized?: unknown };
  return PaymentWebhookPayload.safeParse(payload.normalized ?? event.payload);
}

export async function reconcileWebhookEvent(event: WebhookEvent): Promise<ReconciliationCheck[]> {
  const parsed = payloadFromEvent(event);
  if (!parsed.success) {
    return [{
      key: "payload",
      label: "Normalized payload",
      status: "fail",
      expected: "Valid internal payment payload",
      actual: "Invalid payload",
      detail: JSON.stringify(parsed.error.flatten()),
    }];
  }

  const payload = parsed.data;
  const db = getDb();
  const transaction = await db.paymentTransaction.findFirst({
    where: { orderNumber: payload.orderNumber },
    include: { refunds: true },
  });

  const checks: ReconciliationCheck[] = [];
  checks.push({
    key: "transaction_exists",
    label: "Webhook order -> payment transaction",
    status: transaction ? "pass" : "fail",
    expected: payload.orderNumber,
    actual: transaction?.orderNumber ?? "missing",
  });

  if (!transaction) return checks;

  const expectedGross = payload.grossAmountCents || transaction.grossAmountCents;
  checks.push({
    key: "transaction_amount",
    label: "Webhook amount vs payment transaction",
    status: expectedGross === transaction.grossAmountCents ? "pass" : "fail",
    expected: String(expectedGross),
    actual: String(transaction.grossAmountCents),
  });

  const refundTotal = transaction.refunds.reduce((sum, refund) => sum + refund.refundAmountCents, 0);
  checks.push({
    key: "refund_total",
    label: "Refund records vs transaction refunded amount",
    status: refundTotal === transaction.refundedAmountCents ? "pass" : "fail",
    expected: String(transaction.refundedAmountCents),
    actual: String(refundTotal),
  });

  if (payload.referralCode && payload.eventType === "paid") {
    const commission = await db.affiliateCommission.findFirst({
      where: {
        orderNumber: payload.orderNumber,
        referralCode: payload.referralCode.toUpperCase(),
      },
    });
    checks.push({
      key: "affiliate_commission",
      label: "Referral code -> affiliate commission",
      status: commission ? "pass" : "fail",
      expected: payload.referralCode.toUpperCase(),
      actual: commission?.referralCode ?? "missing",
    });
  }

  return checks;
}
