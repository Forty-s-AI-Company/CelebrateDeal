export type PayoutAccountCandidate = {
  mode: string;
  status: string;
  bankAccountEncrypted?: string | null;
  bankAccountLegacyName?: string | null;
  bankCodeLegacy?: string | null;
  bankAccountLegacyNumber?: string | null;
};

export class PayoutAccountSelectionError extends Error {
  constructor() {
    super("Exactly one active platform payout account is required.");
    this.name = "PayoutAccountSelectionError";
  }
}

function hasText(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isEligiblePayoutAccount(account: PayoutAccountCandidate) {
  if (account.mode !== "platform" || account.status !== "active") return false;

  const hasEncryptedAccount = hasText(account.bankAccountEncrypted);
  const hasCompleteLegacyAccount =
    hasText(account.bankAccountLegacyName)
    && hasText(account.bankCodeLegacy)
    && hasText(account.bankAccountLegacyNumber);

  return hasEncryptedAccount || hasCompleteLegacyAccount;
}

export function selectPayoutAccount<T extends PayoutAccountCandidate>(accounts: readonly T[]): T {
  const activePlatformAccounts = accounts.filter(
    (account) => account.mode === "platform" && account.status === "active",
  );
  if (activePlatformAccounts.length !== 1) throw new PayoutAccountSelectionError();

  const account = activePlatformAccounts[0]!;
  if (!isEligiblePayoutAccount(account)) throw new PayoutAccountSelectionError();
  return account;
}
