import type { PaymentMethodSetupSessionResult, PaymentProviderAdapter } from "@/lib/payment-providers/types";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type PaymentMethodSetupRequest = {
  scopeType: "VENDOR" | "MEMBERSHIP";
  teamId: string | null;
  membershipId: string | null;
};

export type PaymentMethodSetupDisposition =
  | "redirect"
  | "form_post"
  | "provider_setup_unsupported"
  | "provider_form_post_unsupported"
  | "provider_setup_unavailable";

export function hasPaymentMethodSetupCapability(
  provider: Pick<PaymentProviderAdapter, "createPaymentMethodSetupSession" | "verifyPaymentMethodSetupSignature" | "normalizePaymentMethodSetupPayload">,
): provider is Pick<PaymentProviderAdapter, "createPaymentMethodSetupSession" | "verifyPaymentMethodSetupSignature" | "normalizePaymentMethodSetupPayload">
  & Required<Pick<PaymentProviderAdapter, "createPaymentMethodSetupSession" | "verifyPaymentMethodSetupSignature" | "normalizePaymentMethodSetupPayload">> {
  return Boolean(
    provider.createPaymentMethodSetupSession
      && provider.verifyPaymentMethodSetupSignature
      && provider.normalizePaymentMethodSetupPayload,
  );
}

export function parsePaymentMethodSetupRequest(input: {
  scopeType: string;
  teamId?: string | null;
  membershipId?: string | null;
}): PaymentMethodSetupRequest | null {
  if (input.scopeType === "VENDOR") {
    return { scopeType: "VENDOR", teamId: null, membershipId: null };
  }

  if (input.scopeType !== "MEMBERSHIP") return null;
  const teamId = input.teamId?.trim() ?? "";
  const membershipId = input.membershipId?.trim() ?? "";
  if (!ID_PATTERN.test(teamId) || !ID_PATTERN.test(membershipId)) return null;

  return { scopeType: "MEMBERSHIP", teamId, membershipId };
}

/**
 * Provider setup URLs are returned by a trusted adapter, but they still cross
 * a redirect boundary. Reject credentials, non-web schemes, and malformed
 * values before handing the browser to the provider.
 */
export function isSafePaymentMethodSetupUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:"
      || (process.env.NODE_ENV !== "production" && url.protocol === "http:"
        && ["localhost", "127.0.0.1"].includes(url.hostname)))
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Only the PayUni UPP endpoint already used by checkout is approved here.
 * A future Token contract must add its exact destination before the adapter is enabled.
 */
export function isApprovedPaymentMethodSetupDestination(result: PaymentMethodSetupSessionResult) {
  if (result.provider !== "payuni" || result.mode !== "form_post") return false;
  const expected = process.env.PAYUNI_ENV === "sandbox"
    ? "https://sandbox-api.payuni.com.tw/api/upp"
    : process.env.PAYUNI_ENV === "production"
      ? "https://api.payuni.com.tw/api/upp"
      : null;
  return expected !== null && result.formAction === expected;
}

/** Limits the browser handoff to a small, provider-generated scalar form. */
export function safePaymentMethodSetupForm(result: PaymentMethodSetupSessionResult) {
  if (result.mode !== "form_post" || result.formMethod !== "POST"
    || !isSafePaymentMethodSetupUrl(result.formAction)
    || !isApprovedPaymentMethodSetupDestination(result) || !result.formPayload) return null;
  const entries = Object.entries(result.formPayload);
  if (entries.length === 0 || entries.length > 20
    || entries.some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)
      || typeof value !== "string" || value.length > 8192)
    || entries.reduce((length, [, value]) => length + value.length, 0) > 32768) return null;
  return { formAction: result.formAction!, formPayload: Object.fromEntries(entries) };
}

export function paymentMethodSetupDisposition(result: PaymentMethodSetupSessionResult): PaymentMethodSetupDisposition {
  if (result.mode === "form_post") return safePaymentMethodSetupForm(result) ? "form_post" : "provider_form_post_unsupported";
  // No current adapter has an approved setup redirect destination.
  if (result.mode === "redirect") return "provider_setup_unsupported";
  if (result.mode === "manual") return "provider_setup_unavailable";
  return "provider_setup_unavailable";
}
