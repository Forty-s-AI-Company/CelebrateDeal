import { normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";

type EmailBlacklistReader = {
  blacklist: {
    findFirst(args: {
      where: { vendorId: string; identifierType: "email"; identifier: string; isActive: true; unblockedAt: null };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/**
 * Whether this vendor's merchant blacklist currently blocks the email. Always
 * tenant-scoped: another vendor's list never applies. An address that does
 * not normalize cannot be on the list (the list only stores normalized ones).
 */
export async function isEmailBlacklistedForVendor(db: EmailBlacklistReader, vendorId: string, email: string) {
  const identifier = normalizeBlacklistIdentifier("email", email);
  if (!vendorId || !identifier) return false;
  const row = await db.blacklist.findFirst({
    where: { vendorId, identifierType: "email", identifier, isActive: true, unblockedAt: null },
    select: { id: true },
  });
  return Boolean(row);
}
