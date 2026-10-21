import { formatTwd } from "@/lib/format";

/** Signed remuneration and manual payment confirmations must preserve every cent. */
export function formatAffiliateRemuneration(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new RangeError("Invalid remuneration cents");
  return formatTwd(cents, { fractionDigits: 2 });
}
