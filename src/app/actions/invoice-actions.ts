"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorFinance } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment-providers";
import {
  checkoutReadinessAllowsNewTransaction,
  checkoutSessionHasUsableDestination,
  type CheckoutSessionResult,
} from "@/lib/payment-providers/types";

const INVOICE_PAYMENT_PURPOSE = "invoice_payment";
const INVOICE_PAYMENT_MAX_ATTEMPTS = 3;
const INVOICE_PAYMENT_PATH = "/billing/invoices";

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function invoiceIdFromMetadata(value: unknown) {
  const invoiceId = metadataObject(value).invoiceId;
  return typeof invoiceId === "string" && invoiceId.trim() ? invoiceId.trim() : null;
}

function billingPurposeFromMetadata(value: unknown) {
  const purpose = metadataObject(value).billingPurpose;
  return typeof purpose === "string" && purpose.trim() ? purpose.trim() : null;
}

function hasStoredCheckoutSession(value: unknown) {
  const checkout = metadataObject(metadataObject(value).checkoutSession);
  return typeof checkout.provider === "string"
    && typeof checkout.mode === "string"
    && typeof checkout.nextAction === "string";
}

function checkoutSessionMetadata(session: CheckoutSessionResult) {
  return {
    provider: session.provider,
    mode: session.mode,
    ...(session.checkoutUrl ? { checkoutUrl: session.checkoutUrl } : {}),
    ...(session.formAction ? { formAction: session.formAction } : {}),
    ...(session.formMethod ? { formMethod: session.formMethod } : {}),
    ...(session.formPayload ? { formPayload: session.formPayload } : {}),
    nextAction: session.nextAction,
    externalRequired: session.externalRequired ?? false,
  } as Prisma.InputJsonObject;
}

function invoicePaymentIdempotencyKey(vendorId: string, invoiceId: string) {
  return `invoice-payment:v1:${vendorId}:${invoiceId}`;
}

function orderNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CD-${stamp}-${suffix}`;
}

function isSerializationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function redirectError(code: string): never {
  redirect(`${INVOICE_PAYMENT_PATH}?error=${encodeURIComponent(code)}`);
}

async function failInvoicePaymentCheckout(transactionId: string) {
  await getDb().paymentTransaction.updateMany({
    where: { id: transactionId, status: "pending" },
    data: { status: "failed", checkoutIdempotencyKey: null },
  });
}

export async function payInvoiceAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor, member } = await requireVendorFinance(INVOICE_PAYMENT_PATH);
  const invoiceId = formText(formData, "invoiceId");
  if (!invoiceId || invoiceId.length > 64) redirectError("invalid_invoice");

  const checkoutIdempotencyKey = invoicePaymentIdempotencyKey(vendor.id, invoiceId);
  let provider: ReturnType<typeof getPaymentProvider> | null = null;
  let resolvedProviderId: string | null = null;
  const ensureProvider = () => {
    if (provider) return provider;
    try {
      provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
      resolvedProviderId = provider.id;
      return provider;
    } catch {
      redirectError("provider_not_configured");
    }
  };

  let result;
  for (let attempt = 1; attempt <= INVOICE_PAYMENT_MAX_ATTEMPTS; attempt += 1) {
    try {
      result = await getDb().$transaction(async (tx) => {
        const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, vendorId: vendor.id } });
        if (!invoice) return { outcome: "missing" as const };
        if (invoice.status === "paid") return { outcome: "already_paid" as const, invoice };
        if (!["issued", "overdue"].includes(invoice.status) || invoice.totalCents <= 0) {
          return { outcome: "not_payable" as const, invoice };
        }

        const existing = await tx.paymentTransaction.findUnique({
          where: { vendorId_checkoutIdempotencyKey: { vendorId: vendor.id, checkoutIdempotencyKey } },
        });
        if (existing) {
          const existingMetadata = metadataObject(existing.metadata);
          const matchesInvoice = billingPurposeFromMetadata(existingMetadata) === INVOICE_PAYMENT_PURPOSE
            && invoiceIdFromMetadata(existingMetadata) === invoice.id
            && existing.grossAmountCents === invoice.totalCents;
          if (!matchesInvoice) return { outcome: "conflict" as const, invoice };
          if (existing.status === "pending") {
            // Another request may still be creating the provider checkout
            // snapshot. Never call the provider a second time while the
            // server-owned transaction is pending without a stored session.
            // The first request will either persist the snapshot or fail the
            // transaction; a later retry can then safely replay or recreate it.
            if (!hasStoredCheckoutSession(existingMetadata)) {
              return { outcome: "in_progress" as const, invoice };
            }
            return {
              outcome: "reuse" as const,
              invoice,
              transaction: existing,
              hasCheckoutSession: hasStoredCheckoutSession(existingMetadata),
            };
          }
          if (existing.status === "paid") return { outcome: "conflict" as const, invoice };
          // A failed or otherwise terminal attempt no longer owns the retry key.
          await tx.paymentTransaction.update({
            where: { id: existing.id },
            data: { checkoutIdempotencyKey: null },
          });
        }

        const currentProvider = ensureProvider();
        try {
          if (!checkoutReadinessAllowsNewTransaction(currentProvider.checkoutReadiness())) {
            return { outcome: "provider_unavailable" as const, invoice };
          }
        } catch {
          return { outcome: "provider_unavailable" as const, invoice };
        }
        const transaction = await tx.paymentTransaction.create({
          data: {
            vendorId: vendor.id,
            providerName: currentProvider.id,
            orderNumber: orderNumber(),
            paymentMode: "platform",
            grossAmountCents: invoice.totalCents,
            netAmountCents: invoice.totalCents,
            currency: "TWD",
            status: "pending",
            checkoutIdempotencyKey,
            metadata: {
              billingPurpose: INVOICE_PAYMENT_PURPOSE,
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              invoiceTotalCents: invoice.totalCents,
            } as Prisma.InputJsonObject,
          },
        });
        return { outcome: "created" as const, invoice, transaction, hasCheckoutSession: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (!isSerializationConflict(error)) throw error;
      if (attempt === INVOICE_PAYMENT_MAX_ATTEMPTS) {
        redirect(`${INVOICE_PAYMENT_PATH}/${encodeURIComponent(invoiceId)}?error=conflict`);
      }
    }
  }

  if (!result || result.outcome === "missing") redirectError("invalid_invoice");
  if (result.outcome === "already_paid") redirect(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}?status=paid`);
  if (result.outcome === "not_payable") redirect(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}?error=not_payable`);
  if (result.outcome === "conflict") redirect(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}?error=conflict`);
  if (result.outcome === "in_progress") redirect(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}?error=checkout_in_progress`);
  if (result.outcome === "provider_unavailable") redirect(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}?error=checkout`);

  let checkoutSession: CheckoutSessionResult | null = null;
  if (!result.hasCheckoutSession) {
    const currentProvider = ensureProvider();
    try {
      checkoutSession = currentProvider.createCheckoutSession
        ? await currentProvider.createCheckoutSession({
            transaction: result.transaction,
            vendor,
            description: `CelebrateDeal 帳單 ${result.invoice.invoiceNumber}`,
            appUrl: getCanonicalAppUrl(),
          })
        : {
            provider: currentProvider.id,
            mode: "manual" as const,
            checkoutUrl: null,
            nextAction: "provider_checkout_adapter_pending",
            externalRequired: true,
          };
      if (!checkoutSessionHasUsableDestination(checkoutSession, currentProvider.checkoutReadiness())) {
        throw new Error("Payment provider returned no usable checkout destination.");
      }
    } catch {
      await getDb().paymentTransaction.updateMany({
        where: { id: result.transaction.id, status: "pending" },
        data: { status: "failed", checkoutIdempotencyKey: null },
      });
      redirect(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}?error=checkout`);
    }

    try {
      await getDb().paymentTransaction.update({
        where: { id: result.transaction.id },
        data: {
          metadata: {
            billingPurpose: INVOICE_PAYMENT_PURPOSE,
            invoiceId: result.invoice.id,
            invoiceNumber: result.invoice.invoiceNumber,
            invoiceTotalCents: result.invoice.totalCents,
            checkoutSession: checkoutSessionMetadata(checkoutSession),
          } as Prisma.InputJsonObject,
        },
      });
    } catch {
      // Never leave a provider checkout transaction pending without its
      // server-owned snapshot; otherwise a retry could create a second
      // external checkout for the same invoice.
      await failInvoicePaymentCheckout(result.transaction.id);
      redirect(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}?error=checkout`);
    }
  }

  await writeAuditLog({
    vendorId: vendor.id,
    actorId: member.id,
    actorLabel: member.role,
    action: "start_invoice_payment_checkout",
    targetType: "Invoice",
    targetId: result.invoice.id,
    before: auditSnapshot({ status: result.invoice.status, totalCents: result.invoice.totalCents }),
    after: auditSnapshot({
      status: "pending",
      transactionId: result.transaction.id,
      provider: resolvedProviderId ?? result.transaction.providerName,
      reused: result.outcome === "reuse",
    }),
  });

  revalidatePath(INVOICE_PAYMENT_PATH);
  revalidatePath(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}`);
  redirect(`${INVOICE_PAYMENT_PATH}/${result.invoice.id}?status=checkout&transactionId=${encodeURIComponent(result.transaction.id)}`);
}
