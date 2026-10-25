import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-purposes";

const ENVELOPE_VERSION = "v1";
export const MINIMUM_ENCRYPTION_SECRET_BYTES = 32;
/**
 * Full 128-bit GCM tags only. Without an explicit authTagLength Node accepts
 * tags as short as 4 bytes, which would make a forged envelope far cheaper.
 */
export const GCM_AUTH_TAG_BYTES = 16;

/** Every KDF input begins with this tag; see deriveKeyFromRootSecret. */
const SENSITIVE_DATA_KDF_PREFIX = "CelebrateDeal:";
// Rotated after #485 (was "csrf-hmac-v1"); see derived-key-purposes.ts.
const CSRF_MAC_KEY_PURPOSE = DERIVED_KEY_ROTATIONS.csrfMac.current;

/**
 * KDF: HMAC-SHA256(root, "CelebrateDeal:" + purpose). Module-private on purpose.
 *
 * The output must stay byte-identical: MFA secrets, PII envelopes and hash
 * indexes already in the database depend on it.
 *
 * Invariant: the root secret is used ONLY here. Never HMAC any other value —
 * above all attacker-controlled input such as a cookie — with the root secret
 * directly, or that HMAC becomes an oracle that reveals derived keys. Callers
 * that need a MAC derive their own purpose key first and HMAC under that key.
 */
function deriveKeyFromRootSecret(rootSecret: string, purpose: string) {
  return createHmac("sha256", rootSecret)
    .update(`${SENSITIVE_DATA_KDF_PREFIX}${purpose}`)
    .digest();
}

/**
 * The CSRF MAC key: the KDF output for the csrfMac purpose under the CSRF
 * root secret. It takes the root explicitly because CSRF keeps its own
 * non-production fallback secret, which is shorter than the 32-byte minimum
 * deriveSensitiveDataKey enforces. Only src/lib/csrf.ts may import this.
 */
export function deriveCsrfMacKey(rootSecret: string) {
  return deriveKeyFromRootSecret(rootSecret, CSRF_MAC_KEY_PURPOSE);
}

export function deriveSensitiveDataKey(purpose: string) {
  const seed = process.env.CSRF_SECRET?.trim() || process.env.JOB_SECRET?.trim();
  if (!seed) {
    throw new Error("Sensitive data encryption key is not configured.");
  }
  if (Buffer.byteLength(seed, "utf8") < MINIMUM_ENCRYPTION_SECRET_BYTES) {
    throw new Error("Sensitive data encryption key is too short.");
  }

  // 同一個部署密鑰依用途衍生不同金鑰，避免 MFA、Stream 等資料共用密文域。
  return deriveKeyFromRootSecret(seed, purpose);
}

export function encryptSensitiveValue(value: string, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveSensitiveDataKey(purpose), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSensitiveValue(envelope: string, purpose: string) {
  const [version, ivPart, tagPart, encryptedPart] = envelope.split(".");
  if (version !== ENVELOPE_VERSION || !ivPart || !tagPart || !encryptedPart) {
    throw new Error("Invalid sensitive data envelope.");
  }

  const tag = Buffer.from(tagPart, "base64url");
  if (tag.length !== GCM_AUTH_TAG_BYTES) throw new Error("Invalid sensitive data envelope.");
  const decipher = createDecipheriv("aes-256-gcm", deriveSensitiveDataKey(purpose), Buffer.from(ivPart, "base64url"), {
    authTagLength: GCM_AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
