import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ENVELOPE_VERSION = "v1";

function encryptionKey(purpose: string) {
  const seed = process.env.CSRF_SECRET?.trim() || process.env.JOB_SECRET?.trim();
  if (!seed) {
    throw new Error("Sensitive data encryption key is not configured.");
  }

  // 同一個部署密鑰依用途衍生不同金鑰，避免 MFA、Stream 等資料共用密文域。
  return createHmac("sha256", seed)
    .update(`CelebrateDeal:${purpose}`)
    .digest();
}

export function encryptSensitiveValue(value: string, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(purpose), iv);
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

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(purpose), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
