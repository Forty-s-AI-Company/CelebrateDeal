import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  attributionCookieName,
  normalizeAttributionPolicy,
  normalizeAttributionWindowDays,
  resolveRequestAttribution,
  signAttributionToken,
} from "@/lib/attribution";

const AffiliateClickPayload = z.object({
  vendorId: z.string().min(1),
  liveId: z.string().nullable().optional(),
  referralCode: z.string().min(1).max(80),
  visitorId: z.string().min(1),
  landingPath: z.string().min(1).refine((value) => value.startsWith("/") && !value.startsWith("//")),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "affiliate-clicks", 60, 60_000);
  if (limited) return limited;

  const parsed = AffiliateClickPayload.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const vendor = await getDb().vendor.findUnique({
    where: { id: parsed.data.vendorId },
    select: {
      id: true,
      tracking: { select: { attributionPolicy: true, attributionWindowDays: true } },
    },
  });
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

  const affiliate = await getDb().affiliate.findFirst({
    where: {
      vendorId: parsed.data.vendorId,
      code: parsed.data.referralCode.toUpperCase(),
      isActive: true,
    },
  });

  if (!affiliate) {
    return NextResponse.json({ error: "Referral not available" }, { status: 404 });
  }

  const policy = normalizeAttributionPolicy(vendor.tracking?.attributionPolicy);
  const windowDays = normalizeAttributionWindowDays(vendor.tracking?.attributionWindowDays);
  const preservedAttribution = policy === "first_touch"
    ? await resolveRequestAttribution(request, vendor.id)
    : null;

  const click = await getDb().affiliateClick.create({
    data: {
      vendorId: parsed.data.vendorId,
      affiliateId: affiliate.id,
      liveId: parsed.data.liveId ?? null,
      referralCode: parsed.data.referralCode.toUpperCase(),
      visitorId: parsed.data.visitorId,
      landingPath: parsed.data.landingPath,
    },
  });

  if (preservedAttribution) {
    return NextResponse.json({ ok: true, attribution: "first_touch_preserved" });
  }

  let token: string;
  try {
    token = signAttributionToken(
      { vendorId: parsed.data.vendorId, clickId: click.id, affiliateId: affiliate.id },
      { ttlSeconds: windowDays * 24 * 60 * 60 },
    );
  } catch {
    await getDb().affiliateClick.deleteMany({ where: { id: click.id } });
    return NextResponse.json({ error: "Attribution service is not configured" }, { status: 503 });
  }
  const response = NextResponse.json({ ok: true, attribution: "accepted" });
  response.cookies.set(attributionCookieName(parsed.data.vendorId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: windowDays * 24 * 60 * 60,
  });
  return response;
}
