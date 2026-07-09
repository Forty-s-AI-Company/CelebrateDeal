import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";

const AffiliateClickPayload = z.object({
  vendorId: z.string().min(1),
  liveId: z.string().nullable().optional(),
  referralCode: z.string().min(1).max(80),
  visitorId: z.string().min(1),
  landingPath: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = AffiliateClickPayload.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
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
