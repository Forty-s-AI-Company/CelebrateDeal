/**
 * Keeps provider checkout metadata safe to render in a Server Component.
 * Provider tokens and raw callback payloads are never accepted here.
 */
export function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const PAYUNI_CHECKOUT_FIELDS = ["MerID", "Version", "EncryptInfo", "HashInfo"] as const;

function safeCheckoutFormPayload(provider: string | null, value: unknown): Record<string, string> {
  if (provider !== "payuni") return {};
  const payload = metadataObject(value);
  const entries = PAYUNI_CHECKOUT_FIELDS.map((field) => [field, payload[field]] as const);
  if (entries.some(([, item]) => typeof item !== "string" || item.length === 0 || item.length > 4096)) {
    return {};
  }
  return Object.fromEntries(entries) as Record<(typeof PAYUNI_CHECKOUT_FIELDS)[number], string>;
}

export function checkoutSessionFromMetadata(value: unknown) {
  const checkout = metadataObject(metadataObject(value).checkoutSession);
  const provider = typeof checkout.provider === "string" ? checkout.provider : null;
  const safePayload = safeCheckoutFormPayload(provider, checkout.formPayload);

  return {
    provider,
    mode: checkout.mode === "form_post" || checkout.mode === "redirect" || checkout.mode === "manual"
      ? checkout.mode
      : null,
    formAction: typeof checkout.formAction === "string" ? checkout.formAction : null,
    checkoutUrl: typeof checkout.checkoutUrl === "string" ? checkout.checkoutUrl : null,
    nextAction: typeof checkout.nextAction === "string" ? checkout.nextAction : null,
    formPayload: safePayload,
  };
}

export function allowedPaymentUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowed = new Set([
      "https://sandbox-api.payuni.com.tw/api/upp",
      "https://api.payuni.com.tw/api/upp",
    ]);
    return allowed.has(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}
