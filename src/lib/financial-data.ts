export function maskBankAccount(accountNumber: string | null | undefined) {
  if (!accountNumber) return "未設定";
  const compact = accountNumber.replace(/\s+/g, "");
  if (compact.length <= 4) return `****${compact}`;
  return `${"*".repeat(Math.min(8, compact.length - 4))}${compact.slice(-4)}`;
}

export function safeCsvCell(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

const PAYOUT_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  pending: new Set(["paid", "failed"]),
  failed: new Set(["retrying"]),
  retrying: new Set(["paid", "failed"]),
};

export function canTransitionPayoutItem(currentStatus: string, nextStatus: string) {
  return PAYOUT_TRANSITIONS[currentStatus]?.has(nextStatus) ?? false;
}

export function isValidRefundAmount(grossAmountCents: number, refundedAmountCents: number, requestedAmountCents: number) {
  return requestedAmountCents > 0 && requestedAmountCents <= grossAmountCents - refundedAmountCents;
}
