import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_ENCRYPTION_KEYRING_ENV,
  DataEncryptionKeyringError,
  LEGACY_DATA_KEY_ID,
  activeDataEncryptionKeyId,
  assertLegacyDataKeyAccepted,
  dataEncryptionKeyringSummary,
  decryptSensitiveValue,
  encryptSensitiveValue,
  inspectDataEncryptionKeyring,
  isWellFormedSensitiveEnvelope,
  sensitiveEnvelopeKeyId,
  type DataEncryptionKeyringIssue,
} from "@/lib/sensitive-data";

// Synthetic key material only: built at run time so no key-shaped literal is
// committed (secret scan), never derived from a deployment value.
const keyBytes = (fill: number, length = 32) => Buffer.alloc(length, fill).toString("base64url");
const KEY_A = keyBytes(11);
const KEY_B = keyBytes(22);
const ROOT = "synthetic-keyring-test-root-" + "0123456789abcdef";
const UNKNOWN_KID = "Sensitive data key id is not in the keyring.";
const PURPOSE = "commerce-order-buyer:vendor_1:order_1";

type Entry = { kid: string; key?: string; active?: boolean };
function useKeyring(entries: Entry[] | null) {
  vi.stubEnv(DATA_ENCRYPTION_KEYRING_ENV, entries === null ? "" : JSON.stringify(entries));
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", ROOT);
  vi.stubEnv("JOB_SECRET", "");
  useKeyring(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DATA_ENCRYPTION_KEYRING unset (zero-downtime default)", () => {
  it("keeps writing and reading v1 envelopes under the CSRF_SECRET-derived key (kid legacy)", () => {
    const envelope = encryptSensitiveValue("buyer", PURPOSE);

    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(sensitiveEnvelopeKeyId(envelope)).toBe(LEGACY_DATA_KEY_ID);
    expect(decryptSensitiveValue(envelope, PURPOSE)).toBe("buyer");
    expect(activeDataEncryptionKeyId()).toBe(LEGACY_DATA_KEY_ID);
    expect(dataEncryptionKeyringSummary()).toMatchObject({ configured: false, acceptsLegacy: true, activeKeyId: "legacy" });
    expect(() => assertLegacyDataKeyAccepted()).not.toThrow();
  });

  it("refuses a v2 envelope because no keyring key is configured", () => {
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }, { kid: "legacy" }]);
    const envelope = encryptSensitiveValue("buyer", PURPOSE);
    useKeyring(null);

    expect(() => decryptSensitiveValue(envelope, PURPOSE)).toThrow(UNKNOWN_KID);
  });
});

