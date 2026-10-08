import { z } from "zod";
import { decryptBankAccount, encryptBankAccount, loadRuntimeBankAccountKeyring, type BankAccountKeyring } from "./bank-account";

const Identity = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/u);
const Scope = z.object({ vendorId: Identity, affiliateId: Identity }).strict();
const Details = z.object({
  accountName: z.string().trim().min(1).max(120),
  bankCode: z.string().regex(/^\d{3}$/u),
  accountNumber: z.string().regex(/^\d{6,20}$/u),
}).strict();
export type AffiliateBankScope = z.infer<typeof Scope>;

/** Callers must derive scope from authorized database rows. Both identities
 * and the affiliate-only purpose are authenticated by the existing keyring. */
export function encryptAffiliateBankAccount(raw: unknown, scope: AffiliateBankScope, keyring: BankAccountKeyring = loadRuntimeBankAccountKeyring()) {
  const identity = Scope.parse(scope);
  return encryptBankAccount(Details.parse(raw), identity.vendorId, keyring, { affiliateId: identity.affiliateId });
}

export function decryptAffiliateBankAccount(envelope: string, scope: AffiliateBankScope, keyring: BankAccountKeyring = loadRuntimeBankAccountKeyring()) {
  const identity = Scope.parse(scope);
  return Details.parse(decryptBankAccount(envelope, identity.vendorId, keyring, { affiliateId: identity.affiliateId }));
}

/** Re-encryption always authenticates the original scope first. A merchant
 * bank envelope cannot be upgraded into an affiliate payee envelope. */
export function rotateAffiliateBankAccount(envelope: string, scope: AffiliateBankScope, keyring: BankAccountKeyring = loadRuntimeBankAccountKeyring()) {
  const details = decryptAffiliateBankAccount(envelope, scope, keyring);
  if (envelope.split(".")[1] === keyring.activeKeyId) return envelope;
  return encryptAffiliateBankAccount(details, scope, keyring);
}
