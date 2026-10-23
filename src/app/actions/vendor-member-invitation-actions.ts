"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getCurrentAuth } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { hashPasswordAsync } from "@/lib/password";
import { passwordPolicyErrorCode, validateNewPassword } from "@/lib/password-policy";
import { merchantRegistrationPolicyVersions } from "@/lib/public-policy-content";
import { checkRateLimit } from "@/lib/rate-limit";
import { acceptVendorMemberInvitation, findPendingVendorMemberInvitation } from "@/lib/vendor-member-invitation";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function acceptPath(token: string, error: string) {
  return `/invitations/accept?token=${encodeURIComponent(token)}&error=${encodeURIComponent(error)}`;
}

/**
 * F-029 / B02-06: the only path that turns an invitation into a membership.
 * The invited address decides the account: an existing account must be the
 * signed-in (and, if enrolled, MFA-verified) session; otherwise a new account
 * is created with the password and policy consent given here. The vendor,
 * role and address come from the stored invitation, never from the form.
 */
export async function acceptVendorMemberInvitationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const token = text(formData, "token");
  if (!token || token.length > 256) redirect("/invitations/accept?error=invalid");

  const incoming = await headers();
  const forwarded = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const limited = await checkRateLimit(new Request(getCanonicalAppUrl(), { headers: forwarded }), "vendor-member-invitation-accept", 10, 15 * 60 * 1000);
  if (limited) redirect(acceptPath(token, limited.status === 429 ? "rate_limited" : "temporarily_unavailable"));

  // Reject unknown tokens before any password hashing work (#462 n11).
  const invitation = await findPendingVendorMemberInvitation(getDb(), token);
  if (!invitation) redirect(acceptPath(token, "invalid"));

  // getCurrentAuth returns null for a session whose enrolled factor is not yet verified.
  const auth = await getCurrentAuth();
  let newAccount: Parameters<typeof acceptVendorMemberInvitation>[1]["newAccount"] = null;
  if (!auth) {
    const password = text(formData, "password");
    if (password) {
      const policy = merchantRegistrationPolicyVersions();
      const passwordPolicy = validateNewPassword(password, { email: invitation.email });
      if (!passwordPolicy.ok) redirect(acceptPath(token, passwordPolicyErrorCode(passwordPolicy)));
      if (password !== text(formData, "confirmPassword")) redirect(acceptPath(token, "mismatch"));
      if (formData.get("acceptPolicies") !== "on") redirect(acceptPath(token, "consent_required"));
      if (formData.get("policyVersion") !== policy.consentVersion) redirect(acceptPath(token, "policy_updated"));
      newAccount = {
        passwordHash: await hashPasswordAsync(password),
        name: text(formData, "name").slice(0, 120),
        termsVersion: policy.termsVersion,
        privacyVersion: policy.privacyVersion,
      };
    }
  }

  const result = await acceptVendorMemberInvitation(getDb(), { token, actorUserId: auth?.user.id ?? null, newAccount });
  if (!result.ok) redirect(acceptPath(token, result.reason));
  redirect(result.createdAccount ? "/login?invited=1" : "/dashboard");
}
