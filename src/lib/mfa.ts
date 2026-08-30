import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  verifyPassword,
  verifyPasswordAsync,
} from "@/lib/password";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_CODE_BYTES = 10;
const RECOVERY_CODE_HASH_VERSION = "hmac-sha256-v1";
const RECOVERY_CODE_HASH_PURPOSE = "mfa-recovery-code-authentication";

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

function mfaKeyMaterial() {
  return deriveSensitiveDataKey("mfa-encryption");
}

function encryptText(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mfaKeyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptText(value: string) {
  const [ivPart, tagPart, encryptedPart] = value.split(".");
  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error("Invalid encrypted MFA payload.");
  }
  const decipher = createDecipheriv("aes-256-gcm", mfaKeyMaterial(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
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

export function decryptMfaSecret(secretEncrypted: string) {
  return decryptText(secretEncrypted);
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

function recoveryCodeDigest(code: string) {
  return createHmac("sha256", deriveSensitiveDataKey(RECOVERY_CODE_HASH_PURPOSE))
    .update(normalizeCode(code))
    .digest();
}

function parseRecoveryCodeDigest(codeHash: string) {
  const [version, encodedDigest, unexpected] = codeHash.split(":");
  if (version !== RECOVERY_CODE_HASH_VERSION || !encodedDigest || unexpected) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedDigest)) return null;
  const digest = Buffer.from(encodedDigest, "base64url");
  return digest.length === 32 ? digest : null;
}

export function hashRecoveryCode(code: string) {
  return `${RECOVERY_CODE_HASH_VERSION}:${recoveryCodeDigest(code).toString("base64url")}`;
}

export function verifyRecoveryCode(code: string, codeHash: string) {
  const expectedDigest = parseRecoveryCodeDigest(codeHash);
  if (!expectedDigest) return verifyPassword(normalizeCode(code), codeHash);
  return timingSafeEqual(expectedDigest, recoveryCodeDigest(code));
}

export async function hashRecoveryCodeAsync(code: string) {
  return hashRecoveryCode(code);
}

export async function verifyRecoveryCodeAsync(code: string, codeHash: string) {
  const expectedDigest = parseRecoveryCodeDigest(codeHash);
  if (!expectedDigest) return verifyPasswordAsync(normalizeCode(code), codeHash);
  return timingSafeEqual(expectedDigest, recoveryCodeDigest(code));
}

export function serializePendingMfaSetup(secret: string, userId: string) {
  return encryptText(JSON.stringify({ secret, userId, createdAt: Date.now() }));
}

export function parsePendingMfaSetup(
  payload: string | undefined | null,
): { secret: string; userId: string; createdAt: number } | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decryptText(payload)) as {
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
    const parsed = JSON.parse(decryptText(payload)) as { codes?: string[]; createdAt?: number };
    return Array.isArray(parsed.codes) ? parsed.codes : null;
  } catch {
    return null;
  }
}
