import type { PaymentMethodSetupSessionResult, PaymentProviderAdapter } from "@/lib/payment-providers/types";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type PaymentMethodSetupRequest = {
  scopeType: "VENDOR" | "MEMBERSHIP";
  teamId: string | null;
  membershipId: string | null;
};

export type PaymentMethodSetupDisposition =
  | "redirect"
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
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function paymentMethodSetupDisposition(result: PaymentMethodSetupSessionResult): PaymentMethodSetupDisposition {
  if (result.mode === "redirect" && isSafePaymentMethodSetupUrl(result.setupUrl)) return "redirect";
  if (result.mode === "form_post") return "provider_form_post_unsupported";
  if (result.mode === "manual") return "provider_setup_unavailable";
  return "provider_setup_unavailable";
}
