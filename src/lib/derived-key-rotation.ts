import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

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
 * too. The suffixes are not secret; they only had to be unknown while an
 * oracle-bearing build was reachable (production still ran one on 2026-10-25,
 * so production must be redeployed from a build containing #485 first).
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

// Taiwan local midnight, so a date reads the same for operators.
const END_OF_2026_11 = "2026-11-30T16:00:00.000Z";
const END_OF_2026_12 = "2026-12-31T16:00:00.000Z";
const END_OF_2027_10 = "2027-10-31T16:00:00.000Z";

export const DERIVED_KEY_ROTATIONS = Object.freeze({
  // Tier 2: short-lived bearer tokens. No legacy key; old tokens just expire.
  checkoutAdmission: rotation("public-checkout-admission", "public-checkout-admission:r2:9840cc8be0dee028"),
  formSubmissionLineBinding: rotation("form-submission-line-binding", "form-submission-line-binding:r2:23b7ba098c10746d"),
  studentPortalAccessToken: rotation("student-portal-access-token", "student-portal-access-token:r2:5774306767daa6bc"),
  liveViewerPass: rotation("live-viewer-pass", "live-viewer-pass:r2:75b99acaa88645c2"),
  liveChatCursor: rotation("live-chat-cursor", "live-chat-cursor:r2:98430ee0e284cf26"),
  /** Prefix: the private chat cursor purpose appends its JSON scope. */
  livePrivateChatCursor: rotation("live-private-chat-cursor", "live-private-chat-cursor:r2:408078b5f163410f"),
  postPurchaseCheckout: rotation("post-purchase-checkout", "post-purchase-checkout:r2:9fc775dc50019fcd"),
  registrationSubmissionResult: rotation("registration-submission-result", "registration-submission-result:r2:15cdb4621848305d"),

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

/** The legacy purpose when it is still accepted at `now`, otherwise null. */
export function acceptedLegacyPurpose(value: DerivedKeyRotation, now = new Date()) {
  const legacy = value.legacy;
  if (!legacy) return null;
  if (legacy.acceptUntil && !(now.getTime() < legacy.acceptUntil.getTime())) return null;
  return legacy.purpose;
}

const LOG_INTERVAL_MS = 10 * 60_000;
const legacyUseCounts = new Map<string, number>();
const legacyLastLoggedAt = new Map<string, number>();

/**
 * Counts and (at most every ten minutes per label) logs a successful
 * legacy-key verification. Only the fixed label is emitted: never the token,
 * its payload, an identifier or a key.
 */
export function recordLegacyDerivedKeyUse(label: string) {
  const count = (legacyUseCounts.get(label) ?? 0) + 1;
  legacyUseCounts.set(label, count);
  if (process.env.NODE_ENV === "test") return;
  const now = Date.now();
  const last = legacyLastLoggedAt.get(label);
  if (last !== undefined && now - last < LOG_INTERVAL_MS) return;
  legacyLastLoggedAt.set(label, now);
  console.warn("legacy_derived_key_used", { key: label, countSinceStart: count });
}

export function legacyDerivedKeyUseCount(label: string) {
  return legacyUseCounts.get(label) ?? 0;
}

export function resetLegacyDerivedKeyUseCounts() {
  legacyUseCounts.clear();
  legacyLastLoggedAt.clear();
}

function macUnder(purpose: string, message: string) {
  return createHmac("sha256", deriveSensitiveDataKey(purpose)).update(message).digest("base64url");
}

function sameText(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** base64url HMAC-SHA256 under the current key of `value`. */
export function signWithRotation(value: DerivedKeyRotation, message: string) {
  return macUnder(value.current, message);
}

/**
 * Checks `supplied` against the current key, then against the legacy key while
 * it is accepted. Returns which key matched, or null.
 */
export function verifyWithRotation(
  value: DerivedKeyRotation,
  message: string,
  supplied: string,
  now = new Date(),
): DerivedKeyVersion | null {
  if (sameText(macUnder(value.current, message), supplied)) return "current";
  const legacy = acceptedLegacyPurpose(value, now);
  if (legacy && sameText(macUnder(legacy, message), supplied)) {
    recordLegacyDerivedKeyUse(value.label);
    return "legacy";
  }
  return null;
}

/**
 * Every MAC the message may legitimately carry, current key first. For
 * deterministic bearers whose stored form is a hash, so the caller can find
 * which one a stored row was created with.
 */
export function macCandidatesWithRotation(value: DerivedKeyRotation, message: string, now = new Date()) {
  const candidates: Array<{ version: DerivedKeyVersion; mac: string }> = [
    { version: "current", mac: macUnder(value.current, message) },
  ];
  const legacy = acceptedLegacyPurpose(value, now);
  if (legacy) candidates.push({ version: "legacy", mac: macUnder(legacy, message) });
  return candidates;
}

export function encryptWithRotation(plaintext: string, value: DerivedKeyRotation) {
  return encryptSensitiveValue(plaintext, value.current);
}

/**
 * Decrypts a v1 envelope with the current key, falling back to the legacy key
 * while it is accepted. Throws when neither key authenticates the envelope.
 */
export function decryptWithRotation(envelope: string, value: DerivedKeyRotation, now = new Date()) {
  try {
    return { plaintext: decryptSensitiveValue(envelope, value.current), keyVersion: "current" as DerivedKeyVersion };
  } catch (error) {
    const legacy = acceptedLegacyPurpose(value, now);
    if (!legacy) throw error;
    const plaintext = decryptSensitiveValue(envelope, legacy);
    recordLegacyDerivedKeyUse(value.label);
    return { plaintext, keyVersion: "legacy" as DerivedKeyVersion };
  }
}
