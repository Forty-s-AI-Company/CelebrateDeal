import { auditSnapshot, writeAuditLog } from "@/lib/audit";

/** Where a non-TWD amount was stopped before reaching PayUni (F-041). */
export type UnsupportedCurrencySurface = "checkout_product" | "payuni_checkout_session";

const MAX_AUDITED_CURRENCY_LENGTH = 16;

/**
 * Records that a money path refused a non-TWD amount. The refusal itself is
 * the safety property, so an audit write failure never turns the refusal into
 * a different response or a retry; it only loses this record. The audit row
 * holds the tenant, the record id and the stored currency code, never buyer
 * input or amounts supplied by the client.
 */
export async function recordUnsupportedCurrencyRefusal(input: {
  vendorId: string;
  targetType: "Product" | "PaymentTransaction";
  targetId: string;
  currency: unknown;
  surface: UnsupportedCurrencySurface;
}) {
  try {
    await writeAuditLog({
      vendorId: input.vendorId,
      actorLabel: "system",
      action: "checkout_unsupported_currency_refused",
      targetType: input.targetType,
      targetId: input.targetId,
      after: auditSnapshot({
        surface: input.surface,
        currency: typeof input.currency === "string" ? input.currency.slice(0, MAX_AUDITED_CURRENCY_LENGTH) : null,
      }),
    });
  } catch {
    // Keep the refusal response unchanged when the audit store is unavailable.
  }
}
