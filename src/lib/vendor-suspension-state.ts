/**
 * F-036 (B02-14) pure suspension predicates. No Next.js, auth or database
 * imports: the `/lp` proxy, `vendor-roles` and client-safe modules use this
 * file; server helpers and the suspend/resume transactions live in
 * `@/lib/vendor-suspension`, which re-exports everything here.
 */

export const VENDOR_SUSPENDED_PATH = "/vendor-suspended";
export const VENDOR_SUSPENDED_CODE = "VENDOR_SUSPENDED";
/** Mirrors the `Vendor_suspension_check` constraint (trimmed, 1-500 characters). */
export const VENDOR_SUSPENSION_REASON_MAX_LENGTH = 500;

/** `suspendedAt` is required so a caller cannot forget to select it and fail open. */
export type VendorSuspensionState = { suspendedAt: Date | null };

export function isVendorSuspended(vendor: VendorSuspensionState | null | undefined): boolean {
  return vendor?.suspendedAt instanceof Date;
}

/** Vendor filter for every buyer, viewer and learner read. */
export const ACTIVE_VENDOR_WHERE = { suspendedAt: null } as const;

/** Spread into the where input of any model with a required `vendor` relation. */
export const ACTIVE_VENDOR_RELATION = { vendor: { is: ACTIVE_VENDOR_WHERE } } as const;

/** The narrow reader both a PrismaClient and a transaction client satisfy. */
export type VendorReader = {
  vendor: {
    findFirst(args: { where: { id: string; suspendedAt: null }; select: { id: true } }): Promise<{ id: string } | null>;
    findUnique(args: { where: { id: string }; select: { suspendedAt: true } }): Promise<{ suspendedAt: Date | null } | null>;
  };
};

/** Public entry points that only know a vendor id. Unknown and suspended vendors are both "not available". */
export async function isVendorAvailableForPublic(db: VendorReader, vendorId: string): Promise<boolean> {
  if (typeof vendorId !== "string" || vendorId.length === 0 || vendorId.length > 128) return false;
  const vendor = await db.vendor.findFirst({ where: { id: vendorId, ...ACTIVE_VENDOR_WHERE }, select: { id: true } });
  return Boolean(vendor);
}

/** Send-time check for jobs: an unknown vendor is not "suspended" (its rows fail elsewhere). */
export async function isVendorSuspendedById(db: VendorReader, vendorId: string): Promise<boolean> {
  const vendor = await db.vendor.findUnique({ where: { id: vendorId }, select: { suspendedAt: true } });
  return isVendorSuspended(vendor);
}
