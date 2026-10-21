import { redirect } from "next/navigation";
import { withMfaReturnPath } from "@/lib/mfa-return-path";

/**
 * Step-up window for high-risk merchant operations (F-027 / B02-04, owner
 * decision D-29). Sign-in does not force merchants to enrol MFA during the
 * closed beta, but binding a card, charging a plan, managing members,
 * approving payee bank data, saving LINE/Meta credentials and exporting
 * personal data all require a confirmed factor verified within this window.
 */
export const STEP_UP_MFA_MAX_AGE_MINUTES = 15;

// Sessions are stamped by the application clock; tolerate a small skew between
// instances but never treat a far-future stamp as fresh.
const FUTURE_CLOCK_SKEW_MS = 60_000;

export type RecentMfaActor = {
  user: { mfaFactor?: unknown };
  session?: { mfaVerifiedAt?: Date | null } | null;
};

export type RecentMfaStatus = "verified" | "setup_required" | "verification_required";

export type RecentMfaOptions = {
  maxAgeMinutes?: number;
  now?: Date;
};

function maxAgeMs(maxAgeMinutes: number) {
  if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) {
    throw new Error("recent MFA window must be a positive number of minutes");
  }
  return maxAgeMinutes * 60_000;
}

/** Pure decision used by guards and by pages that render the step-up hint. */
export function recentMfaStatus(actor: RecentMfaActor, options: RecentMfaOptions = {}): RecentMfaStatus {
  const windowMs = maxAgeMs(options.maxAgeMinutes ?? STEP_UP_MFA_MAX_AGE_MINUTES);
  // Fail closed if a caller passes an incomplete actor.
  if (!actor?.user?.mfaFactor) return "setup_required";
  const verifiedAt = actor.session?.mfaVerifiedAt;
  if (!(verifiedAt instanceof Date) || Number.isNaN(verifiedAt.getTime())) return "verification_required";
  const ageMs = (options.now ?? new Date()).getTime() - verifiedAt.getTime();
  if (ageMs < -FUTURE_CLOCK_SKEW_MS || ageMs > windowMs) return "verification_required";
  return "verified";
}

/** Where the user completes the missing step before returning to `nextPath`. */
export function recentMfaRedirectPath(status: Exclude<RecentMfaStatus, "verified">, nextPath: string) {
  return status === "setup_required"
    ? withMfaReturnPath("/mfa/setup?reason=step_up", nextPath)
    : withMfaReturnPath("/mfa/verify?reason=step_up", nextPath);
}

/**
 * Server-side step-up guard. Call after the role guard and before reading any
 * input or touching the database. A user without a factor is sent to setup; a
 * user whose last verification is older than the window re-verifies at
 * /mfa/verify, which refreshes the session's `mfaVerifiedAt`.
 */
export function requireRecentMfa(
  actor: RecentMfaActor,
  options: RecentMfaOptions & { nextPath: string },
): void {
  const status = recentMfaStatus(actor, options);
  if (status !== "verified") redirect(recentMfaRedirectPath(status, options.nextPath));
}
