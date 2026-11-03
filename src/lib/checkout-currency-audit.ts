import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";

/** Where a non-TWD amount was stopped before reaching PayUni (F-041). */
export type UnsupportedCurrencySurface = "checkout_product" | "payuni_checkout_session";

export const UNSUPPORTED_CURRENCY_AUDIT_ACTION = "checkout_unsupported_currency_refused";
/** One audit row per target and action within this window; repeats are not recorded. */
export const UNSUPPORTED_CURRENCY_AUDIT_WINDOW_MS = 60 * 60 * 1000;

const MAX_AUDITED_CURRENCY_LENGTH = 16;

/**
 * Records that a money path refused a non-TWD amount. Anyone can retry a
 * public checkout, so the same target and action is recorded at most once an
 * hour (checked against the existing `[targetType, targetId]` index). The
 * check is best effort: two simultaneous refusals may both be recorded.
 *
 * The refusal itself is the safety property, so an audit read or write
 * failure never turns the refusal into a different response or a retry; it
 * only loses this record. The audit row holds the tenant, the record id and
 * the stored currency code, never buyer input or amounts supplied by the
 * client.
 */
export async function recordUnsupportedCurrencyRefusal(input: {
  vendorId: string;
  targetType: "Product" | "PaymentTransaction";
  targetId: string;
  currency: unknown;
  surface: UnsupportedCurrencySurface;
}, now: Date = new Date()) {
  try {
    const recent = await getDb().auditLog.findFirst({
      where: {
        targetType: input.targetType,
        targetId: input.targetId,
        action: UNSUPPORTED_CURRENCY_AUDIT_ACTION,
        createdAt: { gte: new Date(now.getTime() - UNSUPPORTED_CURRENCY_AUDIT_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recent) return;
    await writeAuditLog({
      vendorId: input.vendorId,
      actorLabel: "system",
      action: UNSUPPORTED_CURRENCY_AUDIT_ACTION,
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
