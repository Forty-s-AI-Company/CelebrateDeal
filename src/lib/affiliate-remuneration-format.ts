/** Signed remuneration and manual payment confirmations must preserve every cent. */
export function formatAffiliateRemuneration(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Invalid remuneration cents");
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}
