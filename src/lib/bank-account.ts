import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const BANK_ACCOUNT_ENVELOPE_VERSION = "v2";
const AES_256_KEY_BYTES = 32;
const BANK_ACCOUNT_KEYRING_ENV = "BANK_ACCOUNT_KEYRING_JSON";
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type BankAccountDetails = {
  accountName: string;
  bankCode: string;
  accountNumber: string;
};

export type BankAccountKeyringInput = {
  activeKeyId: string;
  /** Base64url-encoded 32-byte keys supplied by the runtime secret boundary. */
  keys: Record<string, string>;
  /** Keys that may decrypt historical envelopes but must never encrypt new data. */
  decryptOnlyKeyIds?: string[];
};

export type BankAccountKeyring = Readonly<{
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
  decryptOnlyKeyIds: ReadonlySet<string>;
}>;

type StoredBankAccount = {
  vendorId: string;
  bankAccountEncrypted?: string | null;
  legacyAccountName?: string | null;
  legacyBankCode?: string | null;
  legacyAccountNumber?: string | null;
};

export class BankAccountEncryptionError extends Error {
  constructor(public readonly code: "keyring_unavailable" | "invalid_envelope" | "key_unavailable" | "authentication_failed") {
    // Keep the public error deliberately non-diagnostic: callers must not learn
    // whether an envelope, key ID, nonce, tag, or account payload was wrong.
    super("Bank account encryption is unavailable.");
    this.name = "BankAccountEncryptionError";
  }
}

function encryptionPurpose(vendorId: string) {
  if (!vendorId.trim()) throw new Error("Bank account vendor binding is required.");
  return `payout-bank-account:${vendorId}`;
}

function normalizedDetails(input: BankAccountDetails): BankAccountDetails {
  const details = {
    accountName: input.accountName.trim(),
    bankCode: input.bankCode.trim(),
    accountNumber: input.accountNumber.trim(),
  };
  if (!details.accountName || !details.bankCode || !details.accountNumber) {
    throw new Error("Bank account details are incomplete.");
  }
  return details;
}

function assertKeyId(keyId: string) {
  if (!KEY_ID_PATTERN.test(keyId)) throw new BankAccountEncryptionError("keyring_unavailable");
}

function decodeKey(encodedKey: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(encodedKey)) throw new BankAccountEncryptionError("keyring_unavailable");
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== AES_256_KEY_BYTES || key.toString("base64url") !== encodedKey) {
    throw new BankAccountEncryptionError("keyring_unavailable");
  }
  return key;
}

/**
 * Validates an injected keyring without ever logging or returning its key bytes.
 * The active key is write-enabled; every other listed key must be explicitly
 * marked decrypt-only to avoid accidentally resurrecting a retired key.
 */
export function createBankAccountKeyring(input: BankAccountKeyringInput): BankAccountKeyring {
  try {
    assertKeyId(input.activeKeyId);
    const keys = new Map<string, Buffer>();
    for (const [keyId, encodedKey] of Object.entries(input.keys)) {
      assertKeyId(keyId);
      if (typeof encodedKey !== "string" || keys.has(keyId)) {
        throw new BankAccountEncryptionError("keyring_unavailable");
      }
      keys.set(keyId, decodeKey(encodedKey));
    }
    if (!keys.has(input.activeKeyId)) throw new BankAccountEncryptionError("keyring_unavailable");

    const decryptOnlyKeyIds = new Set(input.decryptOnlyKeyIds ?? []);
    for (const keyId of decryptOnlyKeyIds) {
      assertKeyId(keyId);
      if (keyId === input.activeKeyId || !keys.has(keyId)) {
        throw new BankAccountEncryptionError("keyring_unavailable");
      }
    }
    if (keys.size !== decryptOnlyKeyIds.size + 1) {
      throw new BankAccountEncryptionError("keyring_unavailable");
    }
    return { activeKeyId: input.activeKeyId, keys, decryptOnlyKeyIds };
  } catch (error) {
    if (error instanceof BankAccountEncryptionError) throw error;
    throw new BankAccountEncryptionError("keyring_unavailable");
  }
}

/** Runtime adapter only: deployment injects this JSON via its secret boundary. */
export function loadRuntimeBankAccountKeyring(): BankAccountKeyring {
  const raw = process.env[BANK_ACCOUNT_KEYRING_ENV];
  if (!raw) throw new BankAccountEncryptionError("keyring_unavailable");
  try {
    return createBankAccountKeyring(JSON.parse(raw) as BankAccountKeyringInput);
  } catch (error) {
    if (error instanceof BankAccountEncryptionError) throw error;
    throw new BankAccountEncryptionError("keyring_unavailable");
  }
}

