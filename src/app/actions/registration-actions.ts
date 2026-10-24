"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AUTH_COOKIE, LEGACY_VENDOR_COOKIE, createUserSession, sessionCookieOptions } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { hashPasswordAsync } from "@/lib/password";
import { PASSWORD_INPUT_LIMIT, validateNewPassword } from "@/lib/password-policy";
import { merchantRegistrationPolicyVersions } from "@/lib/public-policy-content";
import { checkRateLimit } from "@/lib/rate-limit";
import { merchantRegistrationInviteMatchesEmail, verifyMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
import { isMerchantRegistrationInviteRevoked } from "@/lib/merchant-registration-invite-records";
import { registrationMode } from "@/lib/registration-mode";

const RegistrationInput = z.object({
  name: z.string().trim().min(2).max(120),
  workspaceName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  // Match the existing login action, which trims submitted passwords. Length
  // and commonness are the password policy's job; this only bounds the input.
  password: z.string().max(PASSWORD_INPUT_LIMIT).transform((value) => value.trim()),
});

/**
 * Create the original self-service workspace flow using current security boundaries.
 *
 * In `invite` mode (the closed-beta default) the form must carry a valid
 * platform invitation for the submitted email; the token is re-verified here
 * and never trusted from the page. Without one nothing is written.
 */
/**
 * The submitted invitation, re-verified on the server. In invite mode a
 * missing, invalid or revoked token ends the request before anything else.
 */
async function resolveRegistrationInvite(formData: FormData) {
  const inviteOnly = registrationMode() === "invite";
  const inviteToken = formData.get("invite");
  const verified = verifyMerchantRegistrationInvite(inviteToken);
  if (inviteOnly && !verified) redirect("/register?error=invite_required");
  // A platform admin may have revoked a still-valid token (one indexed audit lookup).
  const invite = verified && !await isMerchantRegistrationInviteRevoked(verified.jti) ? verified : null;
  if (inviteOnly && !invite) redirect("/register?error=invite_revoked");
  // Errors keep a usable invitation in the URL so the invited person can retry.
  const retryQuery = invite && typeof inviteToken === "string" ? `&invite=${encodeURIComponent(inviteToken)}` : "";
  return { inviteOnly, invite, retryQuery };
}

class InviteRevokedError extends Error {}

/** Re-checked inside the provisioning transaction, right before any insert. */
async function assertInviteNotRevoked(invite: { jti: string } | null, tx: Parameters<typeof isMerchantRegistrationInviteRevoked>[1]) {
  if (!invite || await isMerchantRegistrationInviteRevoked(invite.jti, tx)) throw new InviteRevokedError();
}

function transactionFailurePath(error: unknown, failure: (error: string) => string) {
  if (error instanceof InviteRevokedError) return "/register?error=invite_revoked";
  const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  return failure(duplicate ? "exists" : "temporarily_unavailable");
}

export async function registerAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { inviteOnly, invite, retryQuery } = await resolveRegistrationInvite(formData);
  const failure = (error: string) => `/register?error=${error}${retryQuery}`;
  // F-114: the merchant must accept the terms and privacy policy. The stored
  // versions are the server's current ones; the form echoes the version it
  // displayed so a stale page cannot record consent to a newer text.
  const policyVersions = merchantRegistrationPolicyVersions();
  if (formData.get("acceptPolicies") !== "on") redirect(failure("consent_required"));
  if (formData.get("policyVersion") !== policyVersions.consentVersion) redirect(failure("policy_updated"));
  const parsed = RegistrationInput.safeParse({ name: formData.get("name"), workspaceName: formData.get("workspaceName"), email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) redirect(failure("invalid"));
  const input = parsed.data;
  // The page shows the invited address read-only; any other address is a tampered form.
  const inviteMatches = invite ? merchantRegistrationInviteMatchesEmail(invite, input.email) : false;
  if (inviteOnly && !inviteMatches) redirect(failure("invite_mismatch"));
  // Recorded whenever a valid, unrevoked invitation for this email was used, whatever the mode.
  const usedInvite = invite && inviteMatches ? invite : null;
  const passwordPolicy = validateNewPassword(input.password, { email: input.email });
  // Length failures keep the existing "invalid" copy, which states the minimum.
  if (!passwordPolicy.ok) redirect(failure(passwordPolicy.reason === "short" || passwordPolicy.reason === "long" ? "invalid" : passwordPolicy.reason));
  const incoming = await headers();
  const forwarded = new Headers();
  for (const name of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  const limited = await checkRateLimit(new Request(getCanonicalAppUrl(), { headers: forwarded }), "registration-source", 4, 15 * 60 * 1000);
  if (limited) redirect(failure(limited.status === 429 ? "rate_limited" : "temporarily_unavailable"));
  const passwordHash = await hashPasswordAsync(input.password);
  const slugBase = input.workspaceName.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "workspace";
  let created: { userId: string; vendorId: string };
  try {
    // Ownership, onboarding state and audit become visible together or roll back together.
    created = await getDb().$transaction(async (tx) => {
      // Narrows (does not close) the window between the first check and a revocation.
      if (inviteOnly) await assertInviteNotRevoked(usedInvite, tx);
      const user = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } });
      const vendor = await tx.vendor.create({ data: { name: input.workspaceName, slug: `${slugBase}-${randomUUID()}`, email: input.email, passwordHash } });
      await tx.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: "owner", status: "active" } });
      await tx.userOnboardingPreference.create({ data: { userId: user.id, vendorId: vendor.id, questionnaireStep: 0, taskPanelCollapsed: true } });
      await tx.userPolicyConsent.create({ data: { userId: user.id, vendorId: vendor.id, context: "merchant_registration", termsVersion: policyVersions.termsVersion, privacyVersion: policyVersions.privacyVersion } });
      await tx.auditLog.create({ data: { vendorId: vendor.id, actorId: user.id, actorLabel: "owner", action: "registration_completed", targetType: "User", targetId: user.id,
        after: { policyConsent: { termsVersion: policyVersions.termsVersion, privacyVersion: policyVersions.privacyVersion }, ...(usedInvite ? { registrationInvite: { jti: usedInvite.jti } } : {}) } } });
      return { userId: user.id, vendorId: vendor.id };
    });
  } catch (error) {
    redirect(transactionFailurePath(error, failure));
  }
  try {
    const session = await createUserSession({ ...created, ipAddress: incoming.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: incoming.get("user-agent") });
    const store = await cookies();
    store.set(AUTH_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
    store.delete(LEGACY_VENDOR_COOKIE);
  } catch {
    // Provisioning has committed: offer login recovery instead of asking for another signup.
    redirect("/login?registered=1");
  }
  redirect("/welcome");
}
