"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestAuditMeta } from "@/lib/audit";
import { requireVendorOwnerFinance } from "@/lib/auth";
import { loadRuntimeBankAccountKeyring } from "@/lib/bank-account";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import {
  parseVendorPayoutAccountForm,
  saveVendorPayoutAccount,
  VendorPayoutAccountAmbiguousError,
} from "@/lib/vendor-payout-account";

const PAYOUTS_PATH = "/billing/payouts";

function resultPath(code: string) {
  return `${PAYOUTS_PATH}?payoutAccount=${encodeURIComponent(code)}`;
}

/**
 * Owner-only: sets the bank account the platform pays this vendor's
 * settlements into. The vendor is always the session's vendor; any vendorId
 * or account id in the form is ignored.
 */
export async function saveVendorPayoutAccountAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor } = await requireVendorOwnerFinance(PAYOUTS_PATH);
  // Redirecting payouts is the main goal of an account takeover, so the owner
  // must have a confirmed second factor (requireAuth already forces it to be
  // verified for this session once enrolled).
  if (!user.mfaFactor) {
    redirect(`/mfa/setup?next=${encodeURIComponent(PAYOUTS_PATH)}`);
  }

  const parsed = parseVendorPayoutAccountForm(formData);
  if (!parsed.ok) redirect(resultPath(parsed.error));

  let keyring;
  try {
    keyring = loadRuntimeBankAccountKeyring();
  } catch {
    redirect(resultPath("encryption_unavailable"));
  }

  let outcome = "saved";
  try {
    await saveVendorPayoutAccount(getDb(), {
      vendorId: vendor.id,
      actorUserId: user.id,
      actorLabel: user.email ?? null,
      details: parsed.details,
      keyring,
      auditMeta: await requestAuditMeta(),
    });
  } catch (error) {
    outcome = error instanceof VendorPayoutAccountAmbiguousError ? "multiple_accounts" : "save_failed";
  }

  revalidatePath(PAYOUTS_PATH);
  redirect(resultPath(outcome));
}
