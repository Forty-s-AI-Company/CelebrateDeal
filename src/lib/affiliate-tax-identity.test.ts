import { describe, expect, it } from "vitest";
import { createBankAccountKeyring } from "./bank-account";
import { encryptAffiliateBankAccount } from "./affiliate-bank-account";
import { decryptAffiliateTaxIdentity, encryptAffiliateTaxIdentity } from "./affiliate-tax-identity";
const key = Buffer.alloc(32, 3).toString("base64url");
const keyring = createBankAccountKeyring({ activeKeyId: "synthetic", keys: { synthetic: key } });
const scope = { vendorId: "vendor_a", affiliateId: "affiliate_a" };
describe("affiliate tax identity encryption", () => {
  it("round trips a bounded declaration without retaining plaintext", () => {
    const first = encryptAffiliateTaxIdentity("SYNTHETIC123", scope, keyring);
    expect(first).not.toContain("SYNTHETIC123");
    expect(first).not.toBe(encryptAffiliateTaxIdentity("SYNTHETIC123", scope, keyring));
    expect(decryptAffiliateTaxIdentity(first, scope, keyring)).toBe("SYNTHETIC123");
  });
  it.each([{ vendorId: "vendor_b", affiliateId: "affiliate_a" }, { vendorId: "vendor_a", affiliateId: "affiliate_b" }])("rejects swapped scope %j", foreign => {
    expect(() => decryptAffiliateTaxIdentity(encryptAffiliateTaxIdentity("SYNTHETIC123", scope, keyring), foreign, keyring)).toThrow();
  });
  it("rejects bank envelope substitution and malformed ciphertext", () => {
    const bank = encryptAffiliateBankAccount({ accountName: "Synthetic", bankCode: "999", accountNumber: "123456789" }, scope, keyring);
    expect(() => decryptAffiliateTaxIdentity(bank, scope, keyring)).toThrow();
    expect(() => decryptAffiliateTaxIdentity("tax1.synthetic.invalid.invalid.invalid", scope, keyring)).toThrow();
    expect(() => decryptAffiliateTaxIdentity("x".repeat(257), scope, keyring)).toThrow();
    expect(() => encryptAffiliateTaxIdentity("x".repeat(33), scope, keyring)).toThrow();
  });
});
