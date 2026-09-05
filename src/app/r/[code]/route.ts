import { NextResponse } from "next/server";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.trim().toUpperCase();
  const affiliate = await getDb().affiliate.findFirst({
    where: { code, isActive: true },
    select: { vendorId: true, code: true },
  });
  if (!affiliate) return NextResponse.json({ error: "Referral not found" }, { status: 404 });

  const [live, form] = await Promise.all([
    getDb().live.findFirst({
      where: {
        vendorId: affiliate.vendorId,
        OR: [{ status: { in: ["scheduled", "live"] } }, { status: "ended", replayEnabled: true }],
      },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
      select: { slug: true },
    }),
    getDb().registrationForm.findFirst({
      where: { vendorId: affiliate.vendorId, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { slug: true },
    }),
  ]);
  const path = live ? `/live/${encodeURIComponent(live.slug)}` : form ? `/form/${encodeURIComponent(form.slug)}` : "/";
  const destination = new URL(path, getCanonicalAppUrl());
  destination.searchParams.set("ref", affiliate.code);
  return NextResponse.redirect(destination);
}
