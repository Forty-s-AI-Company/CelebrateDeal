"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { requestAuditMeta, writeAuditLog } from "@/lib/audit";
import { requireVendorOwnerFinance } from "@/lib/auth";
import { loadRuntimeBankAccountKeyring } from "@/lib/bank-account";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { decryptMfaSecret, verifyTotpCode } from "@/lib/mfa";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAccountRateLimit } from "@/lib/account-rate-limit";
import {
  parseVendorPayoutAccountForm,
  saveVendorPayoutAccount,
  VendorPayoutAccountAmbiguousError,
} from "@/lib/vendor-payout-account";
import { notifyOwnersOfPayoutAccountChange } from "@/lib/vendor-payout-account-notification";

const PAYOUTS_PATH = "/billing/payouts";
const STEP_UP_LIMIT = 5;
const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

function resultPath(code: string) {
  return `${PAYOUTS_PATH}?payoutAccount=${encodeURIComponent(code)}`;
}

function forwardedRequestHeaders(headerStore: Awaited<ReturnType<typeof headers>>) {
  const forwarded = new Headers();
  for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "user-agent"]) {
    const value = headerStore.get(name);
    if (value) forwarded.set(name, value);
  }
  return forwarded;
}

/**
 * Owner-only: sets the bank account the platform pays this vendor's
 * settlements into. The vendor is always the session's vendor; any vendorId
 * or account id in the form is ignored.
 *
 * Redirecting payouts is the main goal of an account takeover, so a valid
 * session is not enough: the owner must type a current TOTP code (step-up,
 * same verifier as /mfa/verify; recovery codes are not accepted here), the new
 * account waits 24 hours in `pending_verification` before any payout batch can
 * use it, and every owner is e-mailed about the change.
 */
export async function saveVendorPayoutAccountAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { user, vendor, member } = await requireVendorOwnerFinance(PAYOUTS_PATH);
  if (!user.mfaFactor) {
    redirect(`/mfa/setup?next=${encodeURIComponent(PAYOUTS_PATH)}`);
  }

  const headerStore = await headers();
  const rateLimited = await checkRateLimit(
    new Request(getCanonicalAppUrl(), { headers: forwardedRequestHeaders(headerStore) }),
    `payout-account-step-up:${user.id}`,
    STEP_UP_LIMIT,
    STEP_UP_WINDOW_MS,
  ) ?? await checkAccountRateLimit("payout_account_step_up", user.id);
  if (rateLimited) redirect(resultPath(rateLimited.status === 429 ? "step_up_rate_limited" : "step_up_unavailable"));

  const totpCode = formData.get("totpCode");
  const secret = decryptMfaSecret(user.mfaFactor.secretEncrypted);
  if (typeof totpCode !== "string" || !verifyTotpCode(secret, totpCode)) {
    await writeAuditLog({
      vendorId: vendor.id,
      actorId: user.id,
      actorLabel: member.role,
      action: "vendor_payout_account_step_up_failed",
      targetType: "PaymentAccount",
    });
    redirect(resultPath("step_up_failed"));
  }

  const parsed = parseVendorPayoutAccountForm(formData);
  if (!parsed.ok) redirect(resultPath(parsed.error));

  let keyring;
  try {
    keyring = loadRuntimeBankAccountKeyring();
  } catch {
    redirect(resultPath("encryption_unavailable"));
  }

  let saved;
  try {
    saved = await saveVendorPayoutAccount(getDb(), {
      vendorId: vendor.id,
      actorUserId: user.id,
      actorLabel: user.email ?? null,
      details: parsed.details,
      keyring,
      auditMeta: await requestAuditMeta(),
    });
  } catch (error) {
    redirect(resultPath(error instanceof VendorPayoutAccountAmbiguousError ? "multiple_accounts" : "save_failed"));
  }

  const notified = await notifyOwnersOfPayoutAccountChange(getDb(), {
    vendorId: vendor.id,
    vendorName: vendor.name,
    accountId: saved.accountId,
    accountNumberLast4: saved.accountNumberLast4,
    changedAt: saved.changedAt,
    payoutEligibleAt: saved.payoutEligibleAt,
  });

  revalidatePath(PAYOUTS_PATH);
  redirect(resultPath(notified ? "saved" : "saved_notification_failed"));
}
