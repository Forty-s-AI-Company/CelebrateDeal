import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/password";

const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

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
  const seed = process.env.CSRF_SECRET?.trim() || process.env.JOB_SECRET?.trim();
  if (!seed) {
    throw new Error("CSRF_SECRET or JOB_SECRET is required for MFA encryption.");
  }
  return createHash("sha256").update(seed).digest();
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
  const offset = digest[digest.length - 1] & 15;
  const binary = (
    ((digest[offset] & 127) << 24)
    | ((digest[offset + 1] & 255) << 16)
    | ((digest[offset + 2] & 255) << 8)
    | (digest[offset + 3] & 255)
  );
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
  const bytes = randomBytes(5).toString("hex").toUpperCase();
  return `${bytes.slice(0, 5)}-${bytes.slice(5, 10)}`;
}

export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => rawRecoveryCode());
}

export function hashRecoveryCode(code: string) {
  return hashPassword(normalizeCode(code));
}

export function verifyRecoveryCode(code: string, codeHash: string) {
  return verifyPassword(normalizeCode(code), codeHash);
}

export function serializePendingMfaSetup(secret: string) {
  return encryptText(JSON.stringify({ secret, createdAt: Date.now() }));
}

export function parsePendingMfaSetup(payload: string | undefined | null): { secret: string; createdAt: number } | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decryptText(payload)) as { secret?: string; createdAt?: number };
    if (!parsed.secret || typeof parsed.createdAt !== "number") return null;
    return { secret: parsed.secret, createdAt: parsed.createdAt };
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
