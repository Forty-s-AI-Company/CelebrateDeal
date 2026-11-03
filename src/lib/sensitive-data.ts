import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { DATA_ENCRYPTION_KEYRING_KDF_LABEL, DERIVED_KEY_ROTATIONS } from "@/lib/derived-key-purposes";

/** Envelope written with the root-derived key (kid `legacy`): "v1.<iv>.<tag>.<data>". */
const LEGACY_ENVELOPE_VERSION = "v1";
/** Envelope written with a DATA_ENCRYPTION_KEYRING key: "v2.<kid>.<iv>.<tag>.<data>". */
const KEYRING_ENVELOPE_VERSION = "v2";
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

export const DATA_ENCRYPTION_KEYRING_ENV = "DATA_ENCRYPTION_KEYRING";
/**
 * Reserved key id for the key derived from CSRF_SECRET (v1 envelopes, MFA
 * "m2." and older MFA ciphertext). It never carries key material in the
 * keyring: listing it only says whether those envelopes are still accepted
 * (and, when it is the active entry, keeps writing them).
 */
export const LEGACY_DATA_KEY_ID = "legacy";
/** Lower-case, no dots (the envelope separator), so a kid is safe to log. */
const DATA_KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/u;
export const DATA_ENCRYPTION_KEY_BYTES = 32;
const UNKNOWN_KEY_ID_MESSAGE = "Sensitive data key id is not in the keyring.";
const INVALID_KEYRING_MESSAGE = "Sensitive data keyring is invalid.";

/**
 * KDF: HMAC-SHA256(secret, "CelebrateDeal:" + purpose). Module-private on purpose.
 *
 * The output must stay byte-identical: MFA secrets, PII envelopes and hash
 * indexes already in the database depend on it.
 *
 * Invariant: the root secret is used ONLY here. Never HMAC any other value —
 * above all attacker-controlled input such as a cookie — with the root secret
 * directly, or that HMAC becomes an oracle that reveals derived keys. Callers
 * that need a MAC derive their own purpose key first and HMAC under that key.
 * Keyring keys go through the same function under their own label.
 */
function deriveKeyFromRootSecret(rootSecret: string | Buffer, purpose: string) {
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

/**
 * Purpose key under the root secret (CSRF_SECRET). Used for hash indexes,
 * token MACs and kid `legacy` envelopes. There is no JOB_SECRET fallback
 * (F-031): without CSRF_SECRET this fails closed.
 */
export function deriveSensitiveDataKey(purpose: string) {
  const seed = process.env.CSRF_SECRET?.trim();
  if (!seed) {
    throw new Error("Sensitive data encryption key is not configured.");
  }
  if (Buffer.byteLength(seed, "utf8") < MINIMUM_ENCRYPTION_SECRET_BYTES) {
    throw new Error("Sensitive data encryption key is too short.");
  }

  // 同一個部署密鑰依用途衍生不同金鑰，避免 MFA、Stream 等資料共用密文域。
  return deriveKeyFromRootSecret(seed, purpose);
}

export type DataEncryptionKeyringIssue =
  | "invalid_json"
  | "not_a_list"
  | "empty"
  | "invalid_entry"
  | "invalid_key_id"
  | "duplicate_key_id"
  | "no_active_key"
  | "multiple_active_keys"
  | "legacy_key_material"
  | "missing_key_material"
  | "invalid_key_encoding"
  | "key_too_short"
  | "key_too_long";

/** Never carries key bytes, the raw value or the offending entry. */
export class DataEncryptionKeyringError extends Error {
  constructor(public readonly issue: DataEncryptionKeyringIssue) {
    super(INVALID_KEYRING_MESSAGE);
    this.name = "DataEncryptionKeyringError";
  }
}

/** What the keyring declares, without key material. */
export type DataEncryptionKeyringSummary = Readonly<{
  /** False when DATA_ENCRYPTION_KEYRING is unset: the root-derived key only. */
  configured: boolean;
  activeKeyId: string;
  /** Every accepted kid, including `legacy` when listed. */
  keyIds: readonly string[];
  decryptOnlyKeyIds: readonly string[];
  acceptsLegacy: boolean;
}>;

type ParsedKeyring = { summary: DataEncryptionKeyringSummary; keys: ReadonlyMap<string, Buffer> };

const UNCONFIGURED_KEYRING: ParsedKeyring = Object.freeze({
  summary: Object.freeze({
    configured: false,
    activeKeyId: LEGACY_DATA_KEY_ID,
    keyIds: Object.freeze([LEGACY_DATA_KEY_ID]),
    decryptOnlyKeyIds: Object.freeze([]),
    acceptsLegacy: true,
  }),
  keys: new Map(),
});

function decodeKeyringKey(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new DataEncryptionKeyringError("invalid_key_encoding");
  }
  const key = Buffer.from(value, "base64url");
  if (key.toString("base64url") !== value) throw new DataEncryptionKeyringError("invalid_key_encoding");
  if (key.length < DATA_ENCRYPTION_KEY_BYTES) throw new DataEncryptionKeyringError("key_too_short");
  if (key.length > DATA_ENCRYPTION_KEY_BYTES) throw new DataEncryptionKeyringError("key_too_long");
  return key;
}

