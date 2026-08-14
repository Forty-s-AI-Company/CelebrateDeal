import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { allowsLegacyAffiliateAttribution, defaultAffiliateCode } from "@/lib/live-quota-policy";
import {
  ATTRIBUTION_COOKIE,
  VISITOR_COOKIE,
  attributionCookieOptions,
  encodeAttributionCookie,
  liveShareCodeFromRequest,
  recordClickAttribution,
  referralCodeFromRequest,
  resolveReferral,
  resolveTeamFunnelAttribution,
  sourcePageSlugFromRequest,
  visitorIdFromRequest,
} from "@/lib/team-funnel-attribution";

const AffiliateClickPayload = z.object({
  vendorId: z.string().min(1),
  liveId: z.string().nullable().optional(),
  referralCode: z.string().min(1).max(80).optional(),
  shareCode: z.string().regex(/^tls1\.[A-Za-z0-9_-]{32,155}$/u).max(160).optional(),
  visitorId: z.string().min(1),
  landingPath: z.string().min(1),
});

async function loadLiveQuotaPolicy(vendorId: string, liveId: string | null) {
  if (!liveId) return { found: true, quotaPolicy: null as unknown };

  const live = await getDb().live.findFirst({
    where: {
      id: liveId,
      vendorId,
      OR: [
        { status: { in: ["scheduled", "live"] } },
        { status: "ended", replayEnabled: true },
      ],
    },
    select: { id: true, quotaPolicy: true },
  });
  return live ? { found: true, quotaPolicy: live.quotaPolicy } : { found: false, quotaPolicy: null as unknown };
}

async function resolveClickContext({
  request,
  vendorId,
  liveId,
  referralCode,
  liveShareCode,
  sourcePageSlug,
  liveQuotaPolicy,
}: {
  request: Request;
  vendorId: string;
  liveId: string | null;
  referralCode: string | undefined;
  liveShareCode: string | null;
  sourcePageSlug: string | null;
  liveQuotaPolicy: unknown;
}) {
  const legacyAffiliateEnabled = !liveId || allowsLegacyAffiliateAttribution(liveQuotaPolicy);
  const requestedReferralCode = legacyAffiliateEnabled && !liveShareCode
    ? referralCodeFromRequest(request)
    : null;
  const defaultReferralCode = legacyAffiliateEnabled && !sourcePageSlug && !liveShareCode
    ? defaultAffiliateCode(liveQuotaPolicy)
    : null;
  if (!requestedReferralCode && !referralCode && !defaultReferralCode && !sourcePageSlug && !liveShareCode) {
    return { invalid: true as const, referral: null, shareAttribution: null, shareAffiliateId: null, legacyAffiliateEnabled };
  }

  const referral = await resolveReferral({
    vendorId,
    queryCode: requestedReferralCode,
    legacyCode: legacyAffiliateEnabled && !liveShareCode ? referralCode ?? defaultReferralCode : null,
    cookie: null,
  });
  const shareAttribution = liveShareCode
    ? await resolveTeamFunnelAttribution({
        vendorId,
        liveId,
        sourcePageSlug: null,
        liveShareCode,
        referral: null,
      })
    : null;
  if (liveShareCode && !shareAttribution) {
    return { invalid: true as const, referral, shareAttribution: null, shareAffiliateId: null, legacyAffiliateEnabled };
  }

  const shareAffiliate = shareAttribution?.referralCode
    ? await getDb().affiliate.findFirst({
        where: { vendorId, code: shareAttribution.referralCode, isActive: true },
        select: { id: true },
      })
    : null;

  return {
    invalid: false as const,
    referral,
    shareAttribution,
    shareAffiliateId: shareAffiliate?.id ?? null,
    legacyAffiliateEnabled,
  };
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "affiliate-clicks", 60, 60_000);
  if (limited) return limited;

  const parsed = AffiliateClickPayload.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const sourcePageSlug = sourcePageSlugFromRequest(request);
  const liveShareCode = parsed.data.shareCode ?? liveShareCodeFromRequest(request);

  const vendor = await getDb().vendor.findUnique({ where: { id: parsed.data.vendorId }, select: { id: true } });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
  }

  const liveContext = await loadLiveQuotaPolicy(parsed.data.vendorId, parsed.data.liveId ?? null);
  if (!liveContext.found) {
    return NextResponse.json({ error: "Live not found" }, { status: 404 });
  }

  const clickContext = await resolveClickContext({
    request,
    vendorId: parsed.data.vendorId,
    liveId: parsed.data.liveId ?? null,
    referralCode: parsed.data.referralCode,
    liveShareCode,
    sourcePageSlug,
    liveQuotaPolicy: liveContext.quotaPolicy,
  });
  if (clickContext.invalid) {
    return NextResponse.json({ error: "Referral or source page is required" }, { status: 400 });
  }
  const visitorId = visitorIdFromRequest(request);

  // Keep the legacy click record even when a supplied code is unknown, but never
  // turn that unverified value into team ownership or a sticky attribution cookie.
  const click = await getDb().affiliateClick.create({
    data: {
      vendorId: parsed.data.vendorId,
      affiliateId: clickContext.referral?.affiliateId ?? clickContext.shareAffiliateId,
      liveId: parsed.data.liveId ?? null,
      referralCode: clickContext.referral?.code ?? clickContext.shareAttribution?.referralCode ?? (clickContext.legacyAffiliateEnabled ? parsed.data.referralCode?.trim().toUpperCase() ?? null : null),
      visitorId,
      landingPath: safeLandingPath(parsed.data.landingPath),
    },
  });

  const attribution = clickContext.shareAttribution ?? await resolveTeamFunnelAttribution({
    vendorId: parsed.data.vendorId,
    liveId: parsed.data.liveId ?? null,
    sourcePageSlug,
    referral: clickContext.referral,
  });
  await recordClickAttribution(click.id, attribution);

  const response = NextResponse.json({ ok: true });
  const cookieOptions = attributionCookieOptions(request);
  response.cookies.set(VISITOR_COOKIE, visitorId, cookieOptions);
  // A verified Live share can carry the promoter's active affiliate identity
  // even when there is no legacy referral query. Keep that server-owned click
  // sticky for the later checkout, otherwise the lead is attributed but the
  // purchase loses the same promoter lineage.
  const stickyReferralCode = clickContext.referral?.code ?? clickContext.shareAttribution?.referralCode;
  const hasVerifiedAffiliate = Boolean(stickyReferralCode && (clickContext.referral || clickContext.shareAffiliateId));
  if (hasVerifiedAffiliate || attribution) {
    try {
      response.cookies.set(ATTRIBUTION_COOKIE, encodeAttributionCookie({ clickId: click.id, visitorId, issuedAt: Date.now() }), cookieOptions);
    } catch {
      // A missing/invalid signing key must not break public navigation. The
      // server click remains recorded, but no forgeable sticky cookie is sent.
    }
  }
  return response;
}

function safeLandingPath(value: string) {
  try {
    const url = new URL(value, "https://landing.invalid");
    url.searchParams.delete("share");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value.slice(0, 2_048);
  }
}
