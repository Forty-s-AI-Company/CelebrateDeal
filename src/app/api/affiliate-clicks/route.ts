import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  ATTRIBUTION_COOKIE,
  VISITOR_COOKIE,
  attributionCookieOptions,
  encodeAttributionCookie,
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
  referralCode: z.string().min(1).max(80),
  visitorId: z.string().min(1),
  landingPath: z.string().min(1),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "affiliate-clicks", 60, 60_000);
  if (limited) return limited;

  const parsed = AffiliateClickPayload.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const vendor = await getDb().vendor.findUnique({ where: { id: parsed.data.vendorId }, select: { id: true } });
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
  }

  if (parsed.data.liveId) {
    const live = await getDb().live.findFirst({
      where: { id: parsed.data.liveId, vendorId: parsed.data.vendorId },
      select: { id: true },
    });
    if (!live) {
      return NextResponse.json({ error: "Live not found" }, { status: 404 });
    }
  }

  const visitorId = visitorIdFromRequest(request);
  const referral = await resolveReferral({
    vendorId: parsed.data.vendorId,
    queryCode: referralCodeFromRequest(request),
    legacyCode: parsed.data.referralCode,
    cookie: null,
  });

  // Keep the legacy click record even when a supplied code is unknown, but never
  // turn that unverified value into team ownership or a sticky attribution cookie.
  const click = await getDb().affiliateClick.create({
    data: {
      vendorId: parsed.data.vendorId,
      affiliateId: referral?.affiliateId ?? null,
      liveId: parsed.data.liveId ?? null,
      referralCode: referral?.code ?? parsed.data.referralCode.trim().toUpperCase(),
      visitorId,
      landingPath: parsed.data.landingPath,
    },
  });

  const attribution = await resolveTeamFunnelAttribution({
    vendorId: parsed.data.vendorId,
    liveId: parsed.data.liveId ?? null,
    sourcePageSlug: sourcePageSlugFromRequest(request),
    referral,
  });
  await recordClickAttribution(click.id, attribution);

  const response = NextResponse.json({ ok: true });
  const cookieOptions = attributionCookieOptions(request);
  response.cookies.set(VISITOR_COOKIE, visitorId, cookieOptions);
  if (referral) {
    response.cookies.set(ATTRIBUTION_COOKIE, encodeAttributionCookie({ clickId: click.id, visitorId, issuedAt: Date.now() }), cookieOptions);
  }
  return response;
}
