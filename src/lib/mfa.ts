import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  verifyPassword,
  verifyPasswordAsync,
} from "@/lib/password";
import { DERIVED_KEY_ROTATIONS, acceptedLegacyPurpose, recordLegacyDerivedKeyUse } from "@/lib/derived-key-rotation";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_CODE_BYTES = 10;
// Rotated after #485 (tier 4). New hashes are v2 under the new key; v1 hashes
// still verify under the legacy key. Codes are single-use, so a v1 hash leaves
// the system when its code is used or the user regenerates the set.
const RECOVERY_CODE_HASH_VERSION = "hmac-sha256-v2";
const LEGACY_RECOVERY_CODE_HASH_VERSION = "hmac-sha256-v1";
const RECOVERY_CODE_KEY = DERIVED_KEY_ROTATIONS.mfaRecoveryCode;
// Rotated after #485 (tier 4). Ciphertext written now is "m2.<iv>.<tag>.<data>"
// under the new key. The legacy "<iv>.<tag>.<data>" form (old key) is still
// read for stored MFA secrets until scripts/reencrypt-mfa-secrets.ts has run
// everywhere; the 15-minute setup and recovery-code cookies accept only m2.
const MFA_CIPHERTEXT_VERSION = "m2";
const MFA_ENCRYPTION_KEY = DERIVED_KEY_ROTATIONS.mfaEncryption;

export const MFA_SETUP_COOKIE = "celebrate_mfa_setup";
export const MFA_RECOVERY_COOKIE = "celebrate_mfa_recovery";

