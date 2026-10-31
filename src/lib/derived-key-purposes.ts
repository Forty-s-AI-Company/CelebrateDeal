/**
 * Per-purpose rotation of derived keys (B04-03, docs/staging-production-env-vars.md §7).
 *
 * Before #485 the CSRF fingerprint let anyone read the first 192 bits of any
 * derived key from a public page, and that exposure leaves no trace. Every
 * purpose used before the fix is therefore treated as possibly compromised and
 * moves to a new purpose name. The root key itself is never rotated for this.
 *
 * New purpose names carry a random suffix: the old oracle answered for any
 * string, so a guessable successor (such as "-v2") could have been queried
 * too. The suffixes are not secret (the repository is public). Invariant: no
 * publicly reachable deployment may run pre-#485 code once a new name is
 * pushed; old deployments stay behind Vercel Authentication and are never
 * re-aliased publicly. Production also rotates its root secret before it
 * serves anyone (docs/staging-production-env-vars.md §7 point 7).
 *
 * Retiring a legacy key: delete the `legacy` entry of that rotation (set it to
 * null). `acceptUntil` is a hard stop that refuses the legacy key after that
 * instant even if nobody deletes it; `null` is only for keys that protect
 * data at rest and are retired after their re-encryption run completes.
 */

export type LegacyDerivedKey = {
  readonly purpose: string;
  readonly acceptUntil: Date | null;
};

export type DerivedKeyRotation = {
  /** Non-sensitive name for logs and counters. */
  readonly label: string;
  readonly current: string;
  readonly legacy: LegacyDerivedKey | null;
};

export type DerivedKeyVersion = "current" | "legacy";

function rotation(label: string, current: string, legacy: LegacyDerivedKey | null = null): DerivedKeyRotation {
  return Object.freeze({ label, current, legacy: legacy ? Object.freeze(legacy) : null });
}

function legacyUntil(purpose: string, acceptUntilIso: string | null): LegacyDerivedKey {
  return { purpose, acceptUntil: acceptUntilIso === null ? null : new Date(acceptUntilIso) };
}

/**
 * When the rotated names take effect: 2026-10-27 00:00 Taiwan time, leaving a
 * buffer for merge, CI and the staging re-alias. The staging alias must switch
 * to this build BEFORE this instant; otherwise move the constant later before
 * deploying (the old build keeps signing with the old key until the switch). A legacy-key token whose payload shows it was
 * issued after this instant cannot be legitimate (the server no longer signed
 * with the old key), so tier 3 readers refuse it even inside the hard-stop
 * window. Tokens without timestamps rely on the hard stop alone.
 */
export const ROTATION_EFFECTIVE_AT = new Date("2026-10-26T16:00:00.000Z");

/** True when a legacy-key payload was issued before the rotation took effect. */
export function issuedBeforeRotation(issuedAtMs: number) {
  return Number.isFinite(issuedAtMs) && issuedAtMs < ROTATION_EFFECTIVE_AT.getTime();
}

/**
 * For payloads that carry only an expiry: a token issued before the rotation
 * expires no later than the rotation instant plus its maximum lifetime.
 */
export function expiryFitsPreRotationIssue(expiresAtMs: number, maxLifetimeMs: number) {
  return Number.isFinite(expiresAtMs) && expiresAtMs <= ROTATION_EFFECTIVE_AT.getTime() + maxLifetimeMs;
}

// Taiwan local midnight, so a date reads the same for operators.
const END_OF_2026_11 = "2026-11-30T16:00:00.000Z";
const END_OF_2026_12 = "2026-12-31T16:00:00.000Z";
const END_OF_2027_10 = "2027-10-31T16:00:00.000Z";

