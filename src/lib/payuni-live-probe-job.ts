import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { payUniLiveProbeAvailable, PAYUNI_LIVE_PROBE_AMOUNT_CENTS, PAYUNI_LIVE_PROBE_CONSENT_TEXT, PAYUNI_LIVE_PROBE_CONSENT_VERSION } from "@/lib/payuni-live-probe";
import { chargePayUniLiveProbe } from "@/lib/payment-providers/payuni";

const MAX_LATE_MS = 30 * 60 * 1000;

/** Claims the one consented live request before network I/O; uncertain results are never retried. */
export async function runPayUniLiveProbeJob(now = new Date()) {
  const vendorId = process.env.PAYUNI_LIVE_PROBE_VENDOR_ID?.trim() ?? "";
  if (!payUniLiveProbeAvailable(vendorId)) return { outcome: "disabled" as const };
  const db = getDb();
  const probe = await db.payUniLiveProbe.findUnique({ where: { vendorId } });
  if (!probe || probe.status !== "scheduled" || !probe.dueAt || probe.dueAt > now) {
    return { outcome: "not_due" as const };
  }
  if (probe.dueAt.getTime() + MAX_LATE_MS < now.getTime()) {
    await db.payUniLiveProbe.updateMany({
      where: { id: probe.id, vendorId, status: "scheduled" },
      data: { status: "missed", failureCode: "missed_window" },
    });
    return { outcome: "missed" as const };
  }
  if (probe.firstAmountCents !== PAYUNI_LIVE_PROBE_AMOUNT_CENTS
    || probe.secondAmountCents !== PAYUNI_LIVE_PROBE_AMOUNT_CENTS
    || probe.consentVersion !== PAYUNI_LIVE_PROBE_CONSENT_VERSION
    || probe.consentText !== PAYUNI_LIVE_PROBE_CONSENT_TEXT
    || !probe.consentActorId || !probe.consentedAt || probe.consentedAt > now
    || !probe.paymentMethodReferenceId) return { outcome: "invalid" as const };

  const reference = await db.paymentMethodReference.findUnique({
    where: { vendorId_id: { vendorId, id: probe.paymentMethodReferenceId } },
    select: {
      id: true, vendorId: true, scopeType: true, providerName: true, providerPaymentMethodRef: true,
      status: true, verifiedAt: true, expiresAt: true,
    },
  });
  if (!reference || reference.scopeType !== "VENDOR" || reference.providerName !== "payuni"
    || reference.status !== "verified" || !reference.verifiedAt
    || (reference.expiresAt && reference.expiresAt <= now)) return { outcome: "invalid" as const };

  // No automatic retry follows this compare-and-set, even on timeout or crash.
  const claimed = await db.payUniLiveProbe.updateMany({
    where: { id: probe.id, vendorId, status: "scheduled", dueAt: { lte: now } },
    data: { status: "dispatched", attemptedAt: now },
  });
  if (claimed.count !== 1) return { outcome: "already_claimed" as const };

  let result: Awaited<ReturnType<typeof chargePayUniLiveProbe>>;
  try {
    result = await chargePayUniLiveProbe({
      orderNumber: probe.secondOrderNumber,
      creditHash: reference.providerPaymentMethodRef,
      appUrl: getCanonicalAppUrl(),
    });
  } catch {
    result = { status: "ambiguous" };
  }
  await db.payUniLiveProbe.updateMany({
    where: { id: probe.id, vendorId, status: "dispatched" },
    data: {
      status: result.status,
      ...(result.status === "confirmed"
        ? { providerTradeNo: result.providerTradeNo, completedAt: new Date() }
        : { failureCode: result.status === "failed" ? "provider_declined" : "provider_result_ambiguous" }),
    },
  });
  return { outcome: result.status };
}
