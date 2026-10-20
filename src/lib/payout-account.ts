export type PayoutAccountCandidate = {
  mode: string;
  status: string;
  bankAccountEncrypted?: string | null;
  bankAccountLegacyName?: string | null;
  bankCodeLegacy?: string | null;
  bankAccountLegacyNumber?: string | null;
  payoutEligibleAt?: Date | null;
};

/**
 * F-073: a merchant-entered (or changed) payout account waits in this status
 * until `payoutEligibleAt` (24 hours after the change) before any payout batch
 * may use it. The owners are e-mailed at the time of the change.
 */
export const PAYOUT_ACCOUNT_PENDING_STATUS = "pending_verification";
export const PAYOUT_ACCOUNT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PAYOUT_CANDIDATE_STATUSES = new Set(["active", PAYOUT_ACCOUNT_PENDING_STATUS]);

export class PayoutAccountSelectionError extends Error {
  constructor() {
    super("Exactly one active platform payout account is required.");
    this.name = "PayoutAccountSelectionError";
  }
}

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function payoutStatusAllows(account: PayoutAccountCandidate, now: Date) {
  if (account.status === "active") return true;
  return account.status === PAYOUT_ACCOUNT_PENDING_STATUS
    && account.payoutEligibleAt instanceof Date
    && account.payoutEligibleAt.getTime() <= now.getTime();
}

export function isEligiblePayoutAccount(account: PayoutAccountCandidate, now = new Date()) {
  if (account.mode !== "platform" || !payoutStatusAllows(account, now)) return false;

  const hasEncryptedAccount = hasText(account.bankAccountEncrypted);
  // Legacy columns are only usable before the encryption backfill. Once a row
  // holds the masked display value ("****1234", enforced for new writes by
  // PaymentAccount_bankAccountNumber_masked_check), it cannot pay anyone.
  const hasCompleteLegacyAccount =
    hasText(account.bankAccountLegacyName)
    && hasText(account.bankCodeLegacy)
    && hasText(account.bankAccountLegacyNumber)
    && !account.bankAccountLegacyNumber!.trim().startsWith("****");

  return hasEncryptedAccount || hasCompleteLegacyAccount;
}

export function selectPayoutAccount<T extends PayoutAccountCandidate>(accounts: readonly T[], now = new Date()): T {
  // A recently changed account still counts here, so it can never be skipped
  // in favour of an older one: it blocks payouts until its cooldown ends.
  const candidates = accounts.filter(
    (account) => account.mode === "platform" && PAYOUT_CANDIDATE_STATUSES.has(account.status),
  );
  if (candidates.length !== 1) throw new PayoutAccountSelectionError();

  const account = candidates[0]!;
  if (!isEligiblePayoutAccount(account, now)) throw new PayoutAccountSelectionError();
  return account;
}