function base32Encode(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string) {
  const normalized = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error("Invalid base32 secret.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function encryptText(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveSensitiveDataKey(MFA_ENCRYPTION_KEY.current), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${MFA_CIPHERTEXT_VERSION}.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptParts(key: Buffer, ivPart: string, tagPart: string, encryptedPart: string) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function decryptText(value: string, options: { allowLegacy: boolean }) {
  const parts = value.split(".");
  if (parts.length === 4 && parts[0] === MFA_CIPHERTEXT_VERSION && parts[1] && parts[2] && parts[3]) {
    return decryptParts(deriveSensitiveDataKey(MFA_ENCRYPTION_KEY.current), parts[1], parts[2], parts[3]);
  }
  const legacyPurpose = options.allowLegacy ? acceptedLegacyPurpose(MFA_ENCRYPTION_KEY) : null;
  if (legacyPurpose && parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const plaintext = decryptParts(deriveSensitiveDataKey(legacyPurpose), parts[0], parts[1], parts[2]);
    recordLegacyDerivedKeyUse(MFA_ENCRYPTION_KEY.label);
    return plaintext;
  }
  throw new Error("Invalid encrypted MFA payload.");
}

function totpCounter(timestamp = Date.now()) {
  return Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
}

function hotp(secret: string, counter: number) {
  const secretBytes = base32Decode(secret);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secretBytes).update(counterBytes).digest();
  const offset = digest.readUInt8(digest.length - 1) & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

export function totpCodeForTimestamp(secret: string, timestamp = Date.now()) {
  return hotp(secret, totpCounter(timestamp));
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeCode(code: string) {
  return code.replace(/\s+/g, "").replace(/-/g, "").trim();
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function encryptMfaSecret(secret: string) {
  return encryptText(secret);
}

/** Reads a stored MFA secret in either the current or the legacy format. */
export function decryptMfaSecret(secretEncrypted: string) {
  return decryptText(secretEncrypted, { allowLegacy: true });
}

/** True for a stored secret that is not yet in the current (m2) format. */
export function mfaSecretNeedsReencryption(secretEncrypted: string) {
  return !secretEncrypted.startsWith(`${MFA_CIPHERTEXT_VERSION}.`);
}

/**
 * Re-encrypts a stored secret under the current key. The result is checked to
 * decrypt back to the same secret before it is returned.
 */
export function reencryptMfaSecret(secretEncrypted: string) {
  const secret = decryptMfaSecret(secretEncrypted);
  const next = encryptText(secret);
  if (decryptText(next, { allowLegacy: false }) !== secret) throw new Error("MFA re-encryption check failed.");
  return next;
}

export function generateTotpUri({ email, secret }: { email: string; secret: string }) {
  return `otpauth://totp/${encodeURIComponent(`CelebrateDeal:${email}`)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent("CelebrateDeal")}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function verifyTotpCode(secret: string, code: string, timestamp = Date.now()) {
  const normalized = normalizeCode(code);
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  const currentCounter = totpCounter(timestamp);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    if (safeEqual(hotp(secret, currentCounter + offset), normalized)) {
      return true;
    }
  }

  return false;
}

function rawRecoveryCode() {
  const encoded = randomBytes(RECOVERY_CODE_BYTES).toString("hex").toUpperCase();
  return encoded.match(/.{5}/g)?.join("-") ?? encoded;
}

export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => rawRecoveryCode());
}

function recoveryCodeDigest(code: string, purpose: string) {
  return createHmac("sha256", deriveSensitiveDataKey(purpose))
    .update(normalizeCode(code))
    .digest();
}

/**
 * The digest and the key purpose it was made with, or null for a hash that is
 * not an HMAC hash (the older password-hash format). `purpose` is null for a
 * v1 hash once the legacy key is retired, which then fails closed.
 */
function parseRecoveryCodeDigest(codeHash: string) {
  const [version, encodedDigest, unexpected] = codeHash.split(":");
  const purpose = version === RECOVERY_CODE_HASH_VERSION
    ? RECOVERY_CODE_KEY.current
    : version === LEGACY_RECOVERY_CODE_HASH_VERSION ? acceptedLegacyPurpose(RECOVERY_CODE_KEY) : undefined;
  if (purpose === undefined || !encodedDigest || unexpected) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedDigest)) return null;
  const digest = Buffer.from(encodedDigest, "base64url");
  return digest.length === 32 ? { digest, purpose } : null;
}

function matchesRecoveryCodeDigest(code: string, parsed: { digest: Buffer; purpose: string | null }) {
  if (!parsed.purpose) return false;
  const matches = timingSafeEqual(parsed.digest, recoveryCodeDigest(code, parsed.purpose));
  if (matches && parsed.purpose !== RECOVERY_CODE_KEY.current) recordLegacyDerivedKeyUse(RECOVERY_CODE_KEY.label);
  return matches;
}

export function hashRecoveryCode(code: string) {
  return `${RECOVERY_CODE_HASH_VERSION}:${recoveryCodeDigest(code, RECOVERY_CODE_KEY.current).toString("base64url")}`;
}

export function verifyRecoveryCode(code: string, codeHash: string) {
  const parsed = parseRecoveryCodeDigest(codeHash);
  if (!parsed) return verifyPassword(normalizeCode(code), codeHash);
  return matchesRecoveryCodeDigest(code, parsed);
}

export async function hashRecoveryCodeAsync(code: string) {
  return hashRecoveryCode(code);
}

export async function verifyRecoveryCodeAsync(code: string, codeHash: string) {
  const parsed = parseRecoveryCodeDigest(codeHash);
  if (!parsed) return verifyPasswordAsync(normalizeCode(code), codeHash);
  return matchesRecoveryCodeDigest(code, parsed);
}

export function serializePendingMfaSetup(secret: string, userId: string) {
  return encryptText(JSON.stringify({ secret, userId, createdAt: Date.now() }));
}

export function parsePendingMfaSetup(
  payload: string | undefined | null,
): { secret: string; userId: string; createdAt: number } | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decryptText(payload, { allowLegacy: false })) as {
      secret?: string;
      userId?: string;
      createdAt?: number;
    };
    if (!parsed.secret || !parsed.userId || typeof parsed.createdAt !== "number") return null;
    return { secret: parsed.secret, userId: parsed.userId, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

export function serializeRecoveryCodes(codes: string[]) {
  return encryptText(JSON.stringify({ codes, createdAt: Date.now() }));
}

export function parseRecoveryCodes(payload: string | undefined | null) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decryptText(payload, { allowLegacy: false })) as { codes?: string[]; createdAt?: number };
    return Array.isArray(parsed.codes) ? parsed.codes : null;
  } catch {
    return null;
  }
}