export const DERIVED_KEY_ROTATIONS = Object.freeze({
  // Tier 1 and 2: unused or short-lived purposes. No legacy key; old tokens just expire.
  /** CSRF MAC key (read only by sensitive-data.ts for csrf.ts). CSRF tokens live at most two hours. */
  csrfMac: rotation("csrf-hmac", "csrf-hmac:r2:db862e72a7b9a462"),
  /** Merchant registration invites; none had been issued when this was rotated. */
  merchantRegistrationInvite: rotation("merchant-registration-invite", "merchant-registration-invite:r2:9ecb5a622edbf327"),
  /** Merchant email verification links; introduced after #485 under this name only, so no legacy key. */
  merchantEmailVerification: rotation("merchant-email-verification", "merchant-email-verification:r2:5a881e5879ba6156"),
  /** Login email change links (sent to the new address); introduced after #485 under this name only, so no legacy key. */
  accountEmailChange: rotation("account-email-change", "account-email-change:r2:a8a788e3ba38de72"),
  /** "Not me, restore my email" links (sent to the previous address); introduced after #485 under this name only, so no legacy key. */
  accountEmailRevert: rotation("account-email-revert", "account-email-revert:r2:f58ffa8c7c2f1eeb"),
  /** Keyed e-mail hash in invitation audit entries; nothing compares it yet. */
  merchantInviteEmailHash: rotation("merchant-invite-email", "merchant-invite-email:r2:bcaa6cb59eb97af3"),
  checkoutAdmission: rotation("public-checkout-admission", "public-checkout-admission:r2:9840cc8be0dee028"),
  formSubmissionLineBinding: rotation("form-submission-line-binding", "form-submission-line-binding:r2:23b7ba098c10746d"),
  studentPortalAccessToken: rotation("student-portal-access-token", "student-portal-access-token:r2:5774306767daa6bc"),
  liveViewerPass: rotation("live-viewer-pass", "live-viewer-pass:r2:75b99acaa88645c2"),
  liveChatCursor: rotation("live-chat-cursor", "live-chat-cursor:r2:98430ee0e284cf26"),
  /** Prefix: the private chat cursor purpose appends its JSON scope. */
  livePrivateChatCursor: rotation("live-private-chat-cursor", "live-private-chat-cursor:r2:408078b5f163410f"),
  /** Draft/retry binding of a private chat conversation; grants no access. */
  livePrivateChatConversationBinding: rotation(
    "live-private-chat-conversation-binding",
    "live-private-chat-conversation-binding:r2:93e8e3400ce0da2b",
  ),
  postPurchaseCheckout: rotation("post-purchase-checkout", "post-purchase-checkout:r2:9fc775dc50019fcd"),
  registrationSubmissionResult: rotation("registration-submission-result", "registration-submission-result:r2:15cdb4621848305d"),
  /**
   * Evergreen webinar per-visitor session cookie; introduced after #485 under
   * this name only, so no legacy key. A lost or refused cookie only assigns the
   * visitor the session a new visitor would get at that moment.
   */
  evergreenViewerSession: rotation("evergreen-viewer-session", "evergreen-viewer-session:r2:755cb80211ac7475"),
  /**
   * HttpOnly 30-minute cookie naming the fixed session (指定場次) the server
   * confirmed for this browser's last registration; read only by the funnel
   * thank-you page. New purpose, so no legacy key.
   */
  liveSessionResult: rotation("live-session-result", "live-session-result:r2:e2e6952d7d8950cb"),
  /**
   * 「更換場次」 links in the already-registered notice (指定場次): 24 hours,
   * single use (LiveSessionSwitchRedemption). New purpose, so no legacy key.
   */
  liveSessionSwitch: rotation("live-session-switch", "live-session-switch:r2:fb3e6e707aa6bd7b"),

  // Tier 3: long-lived links and cookies. New key signs; legacy still verifies.
  emailUnsubscribe: rotation(
    "email-delivery-unsubscribe",
    "email-delivery-unsubscribe:r2:fba6e90ffca21a4b",
    legacyUntil("email-delivery-unsubscribe", END_OF_2027_10),
  ),
  formSubmissionEmailVerification: rotation(
    "form-submission-email-verification",
    "form-submission-email-verification:r2:e395f0f75e344e9c",
    legacyUntil("form-submission-email-verification", END_OF_2026_11),
  ),
  formSubmissionChatSession: rotation(
    "form-submission-chat-session",
    "form-submission-chat-session:r2:070a4f7ffaff8f24",
    legacyUntil("form-submission-chat-session", END_OF_2026_12),
  ),
  teamFunnelAttributionCookie: rotation(
    "team-funnel-attribution-cookie",
    "team-funnel-attribution-cookie:r2:e4c8b499bd4d6282",
    legacyUntil("team-funnel-attribution-cookie", END_OF_2026_12),
  ),
  automationVoucherBearer: rotation(
    "automation-voucher-bearer",
    "automation-voucher-bearer:r2:b11cbe79110dc467",
    legacyUntil("automation-voucher-bearer-v1", END_OF_2026_12),
  ),
  studentPortalSession: rotation(
    "student-portal-session",
    "student-portal-session:r2:710e5987327ae525",
    legacyUntil("student-portal-session-v1", END_OF_2026_11),
  ),
  cloudflareUploadTicket: rotation(
    "cloudflare-resumable-upload-ticket",
    "cloudflare-resumable-upload-ticket:r2:615079db018ccd08",
    legacyUntil("cloudflare-resumable-upload-ticket", END_OF_2026_11),
  ),

  // Tier 4: data at rest. Legacy stays until the re-encryption run completes.
  mfaEncryption: rotation(
    "mfa-encryption",
    "mfa-encryption:r2:69a113bdb66c7a1e",
    legacyUntil("mfa-encryption", null),
  ),
  mfaRecoveryCode: rotation(
    "mfa-recovery-code",
    "mfa-recovery-code-authentication:r2:0d054e31e6b4e6a2",
    legacyUntil("mfa-recovery-code-authentication", null),
  ),
} satisfies Record<string, DerivedKeyRotation>);
