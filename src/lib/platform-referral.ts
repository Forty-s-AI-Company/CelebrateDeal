import { Prisma } from "@prisma/client";

export const PLATFORM_REFERRAL_COOKIE = "celebratedeal_platform_referral";
export const PLATFORM_REFERRAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function platformReferralCookieOptions(request: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: Math.floor(PLATFORM_REFERRAL_TTL_MS / 1000),
  };
}

type PlatformReferralDb = Pick<
  Prisma.TransactionClient,
  "platformReferralCode" | "platformReferralClick" | "platformReferralAttribution"
>;

export async function recordPlatformReferralClick(
  db: PlatformReferralDb,
  input: { code: string; visitorId: string; landingPath: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const code = await db.platformReferralCode.findFirst({
    where: { code: input.code, isActive: true },
    select: { id: true },
  });
  if (!code) return null;

  return db.platformReferralClick.create({
    data: {
      referralCodeId: code.id,
      visitorId: input.visitorId,
      landingPath: input.landingPath,
      expiresAt: new Date(now.getTime() + PLATFORM_REFERRAL_TTL_MS),
    },
  });
}

/**
 * Captures only server-validated referral facts. This is attribution evidence,
 * not a commission accrual: a plan selection has no payment proof yet.
 */
export async function capturePlatformReferralAttribution(
  db: PlatformReferralDb,
  input: { clickId: string | null | undefined; subscriptionId: string; capturedAt?: Date },
) {
  if (!input.clickId) return null;
  const capturedAt = input.capturedAt ?? new Date();
  const click = await db.platformReferralClick.findUnique({
    where: { id: input.clickId },
    include: {
      referralCode: {
        select: { id: true, code: true, ownerUserId: true, commissionRateBps: true, isActive: true },
      },
    },
  });
  if (
    !click
    || !click.referralCode.isActive
    || click.expiresAt <= capturedAt
    || !Number.isSafeInteger(click.referralCode.commissionRateBps)
    || click.referralCode.commissionRateBps < 0
    || click.referralCode.commissionRateBps > 10_000
  ) return null;

  return db.platformReferralAttribution.upsert({
    where: { subscriptionId: input.subscriptionId },
    create: {
      referralCodeId: click.referralCode.id,
      clickId: click.id,
      subscriptionId: input.subscriptionId,
      ownerUserId: click.referralCode.ownerUserId,
      codeSnapshot: click.referralCode.code,
      commissionRateBpsSnapshot: click.referralCode.commissionRateBps,
    },
    update: {},
  });
}