describe("DATA_ENCRYPTION_KEYRING configured", () => {
  it("encrypts with the active kid and still reads old v1 envelopes while legacy is listed", () => {
    const legacyEnvelope = encryptSensitiveValue("old buyer", PURPOSE);
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }, { kid: "legacy" }]);

    const envelope = encryptSensitiveValue("new buyer", PURPOSE);
    expect(envelope).toMatch(/^v2\.k2026a\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(envelope).not.toContain("new buyer");
    expect(sensitiveEnvelopeKeyId(envelope)).toBe("k2026a");
    expect(decryptSensitiveValue(envelope, PURPOSE)).toBe("new buyer");
    expect(decryptSensitiveValue(legacyEnvelope, PURPOSE)).toBe("old buyer");
    expect(() => decryptSensitiveValue(envelope, `${PURPOSE}:other`)).toThrow();
  });

  it("does not depend on CSRF_SECRET for keyring envelopes", () => {
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }]);
    const envelope = encryptSensitiveValue("buyer", PURPOSE);
    vi.stubEnv("CSRF_SECRET", "");

    expect(decryptSensitiveValue(envelope, PURPOSE)).toBe("buyer");
  });

  it("refuses v1 envelopes once legacy is removed from the keyring", () => {
    const legacyEnvelope = encryptSensitiveValue("old buyer", PURPOSE);
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }]);

    expect(() => decryptSensitiveValue(legacyEnvelope, PURPOSE)).toThrow(UNKNOWN_KID);
    expect(() => assertLegacyDataKeyAccepted()).toThrow(UNKNOWN_KID);
  });

  it("fails with an explicit error for a kid the keyring does not list, without trying other keys", () => {
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }]);
    const envelope = encryptSensitiveValue("buyer", PURPOSE);
    useKeyring([{ kid: "k2026b", key: KEY_B, active: true }, { kid: "legacy" }]);

    expect(() => decryptSensitiveValue(envelope, PURPOSE)).toThrow(UNKNOWN_KID);
  });

  it("switches the active key: old kid stays readable as decrypt-only, new writes use the new kid", () => {
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }, { kid: "legacy" }]);
    const before = encryptSensitiveValue("first", PURPOSE);

    useKeyring([{ kid: "k2026b", key: KEY_B, active: true }, { kid: "k2026a", key: KEY_A }, { kid: "legacy" }]);
    const after = encryptSensitiveValue("second", PURPOSE);

    expect(sensitiveEnvelopeKeyId(after)).toBe("k2026b");
    expect(decryptSensitiveValue(before, PURPOSE)).toBe("first");
    expect(decryptSensitiveValue(after, PURPOSE)).toBe("second");
    expect(dataEncryptionKeyringSummary()).toMatchObject({ activeKeyId: "k2026b", decryptOnlyKeyIds: ["k2026a", "legacy"] });

    useKeyring([{ kid: "k2026b", key: KEY_B, active: true }]);
    expect(() => decryptSensitiveValue(before, PURPOSE)).toThrow(UNKNOWN_KID);
    expect(decryptSensitiveValue(after, PURPOSE)).toBe("second");
  });

  it("keeps writing v1 while legacy is the active entry (stage readers before writers)", () => {
    useKeyring([{ kid: "legacy", active: true }, { kid: "k2026a", key: KEY_A }]);
    expect(sensitiveEnvelopeKeyId(encryptSensitiveValue("buyer", PURPOSE))).toBe(LEGACY_DATA_KEY_ID);

    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }]);
    const keyringEnvelope = encryptSensitiveValue("buyer", PURPOSE);
    useKeyring([{ kid: "legacy", active: true }, { kid: "k2026a", key: KEY_A }]);
    expect(decryptSensitiveValue(keyringEnvelope, PURPOSE)).toBe("buyer");
  });

  it("authenticates the kid: the same key under another kid does not open a relabelled envelope (AAD)", () => {
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }]);
    const envelope = encryptSensitiveValue("buyer", PURPOSE);
    // Same key material, different kid: only the associated data differs.
    useKeyring([{ kid: "k2026b", key: KEY_A, active: true }]);
    const relabelled = envelope.replace(/^v2\.k2026a\./u, "v2.k2026b.");

    expect(() => decryptSensitiveValue(relabelled, PURPOSE)).toThrow("Unsupported state or unable to authenticate data");
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }]);
    expect(decryptSensitiveValue(envelope, PURPOSE)).toBe("buyer");
  });

  it("checks the well-formed v1 and v2 shapes the database CHECKs also enforce", () => {
    const v1 = encryptSensitiveValue("buyer", PURPOSE);
    useKeyring([{ kid: "k".repeat(32), key: KEY_A, active: true }]);
    const v2 = encryptSensitiveValue("buyer", PURPOSE);

    expect(isWellFormedSensitiveEnvelope(v1)).toBe(true);
    expect(isWellFormedSensitiveEnvelope(v2)).toBe(true);
    // The longest v2 header is 76 characters (32-character kid).
    expect(v2.length - v2.split(".").at(-1)!.length).toBe(76);
    const [, kid, iv, tag, data] = v2.split(".");
    const shortIv = Buffer.from(iv!, "base64url").subarray(0, 9).toString("base64url");
    expect(isWellFormedSensitiveEnvelope(`v2.${kid}.${shortIv}.${tag}.${data}`)).toBe(false);
    expect(isWellFormedSensitiveEnvelope(`v2.${kid}.${iv}.${tag}.${data}.extra`)).toBe(false);
    expect(isWellFormedSensitiveEnvelope(`v2.${kid}.${iv}.${tag}.`)).toBe(false);
    expect(() => decryptSensitiveValue(`v2.${kid}.${shortIv}.${tag}.${data}`, PURPOSE)).toThrow("Invalid sensitive data envelope.");
  });

  it("decrypts a golden v2 envelope (locks the keyring KDF label, AAD and format)", () => {
    useKeyring([{ kid: "golden", key: keyBytes(7), active: true }]);

    expect(decryptSensitiveValue(
      "v2.golden.bbWTYhSrFw5QyRRO.2165enjGcnPbTgageT1wQg.i2P70WTQV6Iqiv0-SRGGiw",
      "golden-purpose",
    )).toBe("golden-plaintext");
  });

  it("refuses truncated tags and malformed v2 envelopes", () => {
    useKeyring([{ kid: "k2026a", key: KEY_A, active: true }]);
    const [version, kid, iv, tag, data] = encryptSensitiveValue("buyer", PURPOSE).split(".");
    const shortTag = Buffer.from(tag!, "base64url").subarray(0, 12).toString("base64url");

    expect(() => decryptSensitiveValue([version, kid, iv, shortTag, data].join("."), PURPOSE)).toThrow("Invalid sensitive data envelope.");
    for (const malformed of [
      `v2.${kid}.${iv}.${tag}`,
      `v2..${iv}.${tag}.${data}`,
      `v2.K2026A.${iv}.${tag}.${data}`,
      `v2.legacy.${iv}.${tag}.${data}`,
      `v3.${kid}.${iv}.${tag}.${data}`,
      "not-an-envelope",
    ]) {
      expect(sensitiveEnvelopeKeyId(malformed), malformed).toBeNull();
      expect(() => decryptSensitiveValue(malformed, PURPOSE), malformed).toThrow("Invalid sensitive data envelope.");
    }
  });

  it("fails every envelope operation closed while the keyring is malformed, without echoing it", () => {
    const legacyEnvelope = encryptSensitiveValue("buyer", PURPOSE);
    vi.stubEnv(DATA_ENCRYPTION_KEYRING_ENV, `[{"kid":"k2026a","key":"${KEY_A}"}]`);

    let caught: unknown;
    try {
      encryptSensitiveValue("buyer", PURPOSE);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DataEncryptionKeyringError);
    expect((caught as Error).message).toBe("Sensitive data keyring is invalid.");
    expect(JSON.stringify({ message: (caught as Error).message, stack: (caught as Error).stack })).not.toContain(KEY_A);
    expect(() => decryptSensitiveValue(legacyEnvelope, PURPOSE)).toThrow("Sensitive data keyring is invalid.");
  });
});

