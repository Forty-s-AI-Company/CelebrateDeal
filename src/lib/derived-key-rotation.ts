import { createHmac, timingSafeEqual } from "node:crypto";
import {
  DERIVED_KEY_ROTATIONS,
  ROTATION_EFFECTIVE_AT,
  expiryFitsPreRotationIssue,
  issuedBeforeRotation,
  type DerivedKeyRotation,
  type DerivedKeyVersion,
  type LegacyDerivedKey,
} from "@/lib/derived-key-purposes";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

// The registry lives in derived-key-purposes.ts (no imports) so that
// sensitive-data.ts can read the CSRF purpose from it without a cycle.
export { DERIVED_KEY_ROTATIONS, ROTATION_EFFECTIVE_AT, expiryFitsPreRotationIssue, issuedBeforeRotation };
export type { DerivedKeyRotation, DerivedKeyVersion, LegacyDerivedKey };

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
 * it is accepted. `legacyIssuedBeforeRotation` is evaluated only after the
 * legacy MAC matched (so the payload it reads is authentic); it must return
 * true only for a token issued before ROTATION_EFFECTIVE_AT. Omit it only for
 * tokens without timestamps, which then rely on the hard stop alone.
 * Returns which key matched, or null.
 */
export function verifyWithRotation(
  value: DerivedKeyRotation,
  message: string,
  supplied: string,
  now = new Date(),
  legacyIssuedBeforeRotation?: () => boolean,
): DerivedKeyVersion | null {
  if (sameText(macUnder(value.current, message), supplied)) return "current";
  const legacy = acceptedLegacyPurpose(value, now);
  if (legacy && sameText(macUnder(legacy, message), supplied)) {
    if (legacyIssuedBeforeRotation && !legacyIssuedBeforeRotation()) return null;
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
 * while it is accepted. `legacyIssuedBeforeRotation` receives the authentic
 * legacy plaintext and must return true only when it was issued before
 * ROTATION_EFFECTIVE_AT. Throws when no accepted key authenticates the envelope.
 */
export function decryptWithRotation(
  envelope: string,
  value: DerivedKeyRotation,
  now = new Date(),
  legacyIssuedBeforeRotation?: (plaintext: string) => boolean,
) {
  try {
    return { plaintext: decryptSensitiveValue(envelope, value.current), keyVersion: "current" as DerivedKeyVersion };
  } catch (error) {
    const legacy = acceptedLegacyPurpose(value, now);
    if (!legacy) throw error;
    const plaintext = decryptSensitiveValue(envelope, legacy);
    if (legacyIssuedBeforeRotation && !legacyIssuedBeforeRotation(plaintext)) {
      throw new Error("Legacy-key envelope was issued after the rotation.");
    }
    recordLegacyDerivedKeyUse(value.label);
    return { plaintext, keyVersion: "legacy" as DerivedKeyVersion };
  }
}
