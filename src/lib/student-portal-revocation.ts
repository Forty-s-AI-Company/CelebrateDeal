/**
 * F-030 / F-036 learner portal revocation by stored customer key.
 *
 * A portal session stays valid only while the consumed magic-link row it was
 * minted from exists (see `isStudentPortalSessionActive` in
 * `@/lib/student-portal-auth`). Deleting the rows of one tenant/customer pair
 * therefore ends every session and every unused link of that customer.
 *
 * `revokeStudentPortalSessions(db, { vendorId, email })` in
 * `@/lib/student-portal-auth` derives the same key from an email address.
 * This variant serves flows that only hold the stored, already-derived key
 * (a commerce order's `automationCustomerKeyHash`), so they never have to
 * decrypt buyer contact data just to revoke access.
 */

import { automationCustomerKeyHash } from "@/lib/automation-workflow";

const IDENTIFIER = /^[A-Za-z0-9_-]{1,191}$/u;
const CUSTOMER_KEY = /^[A-Za-z0-9_-]{43}$/u;

export type StudentPortalRevocationStore = {
  studentPortalAccessToken: {
    deleteMany(args: { where: { vendorId: string; customerKeyHash?: string } }): Promise<{ count: number }>;
  };
};

/**
 * The portal's customer key for an email at one vendor (the same derivation
 * `revokeStudentPortalSessions` uses), or null for an unusable address, so
 * money paths can skip instead of throwing.
 */
export function studentPortalCustomerKeyForEmail(vendorId: string, email: string): string | null {
  try {
    return automationCustomerKeyHash(vendorId, email);
  } catch {
    return null;
  }
}

/** Lets money paths skip (never throw on) a legacy or malformed stored key. */
export function isStudentPortalCustomerKey(value: unknown): value is string {
  return typeof value === "string" && CUSTOMER_KEY.test(value);
}

/** Tenant-scoped: both the vendor and the customer key are part of the predicate. */
export async function revokeStudentPortalSessionsForCustomerKey(
  db: StudentPortalRevocationStore,
  input: { vendorId: string; customerKeyHash: string },
) {
  if (!IDENTIFIER.test(input.vendorId) || !CUSTOMER_KEY.test(input.customerKeyHash)) {
    throw new Error("Invalid student portal revocation scope.");
  }
  const { count } = await db.studentPortalAccessToken.deleteMany({
    where: { vendorId: input.vendorId, customerKeyHash: input.customerKeyHash },
  });
  return count;
}

/** Batch revocation of every learner of one vendor (vendor suspension). */
export async function revokeAllStudentPortalSessionsForVendor(db: StudentPortalRevocationStore, vendorId: string) {
  if (!IDENTIFIER.test(vendorId)) throw new Error("Invalid student portal revocation scope.");
  const { count } = await db.studentPortalAccessToken.deleteMany({ where: { vendorId } });
  return count;
}
