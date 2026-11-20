import { cache } from "react";
import type { Prisma, PrismaClient } from "@prisma/client";
import { BETA_AGREEMENT_CONTEXT, BETA_AGREEMENT_VERSION } from "@/lib/beta-agreement-content";
import { getDb } from "@/lib/db";
import { safeInternalPathOr } from "@/lib/safe-internal-path";

/**
 * O-11 封測合作協議 clickwrap (owner 2026-11-20).
 *
 * Who: the agreement binds the merchant (乙方). Only an active `owner` member
 * accepts it for the vendor. Every other back-office role (admin, accountant,
 * support, legacy roles) is held at the same gate with a "waiting for the
 * owner" notice and no accept control. Partners never become a vendor
 * context, and platform administrators (甲方) are never gated.
 *
 * What counts: one `UserPolicyConsent` row with `context = beta_agreement`,
 * this vendor's id and the current `BETA_AGREEMENT_VERSION`. Any owner's
 * acceptance covers the vendor; another vendor's row never does. A new
 * version string makes every vendor accept again.
 *
 * Where: the check lives in the request guards (`requireVendorContext`,
 * `requireVendorOwner`, `requireMerchantApiActor`), so back-office pages,
 * layouts, Server Actions and merchant APIs are all held, not just the
 * layout (a layout does not stop the page segment from rendering).
 */
export { BETA_AGREEMENT_CONTEXT };
export const BETA_AGREEMENT_PATH = "/beta-agreement";
export const BETA_AGREEMENT_ACCEPT_ROLE = "owner";

type ConsentDb = Pick<PrismaClient | Prisma.TransactionClient, "userPolicyConsent">;

export function isCurrentBetaAgreementVersion(value: unknown): value is typeof BETA_AGREEMENT_VERSION {
  return value === BETA_AGREEMENT_VERSION;
}

/** Only an active owner may accept the agreement for the merchant. */
export function canAcceptBetaAgreement(member: { role: string; status: string } | null | undefined) {
  return member?.role === BETA_AGREEMENT_ACCEPT_ROLE && member.status === "active";
}

/** Platform administrators (the operator, 甲方) are never held at the gate. */
export function betaAgreementAppliesTo(auth: { isPlatformAdmin: boolean }) {
  return !auth.isPlatformAdmin;
}

/** Whether this vendor has a consent row for `version` (the current one by default). */
export async function vendorHasAcceptedBetaAgreement(db: ConsentDb, vendorId: string, version: string = BETA_AGREEMENT_VERSION) {
  const row = await db.userPolicyConsent.findFirst({
    where: { vendorId, context: BETA_AGREEMENT_CONTEXT, agreementVersion: version },
    select: { id: true },
  });
  return row !== null;
}

// One lookup per request: a page, its layouts and nested guards share it. The
// accept action reads the database directly, never through this cache.
const acceptedThisRequest = cache((vendorId: string) => vendorHasAcceptedBetaAgreement(getDb(), vendorId));

/** True when this signed-in actor must stop at the gate for `vendorId`. */
export async function betaAgreementPending(auth: { isPlatformAdmin: boolean }, vendorId: string) {
  if (!betaAgreementAppliesTo(auth)) return false;
  return !await acceptedThisRequest(vendorId);
}

/** Where to go after the gate: a safe internal path, never the gate itself. */
export function betaAgreementReturnPath(value: unknown, fallback = "/dashboard") {
  const path = safeInternalPathOr(typeof value === "string" ? value : "", fallback);
  return path === BETA_AGREEMENT_PATH || path.startsWith(`${BETA_AGREEMENT_PATH}?`) || path.startsWith(`${BETA_AGREEMENT_PATH}/`) ? fallback : path;
}

export function betaAgreementGatePath(nextPath?: string) {
  if (!nextPath) return BETA_AGREEMENT_PATH;
  const next = betaAgreementReturnPath(nextPath);
  return next === "/dashboard" ? BETA_AGREEMENT_PATH : `${BETA_AGREEMENT_PATH}?next=${encodeURIComponent(next)}`;
}

export type RecordBetaAgreementResult = "recorded" | "already_recorded";

/**
 * Writes the acceptance for `userId` and `vendorId` at the current version and
 * its audit entry in one transaction. Idempotent: a second acceptance by the
 * same user for the same vendor and version writes nothing (unique index
 * `UserPolicyConsent_user_vendor_agreement_key`; concurrent submissions
 * collapse through `skipDuplicates`). The caller has already checked that the
 * user is an active owner of `vendorId`; the membership is re-read here
 * inside the transaction so a role change in between cannot slip through.
 */
export async function recordBetaAgreementAcceptance(
  db: PrismaClient,
  input: { userId: string; vendorId: string; vendorName: string },
): Promise<RecordBetaAgreementResult | "not_owner"> {
  return db.$transaction(async (tx) => {
    const owner = await tx.vendorMember.findFirst({
      where: { vendorId: input.vendorId, userId: input.userId, role: BETA_AGREEMENT_ACCEPT_ROLE, status: "active" },
      select: { id: true },
    });
    if (!owner) return "not_owner" as const;
    const created = await tx.userPolicyConsent.createMany({
      data: [{ userId: input.userId, vendorId: input.vendorId, context: BETA_AGREEMENT_CONTEXT, agreementVersion: BETA_AGREEMENT_VERSION }],
      skipDuplicates: true,
    });
    if (created.count === 0) return "already_recorded" as const;
    await tx.auditLog.create({
      data: {
        vendorId: input.vendorId,
        actorId: input.userId,
        actorLabel: "owner",
        action: "beta_agreement_accepted",
        targetType: "Vendor",
        targetId: input.vendorId,
        // The vendor name shown as 乙方 at the time; the account is actorId.
        after: { agreementVersion: BETA_AGREEMENT_VERSION, vendorName: input.vendorName },
      },
    });
    return "recorded" as const;
  });
}