/**
 * DATA_ENCRYPTION_KEYRING is a JSON list. Each entry is
 * `{"kid": "<id>", "key": "<base64url of 32 random bytes>", "active": true?}`.
 * Exactly one entry is active (it encrypts); every other entry is
 * decrypt-only. `{"kid": "legacy"}` (no key) keeps accepting envelopes from the
 * CSRF_SECRET-derived key; leaving it out refuses them.
 */
function parseKeyring(raw: string | undefined): ParsedKeyring {
  if (raw === undefined || !raw.trim()) return UNCONFIGURED_KEYRING;
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new DataEncryptionKeyringError("invalid_json");
  }
  if (!Array.isArray(input)) throw new DataEncryptionKeyringError("not_a_list");
  if (input.length === 0) throw new DataEncryptionKeyringError("empty");

  const keys = new Map<string, Buffer>();
  const keyIds: string[] = [];
  const active: string[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new DataEncryptionKeyringError("invalid_entry");
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).some((field) => field !== "kid" && field !== "key" && field !== "active")) {
      throw new DataEncryptionKeyringError("invalid_entry");
    }
    if (record.active !== undefined && typeof record.active !== "boolean") throw new DataEncryptionKeyringError("invalid_entry");
    const kid = record.kid;
    if (typeof kid !== "string" || !DATA_KEY_ID_PATTERN.test(kid)) throw new DataEncryptionKeyringError("invalid_key_id");
    if (keyIds.includes(kid)) throw new DataEncryptionKeyringError("duplicate_key_id");
    if (kid === LEGACY_DATA_KEY_ID) {
      if (record.key !== undefined) throw new DataEncryptionKeyringError("legacy_key_material");
    } else {
      if (record.key === undefined) throw new DataEncryptionKeyringError("missing_key_material");
      keys.set(kid, decodeKeyringKey(record.key));
    }
    keyIds.push(kid);
    if (record.active === true) active.push(kid);
  }
  if (active.length === 0) throw new DataEncryptionKeyringError("no_active_key");
  if (active.length > 1) throw new DataEncryptionKeyringError("multiple_active_keys");

  const activeKeyId = active[0]!;
  return {
    summary: Object.freeze({
      configured: true,
      activeKeyId,
      keyIds: Object.freeze([...keyIds]),
      decryptOnlyKeyIds: Object.freeze(keyIds.filter((kid) => kid !== activeKeyId)),
      acceptsLegacy: keyIds.includes(LEGACY_DATA_KEY_ID),
    }),
    keys,
  };
}

/**
 * Validates a DATA_ENCRYPTION_KEYRING value (preflight, scripts). Throws
 * DataEncryptionKeyringError with a non-sensitive issue code.
 */
export function inspectDataEncryptionKeyring(raw: string | undefined): DataEncryptionKeyringSummary {
  return parseKeyring(raw).summary;
}

let cachedKeyring: { raw: string | undefined; parsed: ParsedKeyring } | null = null;

function runtimeKeyring() {
  const raw = process.env[DATA_ENCRYPTION_KEYRING_ENV];
  if (cachedKeyring && cachedKeyring.raw === raw) return cachedKeyring.parsed;
  // A malformed keyring fails every envelope operation closed; nothing falls
  // back to the root key, because that would write data the operator meant to
  // move off it.
  const parsed = parseKeyring(raw);
  cachedKeyring = { raw, parsed };
  return parsed;
}

/** The runtime keyring without key material. Throws when it is malformed. */
export function dataEncryptionKeyringSummary() {
  return runtimeKeyring().summary;
}

