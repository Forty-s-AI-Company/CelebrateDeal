import { createHmac, timingSafeEqual } from "node:crypto";
import { DERIVED_KEY_ROTATIONS, type DerivedKeyRotation, type DerivedKeyVersion, type LegacyDerivedKey } from "@/lib/derived-key-purposes";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

// The registry lives in derived-key-purposes.ts (no imports) so that
// sensitive-data.ts can read the CSRF purpose from it without a cycle.
export { DERIVED_KEY_ROTATIONS };
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
