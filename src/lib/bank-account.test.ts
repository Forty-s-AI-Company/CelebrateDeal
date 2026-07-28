import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BankAccountEncryptionError,
  createBankAccountKeyring,
  decryptBankAccount,
  encryptBankAccount,
  maskBankAccount,
  resolveStoredBankAccount,
  rotateBankAccountEnvelope,
} from "@/lib/bank-account";

function syntheticKey() {
  return randomBytes(32).toString("base64url");
}

function testKeyring() {
  const oldKey = syntheticKey();
  const currentKey = syntheticKey();
  return {
    oldOnly: createBankAccountKeyring({ activeKeyId: "old-2026", keys: { "old-2026": oldKey } }),
    rotated: createBankAccountKeyring({
      activeKeyId: "current-2026",
      keys: { "old-2026": oldKey, "current-2026": currentKey },
      decryptOnlyKeyIds: ["old-2026"],
    }),
    currentOnly: createBankAccountKeyring({ activeKeyId: "current-2026", keys: { "current-2026": currentKey } }),
  };
}

describe("bank account encryption", () => {
  const details = { accountName: "王小明", bankCode: "812", accountNumber: "12345678901234" };

  it("writes a versioned active-key envelope without retaining plaintext", () => {
    const { rotated } = testKeyring();
    const envelope = encryptBankAccount(details, "vendor-1", rotated);

    expect(envelope).toMatch(/^v2\.current-2026\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain(details.accountName);
    expect(envelope).not.toContain(details.accountNumber);
    expect(decryptBankAccount(envelope, "vendor-1", rotated)).toEqual(details);
  });

  it("recovers an old-key envelope and rotates it once without destructive retries", () => {
    const { oldOnly, rotated } = testKeyring();
    const oldEnvelope = encryptBankAccount(details, "vendor-1", oldOnly);
    const rotatedEnvelope = rotateBankAccountEnvelope(oldEnvelope, "vendor-1", rotated);

    expect(decryptBankAccount(oldEnvelope, "vendor-1", rotated)).toEqual(details);
    expect(rotatedEnvelope).toMatch(/^v2\.current-2026\./);
    expect(decryptBankAccount(rotatedEnvelope, "vendor-1", rotated)).toEqual(details);
    expect(rotateBankAccountEnvelope(rotatedEnvelope, "vendor-1", rotated)).toBe(rotatedEnvelope);
  });

  it("fails closed for an unavailable old key, a tampered envelope, and tenant swaps", () => {
    const { oldOnly, rotated, currentOnly } = testKeyring();
    const oldEnvelope = encryptBankAccount(details, "vendor-1", oldOnly);
    const currentEnvelope = encryptBankAccount(details, "vendor-1", rotated);

    expect(() => decryptBankAccount(oldEnvelope, "vendor-1", currentOnly)).toThrow(BankAccountEncryptionError);
    expect(() => decryptBankAccount(`${currentEnvelope}x`, "vendor-1", rotated)).toThrow(BankAccountEncryptionError);
    expect(() => decryptBankAccount(currentEnvelope, "vendor-2", rotated)).toThrow(BankAccountEncryptionError);
  });

  it("reads a legacy row only when no envelope exists and never downgrades an envelope error", () => {
    const { rotated } = testKeyring();
    expect(resolveStoredBankAccount({
      vendorId: "vendor-1",
      legacyAccountName: details.accountName,
      legacyBankCode: details.bankCode,
      legacyAccountNumber: details.accountNumber,
    }, rotated)).toEqual(details);
    expect(() => resolveStoredBankAccount({
      vendorId: "vendor-1",
      bankAccountEncrypted: "v2.unknown-key.invalid.invalid.invalid",
      legacyAccountName: details.accountName,
      legacyBankCode: details.bankCode,
      legacyAccountNumber: details.accountNumber,
    }, rotated)).toThrow(BankAccountEncryptionError);
  });

  it("returns only masked display values outside the authorized export boundary", () => {
    expect(maskBankAccount(details)).toEqual({ accountName: "王＊＊", bankCode: "812", accountNumber: "****1234" });
  });
});
