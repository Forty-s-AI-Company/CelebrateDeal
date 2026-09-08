import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { BankAccountEncryptionError, type BankAccountKeyring, loadRuntimeBankAccountKeyring } from "@/lib/bank-account";

const VERSION = "v1";
const TAIWAN_ID_LETTER_CODES: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34,
  J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25,
  S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};

function normalizedTaiwanTaxId(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][12]\d{8}$/.test(normalized)) throw new Error("Invalid Taiwan tax identity.");
  const code = TAIWAN_ID_LETTER_CODES[normalized[0]!]!;
  const digits = `${Math.floor(code / 10)}${code % 10}${normalized.slice(1)}`.split("").map(Number);
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  if (digits.reduce((sum, digit, index) => sum + digit * weights[index]!, 0) % 10 !== 0) {
    throw new Error("Invalid Taiwan tax identity.");
  }
  return normalized;
}

function aad(vendorId: string, keyId: string) {
  if (!vendorId.trim()) throw new Error("Tax identity vendor binding is required.");
  return Buffer.from(`affiliate-tax-identity:${vendorId}:${VERSION}:${keyId}`, "utf8");
}

export function encryptTaxIdentity(
  taxIdentity: string,
  vendorId: string,
  keyring: BankAccountKeyring = loadRuntimeBankAccountKeyring(),
) {
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new BankAccountEncryptionError("keyring_unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(vendorId, keyring.activeKeyId));
  const ciphertext = Buffer.concat([cipher.update(normalizedTaiwanTaxId(taxIdentity), "utf8"), cipher.final()]);
  return [VERSION, keyring.activeKeyId, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptTaxIdentity(
  envelope: string,
  vendorId: string,
  keyring: BankAccountKeyring = loadRuntimeBankAccountKeyring(),
) {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new BankAccountEncryptionError("invalid_envelope");
  const [, keyId, ivPart, tagPart, ciphertextPart] = parts as [string, string, string, string, string];
  const key = keyring.keys.get(keyId);
  if (!key || (keyId !== keyring.activeKeyId && !keyring.decryptOnlyKeyIds.has(keyId))) {
    throw new BankAccountEncryptionError("key_unavailable");
  }
  try {
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error("invalid envelope");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad(vendorId, keyId));
    decipher.setAuthTag(tag);
    return normalizedTaiwanTaxId(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
  } catch {
    throw new BankAccountEncryptionError("authentication_failed");
  }
}

export function maskTaxIdentity(value: string) {
  const normalized = normalizedTaiwanTaxId(value);
  return `${normalized.slice(0, 2)}*****${normalized.slice(-3)}`;
}