function associatedData(vendorId: string, keyId: string) {
  return Buffer.from(`${encryptionPurpose(vendorId)}:${BANK_ACCOUNT_ENVELOPE_VERSION}:${keyId}`, "utf8");
}

type ParsedEnvelope = { keyId: string; iv: Buffer; tag: Buffer; ciphertext: Buffer };

function decodeEnvelopePart(value: string, expectedBytes?: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new BankAccountEncryptionError("invalid_envelope");
  const decoded = Buffer.from(value, "base64url");
  if (!decoded.length || decoded.toString("base64url") !== value || (expectedBytes && decoded.length !== expectedBytes)) {
    throw new BankAccountEncryptionError("invalid_envelope");
  }
  return decoded;
}

function parseEnvelope(envelope: string): ParsedEnvelope {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== BANK_ACCOUNT_ENVELOPE_VERSION) {
    throw new BankAccountEncryptionError("invalid_envelope");
  }
  const [, keyId, ivPart, tagPart, ciphertextPart] = parts;
  if (!keyId || !ivPart || !tagPart || !ciphertextPart) throw new BankAccountEncryptionError("invalid_envelope");
  try {
    assertKeyId(keyId);
    return {
      keyId,
      iv: decodeEnvelopePart(ivPart, 12),
      tag: decodeEnvelopePart(tagPart, 16),
      ciphertext: decodeEnvelopePart(ciphertextPart),
    };
  } catch (error) {
    if (error instanceof BankAccountEncryptionError) throw error;
    throw new BankAccountEncryptionError("invalid_envelope");
  }
}

export function encryptBankAccount(
  details: BankAccountDetails,
  vendorId: string,
  keyring = loadRuntimeBankAccountKeyring(),
) {
  const normalized = normalizedDetails(details);
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new BankAccountEncryptionError("keyring_unavailable");

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData(vendorId, keyring.activeKeyId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalized), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    BANK_ACCOUNT_ENVELOPE_VERSION,
    keyring.activeKeyId,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptBankAccount(
  envelope: string,
  vendorId: string,
  keyring = loadRuntimeBankAccountKeyring(),
): BankAccountDetails {
  const parsed = parseEnvelope(envelope);
  const key = keyring.keys.get(parsed.keyId);
  if (!key || (parsed.keyId !== keyring.activeKeyId && !keyring.decryptOnlyKeyIds.has(parsed.keyId))) {
    throw new BankAccountEncryptionError("key_unavailable");
  }

  let raw: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv);
    decipher.setAAD(associatedData(vendorId, parsed.keyId));
    decipher.setAuthTag(parsed.tag);
    raw = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new BankAccountEncryptionError("authentication_failed");
  }
  try {
    return normalizedDetails(JSON.parse(raw) as BankAccountDetails);
  } catch {
    throw new BankAccountEncryptionError("authentication_failed");
  }
}

/**
 * The only re-encryption path. It is idempotent: a current-key envelope is
 * returned byte-for-byte, while an old-key envelope is authenticated before
 * being re-sealed with the active key. Retain old keys until every batch passes.
 */
export function rotateBankAccountEnvelope(envelope: string, vendorId: string, keyring = loadRuntimeBankAccountKeyring()) {
  const parsed = parseEnvelope(envelope);
  if (parsed.keyId === keyring.activeKeyId) return envelope;
  return encryptBankAccount(decryptBankAccount(envelope, vendorId, keyring), vendorId, keyring);
}

export function resolveStoredBankAccount(input: StoredBankAccount, keyring?: BankAccountKeyring): BankAccountDetails {
  if (input.bankAccountEncrypted) {
    // An envelope is authoritative. Any parse/key/auth failure must fail closed;
    // never turn it into a legacy-plaintext fallback.
    return decryptBankAccount(input.bankAccountEncrypted, input.vendorId, keyring);
  }
  return normalizedDetails({
    accountName: input.legacyAccountName ?? "",
    bankCode: input.legacyBankCode ?? "",
    accountNumber: input.legacyAccountNumber ?? "",
  });
}

export function maskBankAccount(details: BankAccountDetails) {
  const normalized = normalizedDetails(details);
  const nameCharacters = Array.from(normalized.accountName);
  const visibleName = nameCharacters.length <= 1
    ? "＊"
    : `${nameCharacters[0]}${"＊".repeat(Math.min(nameCharacters.length - 1, 4))}`;
  const accountCharacters = Array.from(normalized.accountNumber);
  return {
    accountName: visibleName,
    bankCode: normalized.bankCode,
    accountNumber: `****${accountCharacters.slice(-4).join("")}`,
  };
}

export function maskedStoredBankAccount(input: StoredBankAccount, keyring?: BankAccountKeyring) {
  return maskBankAccount(resolveStoredBankAccount(input, keyring));
}
