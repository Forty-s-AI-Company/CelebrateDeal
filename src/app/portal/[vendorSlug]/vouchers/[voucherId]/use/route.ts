import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hashInteractionBearer } from "@/lib/live-interaction";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

export async function GET(request: Request, { params }: { params: Promise<{ vendorSlug: string; voucherId: string }> }) {
  const { vendorSlug, voucherId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  const now = new Date();
  const bearer = randomBytes(32).toString("base64url");
  const updated = await getDb().automationVoucherGrant.updateMany({
    where: { id: voucherId, vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, redeemedAt: null, usedOrderId: null, expiresAt: { gt: now } },
    data: { claimTokenHash: hashInteractionBearer(bearer) },
  });
  if (updated.count !== 1) return NextResponse.redirect(new URL(`/portal/${encodeURIComponent(vendorSlug)}?voucher=unavailable`, request.url), 303);
  const destination = new URL("/api/automation/vouchers/redeem", request.url);
  destination.searchParams.set("token", bearer);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
