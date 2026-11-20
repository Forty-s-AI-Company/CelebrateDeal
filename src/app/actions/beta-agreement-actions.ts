"use server";

import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import {
  BETA_AGREEMENT_PATH,
  betaAgreementPending,
  betaAgreementReturnPath,
  canAcceptBetaAgreement,
  isCurrentBetaAgreementVersion,
  recordBetaAgreementAcceptance,
  type RecordBetaAgreementResult,
} from "@/lib/beta-agreement";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";
import { switchSessionVendor, switchTargetVendorId } from "@/lib/session-vendor-switch";
import { isVendorBackofficeRole, signedInHomePath } from "@/lib/vendor-roles";
import { VENDOR_SUSPENDED_PATH } from "@/lib/vendor-suspension-state";

/**
 * O-11: an active owner accepts the current 封測合作協議 for the session's
 * vendor. Everything is decided on the server: the vendor and account come
 * from the session, the version must equal the server's current one, and the
 * owner role is re-checked inside the write transaction. The page's scroll
 * requirement is only a reading aid and is never trusted here.
 *
 * A platform administrator is never held at the gate, but one who is also
 * the vendor's owner may still record the acceptance, so the vendor's other
 * members are not left waiting (review m-3).
 *
 * The form's `vendorId` is not used for any lookup or write; it only proves
 * the page was showing this session's vendor as 乙方 (another tab may have
 * switched vendors since).
 */
export async function acceptBetaAgreementAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth({ nextPath: BETA_AGREEMENT_PATH });
  const next = betaAgreementReturnPath(formData.get("next"));
  if (auth.suspendedVendor) redirect(VENDOR_SUSPENDED_PATH);
  if (!auth.vendor || !auth.member || !isVendorBackofficeRole(auth.member.role)) redirect(signedInHomePath(auth));
  const back = (error: string) => `${BETA_AGREEMENT_PATH}?error=${error}${next === "/dashboard" ? "" : `&next=${encodeURIComponent(next)}`}`;
  if (!canAcceptBetaAgreement(auth.member)) redirect(auth.isPlatformAdmin ? next : back("owner_required"));
  if (formData.get("vendorId") !== auth.vendor.id) redirect(back("vendor_changed"));
  if (!isCurrentBetaAgreementVersion(formData.get("agreementVersion"))) redirect(back("agreement_updated"));
  if (formData.get("acceptBetaAgreement") !== "on") redirect(back("consent_required"));

  let result: RecordBetaAgreementResult | "not_owner";
  try {
    result = await recordBetaAgreementAcceptance(getDb(), { userId: auth.user.id, vendorId: auth.vendor.id, vendorName: auth.vendor.name });
  } catch (error) {
    // No tenant data in the report: the vendor, account and name stay out of it.
    captureOperationalError(error, { source: "beta-agreement", operation: "record-acceptance" });
    redirect(back("temporarily_unavailable"));
  }
  if (result === "not_owner") redirect(back("owner_required"));
  redirect(next);
}

/**
 * O-11 review m-2: a member held at the gate who also belongs to another
 * vendor moves this session there, like the "商家已暫停" page. Only reachable
 * while the session's vendor is waiting for its owner's acceptance.
 */
export async function switchFromBetaAgreementGateAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireAuth({ nextPath: BETA_AGREEMENT_PATH });
  if (auth.suspendedVendor) redirect(VENDOR_SUSPENDED_PATH);
  if (!auth.vendor || !auth.member || !isVendorBackofficeRole(auth.member.role)) redirect(signedInHomePath(auth));
  if (!await betaAgreementPending(auth, auth.vendor.id)) redirect("/dashboard");
  const vendorId = switchTargetVendorId(formData);
  if (!vendorId || vendorId === auth.vendor.id) redirect(BETA_AGREEMENT_PATH);
  const switched = await switchSessionVendor(auth, vendorId, "beta_agreement_pending");
  // The target may be waiting for its own owner; requireVendorContext sends the session back here then.
  redirect(switched ? "/dashboard" : BETA_AGREEMENT_PATH);
}