/** The kid new envelopes are written with (`legacy` = CSRF_SECRET-derived). */
export function activeDataEncryptionKeyId() {
  return runtimeKeyring().summary.activeKeyId;
}

/**
 * Throws unless the runtime keyring still accepts the root-derived key
 * (kid `legacy`). Formats outside this module that use it (MFA "m2.") call
 * this before decrypting so that removing `legacy` retires them as well.
 */
export function assertLegacyDataKeyAccepted() {
  if (!runtimeKeyring().summary.acceptsLegacy) throw new Error(UNKNOWN_KEY_ID_MESSAGE);
}

/**
 * The kid an envelope was written with: `legacy` for v1, the declared kid for
 * v2, null when the value is not a well-formed envelope. Reads no key.
 */
export function sensitiveEnvelopeKeyId(envelope: string): string | null {
  const parts = envelope.split(".");
  if (parts.length === 4 && parts[0] === LEGACY_ENVELOPE_VERSION && parts.slice(1).every(Boolean)) return LEGACY_DATA_KEY_ID;
  if (parts.length === 5 && parts[0] === KEYRING_ENVELOPE_VERSION && parts.slice(2).every(Boolean)
    && DATA_KEY_ID_PATTERN.test(parts[1]!) && parts[1] !== LEGACY_DATA_KEY_ID) {
    return parts[1]!;
  }
  return null;
}

function keyringPurposeKey(keyringKey: Buffer, purpose: string) {
  return deriveKeyFromRootSecret(keyringKey, `${DATA_ENCRYPTION_KEYRING_KDF_LABEL}:${purpose}`);
}

function keyringAssociatedData(kid: string) {
  return Buffer.from(`${SENSITIVE_DATA_KDF_PREFIX}sensitive-data:${KEYRING_ENVELOPE_VERSION}:${kid}`, "utf8");
}

function sealWith(key: Buffer, value: string, associatedData?: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (associatedData) cipher.setAAD(associatedData);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")];
}

function openWith(key: Buffer, ivPart: string, tagPart: string, encryptedPart: string, associatedData?: Buffer) {
  const tag = Buffer.from(tagPart, "base64url");
  if (tag.length !== GCM_AUTH_TAG_BYTES) throw new Error("Invalid sensitive data envelope.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"), {
    authTagLength: GCM_AUTH_TAG_BYTES,
  });
  if (associatedData) decipher.setAAD(associatedData);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Encrypts with the active keyring key. Without DATA_ENCRYPTION_KEYRING (or
 * with `legacy` active) this writes the original v1 envelope.
 */
export function encryptSensitiveValue(value: string, purpose: string) {
  const keyring = runtimeKeyring();
  const kid = keyring.summary.activeKeyId;
  if (kid === LEGACY_DATA_KEY_ID) {
    return [LEGACY_ENVELOPE_VERSION, ...sealWith(deriveSensitiveDataKey(purpose), value)].join(".");
  }
  const key = keyringPurposeKey(keyring.keys.get(kid)!, purpose);
  return [KEYRING_ENVELOPE_VERSION, kid, ...sealWith(key, value, keyringAssociatedData(kid))].join(".");
}

/**
 * Decrypts a v1 (kid `legacy`) or v2 envelope with the key its kid names. A
 * kid the keyring does not list (including `legacy` once removed) fails with
 * "Sensitive data key id is not in the keyring." rather than trying others.
 */
export function decryptSensitiveValue(envelope: string, purpose: string) {
  const kid = sensitiveEnvelopeKeyId(envelope);
  if (kid === null) throw new Error("Invalid sensitive data envelope.");
  const keyring = runtimeKeyring();
  const parts = envelope.split(".");
  if (kid === LEGACY_DATA_KEY_ID) {
    if (!keyring.summary.acceptsLegacy) throw new Error(UNKNOWN_KEY_ID_MESSAGE);
    return openWith(deriveSensitiveDataKey(purpose), parts[1]!, parts[2]!, parts[3]!);
  }
  const keyringKey = keyring.keys.get(kid);
  if (!keyringKey) throw new Error(UNKNOWN_KEY_ID_MESSAGE);
  return openWith(keyringPurposeKey(keyringKey, purpose), parts[2]!, parts[3]!, parts[4]!, keyringAssociatedData(kid));
}
