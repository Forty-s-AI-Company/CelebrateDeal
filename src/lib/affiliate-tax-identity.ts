import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { BankAccountEncryptionError, loadRuntimeBankAccountKeyring, type BankAccountKeyring } from "./bank-account";
import type { AffiliateBankScope } from "./affiliate-bank-account";
const Scope = z.object({ vendorId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u), affiliateId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u) }).strict();
// This validates the declaration format only. Residency/exemption/invoice
// eligibility still requires merchant review of an exact profile revision.
const Identity = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{6,32}$/u);
function aad(scope: AffiliateBankScope, keyId: string) {
  const value = Scope.parse(scope);
  return Buffer.from(JSON.stringify(["affiliate-tax-identity", "v1", value.vendorId, value.affiliateId, keyId]), "utf8");
}
export function encryptAffiliateTaxIdentity(raw: unknown, scope: AffiliateBankScope, keyring: BankAccountKeyring = loadRuntimeBankAccountKeyring()) {
  const identity = Identity.parse(raw);
  const key = keyring.keys.get(keyring.activeKeyId);
  if (!key) throw new BankAccountEncryptionError("keyring_unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(scope, keyring.activeKeyId));
  const encrypted = Buffer.concat([cipher.update(identity, "utf8"), cipher.final()]);
  return ["tax1", keyring.activeKeyId, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptAffiliateTaxIdentity(envelope: string, scope: AffiliateBankScope, keyring: BankAccountKeyring = loadRuntimeBankAccountKeyring()) {
  try {
    if (envelope.length > 256) throw new Error();
    const parts = envelope.split(".");
    if (parts.length !== 5 || parts[0] !== "tax1") throw new Error();
    const [, keyId, nonce, tag, data] = parts;
    if (!keyId || !nonce || !tag || !data) throw new Error();
    const key = keyring.keys.get(keyId);
    if (!key || (keyId !== keyring.activeKeyId && !keyring.decryptOnlyKeyIds.has(keyId))) throw new Error();
    const decoded = [nonce, tag, data].map(part => {
      if (!/^[A-Za-z0-9_-]+$/u.test(part)) throw new Error();
      const buffer = Buffer.from(part, "base64url");
      if (buffer.toString("base64url") !== part) throw new Error();
      return buffer;
    });
    if (decoded[0]!.length !== 12 || decoded[1]!.length !== 16 || decoded[2]!.length < 6 || decoded[2]!.length > 32) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, decoded[0]!);
    decipher.setAAD(aad(scope, keyId));
    decipher.setAuthTag(decoded[1]!);
    return Identity.parse(Buffer.concat([decipher.update(decoded[2]!), decipher.final()]).toString("utf8"));
  } catch {
    // Never return envelope, identity or cryptographic diagnostics to callers.
    throw new BankAccountEncryptionError("authentication_failed");
  }
}
