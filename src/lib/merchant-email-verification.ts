import type { PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { consumeAccountRateLimit } from "@/lib/account-rate-limit";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { sendMerchantEmailVerificationEmail, TransactionalEmailError } from "@/lib/email";
import {
  createMerchantEmailVerificationToken,
  MERCHANT_EMAIL_VERIFICATION_TTL_HOURS,
  merchantEmailVerificationUrl,
  verifyMerchantEmailVerificationToken,
} from "@/lib/merchant-email-verification-token";

/**
 * Merchant email verification (owner decision 2026-10-25).
 *
 * `User.emailVerifiedAt` is set only when the platform e-mailed a link to the
 * account's current address and the link was opened: the signed link sent
 * here, an accepted vendor member invitation, or a completed password reset.
 * Registration invites are bearer links an administrator hands out, so they
 * prove nothing about the mailbox.
 *
 * Unverified accounts keep working (login, dashboard, published pages). Only
 * new independent audience publishes require the vendor's owner to be
 * verified (see `vendorOwnerEmailVerified` and independent-publish-limit.ts).
 */

export type MerchantEmailVerificationSource = "registration" | "resend";

export type MerchantEmailVerificationSendResult =
  | { status: "sent"; expiresAt: Date }
  | { status: "already_verified" }
  | { status: "ineligible" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "failed" };

type UserReader = Pick<PrismaClient, "user">;

/**
 * Sends a fresh verification link to the user's stored address. The user id
 * comes from the caller's authenticated session or the just-committed
 * registration, never from client input. Every send, including the one at
 * registration, counts against the per-recipient account limit. Never throws.
 */
export async function sendMerchantEmailVerification(input: {
  userId: string;
  source: MerchantEmailVerificationSource;
  vendorId?: string | null;
  db?: UserReader;
}): Promise<MerchantEmailVerificationSendResult> {
  try {
    const user = await (input.db ?? getDb()).user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, status: true, emailVerifiedAt: true },
    });
    if (!user || user.status !== "active") return { status: "ineligible" };
    if (user.emailVerifiedAt) return { status: "already_verified" };

    const decision = await consumeAccountRateLimit("merchant_email_verification", user.email);
    if (!decision.allowed) {
      await writeAuditLog({
        vendorId: input.vendorId ?? null,
        actorId: user.id,
        actorLabel: "system",
        action: "merchant_email_verification_suppressed",
        targetType: "User",
        targetId: user.id,
        after: auditSnapshot({ source: input.source, reason: "recipient_rate_limited" }),
      }).catch(() => undefined);
      return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
    }

    const link = createMerchantEmailVerificationToken({ userId: user.id, email: user.email });
    try {
      await sendMerchantEmailVerificationEmail({
        to: user.email,
        verifyUrl: merchantEmailVerificationUrl(link.token),
        validHours: MERCHANT_EMAIL_VERIFICATION_TTL_HOURS,
        idempotencyKey: `merchant-email-verification:${link.jti}`,
      });
    } catch (error) {
      await writeAuditLog({
        vendorId: input.vendorId ?? null,
        actorId: user.id,
        actorLabel: "system",
        action: "merchant_email_verification_email_failed",
        targetType: "User",
        targetId: user.id,
        after: auditSnapshot({ source: input.source, jti: link.jti, errorCode: error instanceof TransactionalEmailError ? error.code : "unknown" }),
      }).catch(() => undefined);
      return { status: "failed" };
    }
    // The audit row never holds the token or the link, only its id.
    await writeAuditLog({
      vendorId: input.vendorId ?? null,
      actorId: user.id,
      actorLabel: "system",
      action: "merchant_email_verification_sent",
      targetType: "User",
      targetId: user.id,
      after: auditSnapshot({ source: input.source, jti: link.jti, expiresAt: link.expiresAt.toISOString() }),
    }).catch(() => undefined);
    return { status: "sent", expiresAt: link.expiresAt };
  } catch {
    // Rate-limit counter or database unavailable: nothing was sent.
    return { status: "failed" };
  }
}

/** Sends the first verification link after the registration response. */
export function scheduleMerchantEmailVerification(input: { userId: string; vendorId: string }) {
  after(async () => {
    await sendMerchantEmailVerification({ ...input, source: "registration" });
  });
}

export type MerchantEmailVerificationConfirmation = { status: "verified" | "already_verified" | "invalid" };

/**
 * Applies a verification link. The user id and address come only from the
 * signed token, and the final update is bound to both, so a link sent to an
 * earlier address, to another account or to a suspended account changes
 * nothing. Idempotent: opening a link again reports `already_verified`.
 */
export async function confirmMerchantEmailVerification(token: unknown, now = new Date()): Promise<MerchantEmailVerificationConfirmation> {
  const claim = verifyMerchantEmailVerificationToken(token, now);
  if (!claim) return { status: "invalid" };
  const db = getDb();
  const updated = await db.user.updateMany({
    where: { id: claim.userId, email: claim.email, status: "active", emailVerifiedAt: null },
    data: { emailVerifiedAt: now },
  });
  if (updated.count === 1) {
    await writeAuditLog({
      actorId: claim.userId,
      actorLabel: "email_verification",
      action: "merchant_email_verified",
      targetType: "User",
      targetId: claim.userId,
      after: auditSnapshot({ method: "verification_link", jti: claim.jti }),
    }).catch(() => undefined);
    return { status: "verified" };
  }
  const current = await db.user.findFirst({
    where: { id: claim.userId, email: claim.email, status: "active" },
    select: { emailVerifiedAt: true },
  });
  return { status: current?.emailVerifiedAt ? "already_verified" : "invalid" };
}

type VendorVerificationReader = Pick<PrismaClient, "vendor" | "user" | "vendorMember">;

/**
 * Whether the vendor counts as email-verified for abuse-sensitive actions.
 *
 * The vendor's founding account is the user whose address equals
 * `Vendor.email` (registration creates both with the same address, and both
 * columns are unique). When it exists, it alone decides: one verified mailbox
 * can verify at most one vendor, so inviting a verified co-owner into many
 * throwaway workspaces does not lift their limits. A vendor without such an
 * account (created outside /register) counts as verified when one of its
 * active owners is verified.
 */
export async function vendorOwnerEmailVerified(database: VendorVerificationReader, vendorId: string) {
  const vendor = await database.vendor.findUnique({ where: { id: vendorId }, select: { email: true } });
  if (!vendor) return false;
  const founder = await database.user.findUnique({ where: { email: vendor.email }, select: { emailVerifiedAt: true } });
  if (founder) return founder.emailVerifiedAt !== null;
  const verifiedOwner = await database.vendorMember.findFirst({
    where: { vendorId, role: "owner", status: "active", user: { status: "active", emailVerifiedAt: { not: null } } },
    select: { id: true },
  });
  return Boolean(verifiedOwner);
}
