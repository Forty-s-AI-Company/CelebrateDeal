import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

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

  const parsed = AffiliateClickPayload.safeParse(await request.json());
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

  const affiliate = await getDb().affiliate.findFirst({
    where: {
      vendorId: parsed.data.vendorId,
      code: parsed.data.referralCode.toUpperCase(),
      isActive: true,
    },
  });

  await getDb().affiliateClick.create({
    data: {
      vendorId: parsed.data.vendorId,
      affiliateId: affiliate?.id ?? null,
      liveId: parsed.data.liveId ?? null,
      referralCode: parsed.data.referralCode.toUpperCase(),
      visitorId: parsed.data.visitorId,
      landingPath: parsed.data.landingPath,
    },
  });

  return NextResponse.json({ ok: true });
}
