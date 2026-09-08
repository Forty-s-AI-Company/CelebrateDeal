import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBankAccountKeyring } from "@/lib/bank-account";
import { decryptTaxIdentity, encryptTaxIdentity, maskTaxIdentity } from "@/lib/tax-identity";

describe("affiliate tax identity encryption", () => {
  const keyring = createBankAccountKeyring({
    activeKeyId: "tax-test",
    keys: { "tax-test": randomBytes(32).toString("base64url") },
  });

  it("stores a tenant-bound authenticated envelope without plaintext", () => {
    const envelope = encryptTaxIdentity("A123456789", "vendor-a", keyring);
    expect(envelope).not.toContain("A123456789");
    expect(decryptTaxIdentity(envelope, "vendor-a", keyring)).toBe("A123456789");
    expect(() => decryptTaxIdentity(envelope, "vendor-b", keyring)).toThrow();
  });

  it("validates and masks the identity", () => {
    expect(maskTaxIdentity("a123456789")).toBe("A1*****789");
    expect(() => encryptTaxIdentity("not-an-id", "vendor-a", keyring)).toThrow("Invalid Taiwan tax identity");
  });
});
