import { describe, expect, it } from "vitest";
import { createBankAccountKeyring, decryptBankAccount, encryptBankAccount } from "./bank-account";
import { decryptAffiliateBankAccount, encryptAffiliateBankAccount, rotateAffiliateBankAccount } from "./affiliate-bank-account";

// Synthetic keys/accounts only; runtime secret providers are never consulted.
const keyA = Buffer.alloc(32, 1).toString("base64url");
const keyB = Buffer.alloc(32, 2).toString("base64url");
const original = createBankAccountKeyring({ activeKeyId: "a", keys: { a: keyA } });
const rotated = createBankAccountKeyring({ activeKeyId: "b", keys: { a: keyA, b: keyB }, decryptOnlyKeyIds: ["a"] });
const scope = { vendorId: "vendor_a", affiliateId: "affiliate_a" };
const account = { accountName: "Synthetic Payee", bankCode: "999", accountNumber: "123456789012" };

describe("affiliate bank envelopes", () => {
  it("round trips with randomized encryption and exact identity", () => {
    const first = encryptAffiliateBankAccount(account, scope, original);
    const second = encryptAffiliateBankAccount(account, scope, original);
    expect(first).not.toEqual(second);
    expect(first).not.toContain(account.accountNumber);
    expect(decryptAffiliateBankAccount(first, scope, original)).toEqual(account);
  });
  it.each([{ vendorId: "vendor_b", affiliateId: "affiliate_a" }, { vendorId: "vendor_a", affiliateId: "affiliate_b" }])("rejects swapped ownership %j", (foreign) => {
    const encrypted = encryptAffiliateBankAccount(account, scope, original);
    expect(() => decryptAffiliateBankAccount(encrypted, foreign, original)).toThrow();
    expect(() => rotateAffiliateBankAccount(encrypted, foreign, rotated)).toThrow();
  });
  it("separates merchant and affiliate bank purposes in both directions", () => {
    expect(() => decryptAffiliateBankAccount(encryptBankAccount(account, scope.vendorId, original), scope, original)).toThrow();
    expect(() => decryptBankAccount(encryptAffiliateBankAccount(account, scope, original), scope.vendorId, original)).toThrow();
  });
  it("authenticates old keys before rotation and leaves current envelopes unchanged", () => {
    const previous = encryptAffiliateBankAccount(account, scope, original);
    const current = rotateAffiliateBankAccount(previous, scope, rotated);
    expect(current).not.toEqual(previous);
    expect(decryptAffiliateBankAccount(current, scope, rotated)).toEqual(account);
    expect(rotateAffiliateBankAccount(current, scope, rotated)).toBe(current);
    expect(() => decryptAffiliateBankAccount(current, scope, original)).toThrow();
  });
  it("rejects authenticated-data tampering", () => {
    const parts = encryptAffiliateBankAccount(account, scope, original).split(".");
    parts[3] = Buffer.alloc(16, 0).toString("base64url");
    expect(() => decryptAffiliateBankAccount(parts.join("."), scope, original)).toThrow();
  });
  it.each([{ ...scope, affiliateId: "" }, { ...scope, vendorId: "a:b" }, { ...scope, tenantOverride: "vendor_b" }])("rejects invalid scope %j", (invalid) => {
    expect(() => encryptAffiliateBankAccount(account, invalid, original)).toThrow();
  });
  it.each([{ ...account, bankCode: "abc" }, { ...account, accountNumber: "1" }, { ...account, accountName: " " }, { ...account, taxIdentity: "unexpected" }])("rejects malformed payee %j", (invalid) => {
    expect(() => encryptAffiliateBankAccount(invalid, scope, original)).toThrow();
  });
});