describe("inspectDataEncryptionKeyring", () => {
  const cases: ReadonlyArray<readonly [string, string, DataEncryptionKeyringIssue]> = [
    ["not JSON", "kid=k1", "invalid_json"],
    ["an object instead of a list", JSON.stringify({ activeKeyId: "k1" }), "not_a_list"],
    ["an empty list", "[]", "empty"],
    ["a non-object entry", JSON.stringify(["k1"]), "invalid_entry"],
    ["an unknown field", JSON.stringify([{ kid: "k1", key: KEY_A, active: true, note: "x" }]), "invalid_entry"],
    ["a non-boolean active flag", JSON.stringify([{ kid: "k1", key: KEY_A, active: "yes" }]), "invalid_entry"],
    ["an upper-case kid", JSON.stringify([{ kid: "K1", key: KEY_A, active: true }]), "invalid_key_id"],
    ["a kid with a dot", JSON.stringify([{ kid: "k.1", key: KEY_A, active: true }]), "invalid_key_id"],
    ["a kid longer than 32", JSON.stringify([{ kid: "k".repeat(33), key: KEY_A, active: true }]), "invalid_key_id"],
    ["a duplicate kid", JSON.stringify([{ kid: "k1", key: KEY_A, active: true }, { kid: "k1", key: KEY_B }]), "duplicate_key_id"],
    ["a duplicate legacy entry", JSON.stringify([{ kid: "k1", key: KEY_A, active: true }, { kid: "legacy" }, { kid: "legacy" }]), "duplicate_key_id"],
    ["one key under two kids", JSON.stringify([{ kid: "k1", key: KEY_A, active: true }, { kid: "k2", key: KEY_A }]), "duplicate_key_material"],
    ["no active entry", JSON.stringify([{ kid: "k1", key: KEY_A }, { kid: "legacy" }]), "no_active_key"],
    ["two active entries", JSON.stringify([{ kid: "k1", key: KEY_A, active: true }, { kid: "k2", key: KEY_B, active: true }]), "multiple_active_keys"],
    ["key material on legacy", JSON.stringify([{ kid: "legacy", key: KEY_A, active: true }]), "legacy_key_material"],
    ["a keyring entry without a key", JSON.stringify([{ kid: "k1", active: true }]), "missing_key_material"],
    ["standard base64 padding", JSON.stringify([{ kid: "k1", key: `${Buffer.alloc(32, 1).toString("base64")}`, active: true }]), "invalid_key_encoding"],
    ["a non-string key", JSON.stringify([{ kid: "k1", key: 12345, active: true }]), "invalid_key_encoding"],
    ["a 16-byte key", JSON.stringify([{ kid: "k1", key: keyBytes(3, 16), active: true }]), "key_too_short"],
    ["a 31-byte key", JSON.stringify([{ kid: "k1", key: keyBytes(3, 31), active: true }]), "key_too_short"],
    ["a 48-byte key", JSON.stringify([{ kid: "k1", key: keyBytes(3, 48), active: true }]), "key_too_long"],
  ];

  it.each(cases)("rejects %s", (_label, raw, issue) => {
    let caught: unknown;
    try {
      inspectDataEncryptionKeyring(raw);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DataEncryptionKeyringError);
    expect((caught as DataEncryptionKeyringError).issue).toBe(issue);
  });

  it("summarises a valid keyring without key material", () => {
    const summary = inspectDataEncryptionKeyring(JSON.stringify([
      { kid: "k2026b", key: KEY_B, active: true }, { kid: "k2026a", key: KEY_A, active: false }, { kid: "legacy" },
    ]));

    expect(summary).toEqual({
      configured: true,
      activeKeyId: "k2026b",
      keyIds: ["k2026b", "k2026a", "legacy"],
      decryptOnlyKeyIds: ["k2026a", "legacy"],
      acceptsLegacy: true,
    });
    expect(JSON.stringify(summary)).not.toContain(KEY_A);
    expect(inspectDataEncryptionKeyring(undefined)).toMatchObject({ configured: false, activeKeyId: "legacy" });
    expect(inspectDataEncryptionKeyring("   ")).toMatchObject({ configured: false });
  });
});
