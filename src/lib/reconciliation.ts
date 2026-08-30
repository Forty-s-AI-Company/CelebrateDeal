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

function metadataObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function invoiceIdFromMetadata(metadata: unknown) {
  const invoiceId = metadataObject(metadata).invoiceId;
  return typeof invoiceId === "string" && invoiceId.trim().length > 0 ? invoiceId.trim() : null;
}

function isInvoicePayment(metadata: unknown) {
  return metadataObject(metadata).billingPurpose === "invoice_payment";
}

function expectedInvoiceStatus(transactionStatus: string) {
  if (["paid", "partially_refunded", "refunded"].includes(transactionStatus)) {
    return transactionStatus;
  }
  return null;
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
  if (!event.vendorId) {
    return [{
      key: "transaction_exists",
      label: "Webhook order -> payment transaction",
      status: "fail",
      expected: `${payload.provider}:${payload.orderNumber}`,
      actual: "missing webhook vendor scope",
      detail: "Webhook event 尚未完成商家歸屬，拒絕用未 scoped 的 order number 猜測交易。",
    }];
  }
  const transaction = await db.paymentTransaction.findFirst({
    where: {
      vendorId: event.vendorId,
      providerName: payload.provider,
      orderNumber: payload.orderNumber,
    },
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

  if (transaction.paymentMode === "platform" && isInvoicePayment(transaction.metadata)) {
    const invoiceId = invoiceIdFromMetadata(transaction.metadata);
    const invoice = invoiceId
      ? await db.invoice.findFirst({ where: { id: invoiceId, vendorId: event.vendorId } })
      : null;
    checks.push({
      key: "invoice_identity",
      label: "Invoice payment -> invoice identity",
      status: invoice ? "pass" : "fail",
      expected: invoiceId ?? "invoiceId in trusted checkout metadata",
      actual: invoice?.id ?? "missing",
      detail: invoice ? undefined : "帳單付款交易的 trusted metadata 無法解析到同一商家的 invoice。",
    });

    if (invoice) {
      checks.push({
        key: "invoice_amount",
        label: "Invoice total vs payment transaction",
        status: invoice.totalCents === transaction.grossAmountCents ? "pass" : "fail",
        expected: String(invoice.totalCents),
        actual: String(transaction.grossAmountCents),
      });

      const expectedStatus = expectedInvoiceStatus(transaction.status);
      if (expectedStatus) {
        checks.push({
          key: "invoice_status",
          label: "Invoice status vs payment transaction",
          status: invoice.status === expectedStatus ? "pass" : "fail",
          expected: expectedStatus,
          actual: invoice.status,
        });
      } else {
        checks.push({
          key: "invoice_status",
          label: "Invoice status vs payment transaction",
          status: ["issued", "overdue"].includes(invoice.status) ? "pass" : "warning",
          expected: "issued or overdue while payment is not settled",
          actual: invoice.status,
        });
      }
    }
  }

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
        vendorId: event.vendorId,
        sourceType: "webhook",
        sourceId: transaction.id,
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
