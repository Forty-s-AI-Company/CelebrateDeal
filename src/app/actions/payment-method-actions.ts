"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorFinance } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getPaymentProvider } from "@/lib/payment-providers";
import { PaymentMethodReferenceNotFoundError, revokePaymentMethodReference } from "@/lib/payment-method-reference";
import {
  hasPaymentMethodSetupCapability,
  parsePaymentMethodSetupRequest,
  paymentMethodSetupDisposition,
} from "@/lib/payment-method-setup";

const PAYMENT_METHODS_PATH = "/billing/payment-methods";

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectError(code: string): never {
  redirect(`${PAYMENT_METHODS_PATH}?error=${encodeURIComponent(code)}`);
}

function redirectStatus(status: string): never {
  redirect(`${PAYMENT_METHODS_PATH}?status=${encodeURIComponent(status)}`);
}

export async function startPaymentMethodSetupAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorFinance(PAYMENT_METHODS_PATH);
  const request = parsePaymentMethodSetupRequest({
    scopeType: formText(formData, "scopeType"),
    teamId: formText(formData, "teamId") || null,
    membershipId: formText(formData, "membershipId") || null,
  });
  if (!request) redirectError("invalid_scope");

  if (request.scopeType === "MEMBERSHIP") {
    const membership = await getDb().teamMembership.findFirst({
      where: {
        vendorId: vendor.id,
        teamId: request.teamId!,
        id: request.membershipId!,
        status: "ACTIVE",
        leftAt: null,
      },
      select: { id: true },
    });
    if (!membership) redirectError("invalid_scope");
  }

  let provider;
  try {
    provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
  } catch {
    redirectError("provider_not_configured");
  }

  if (!hasPaymentMethodSetupCapability(provider)) {
    redirectError("provider_setup_unsupported");
  }

  let result;
  try {
    result = await provider.createPaymentMethodSetupSession({
      vendor,
      scopeType: request.scopeType,
      teamId: request.teamId ?? undefined,
      membershipId: request.membershipId ?? undefined,
      appUrl: getCanonicalAppUrl(),
      returnPath: PAYMENT_METHODS_PATH,
    });
  } catch {
    redirectError("provider_setup_failed");
  }

  const disposition = paymentMethodSetupDisposition(result);
  if (disposition === "redirect" && result.setupUrl) {
    revalidatePath(PAYMENT_METHODS_PATH);
    redirect(result.setupUrl);
  }

  redirectError(disposition);
}

export async function revokePaymentMethodReferenceAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor, member } = await requireVendorFinance(PAYMENT_METHODS_PATH);
  const referenceId = formText(formData, "referenceId");
  if (!referenceId) redirectError("invalid_reference");

  let result;
  try {
    result = await revokePaymentMethodReference(getDb(), { vendorId: vendor.id, referenceId });
  } catch (error) {
    if (error instanceof PaymentMethodReferenceNotFoundError) redirectError("invalid_reference");
    throw error;
  }

  if (!result.changed) redirectStatus("already_revoked");

  let remoteCancellation: "confirmed" | "unsupported" | "failed" = "unsupported";
  try {
    const provider = getPaymentProvider(result.reference.providerName);
    if (provider.revokePaymentMethodReference) {
      await provider.revokePaymentMethodReference({
        providerPaymentMethodRef: result.reference.providerPaymentMethodRef,
        providerCustomerRef: result.reference.providerCustomerRef,
      });
      remoteCancellation = "confirmed";
    }
  } catch {
    remoteCancellation = "failed";
  }

  await writeAuditLog({
    vendorId: vendor.id,
    actorId: member.id,
    actorLabel: member.role,
    action: "revoke_payment_method_reference",
    targetType: "PaymentMethodReference",
    targetId: result.reference.id,
    before: auditSnapshot({
      scopeType: result.reference.scopeType,
      status: "active",
      providerName: result.reference.providerName,
    }),
    after: auditSnapshot({
      scopeType: result.reference.scopeType,
      status: "revoked",
      providerName: result.reference.providerName,
      remoteCancellation,
    }),
  });

  revalidatePath(PAYMENT_METHODS_PATH);
  if (remoteCancellation === "failed") redirectError("provider_revoke_failed");
  if (remoteCancellation === "unsupported") redirectError("local_revoked_provider_unsupported");
  redirectStatus("revoked");
}
