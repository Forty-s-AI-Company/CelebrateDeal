import { getCanonicalAppUrl } from "@/lib/app-url";
import { studentPortalVoucherFieldsReady, studentPortalVoucherProductWhere } from "@/lib/student-portal-voucher";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { readFormDataBody, requireSameOriginRequest } from "@/lib/api-security";
import { CSRF_FIELD_NAME, verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { hashInteractionBearer } from "@/lib/live-interaction";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

export async function POST(request: Request, { params }: { params: Promise<{ vendorSlug: string; voucherId: string }> }) {
  const boundary = requireSameOriginRequest(request);
  if (boundary) return boundary;
  const formData = await readFormDataBody(request, 4 * 1024);
  const csrf = formData?.get(CSRF_FIELD_NAME);
  if (typeof csrf !== "string" || !await verifyCsrfToken(csrf)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const { vendorSlug, voucherId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  const now = new Date();
  const db = getDb();
  const where = { id: voucherId, vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, redeemedAt: null, usedOrderId: null, expiresAt: { gt: now }, product: { is: studentPortalVoucherProductWhere(session.vendorId) } };
  const unavailable = () => NextResponse.redirect(new URL(`/portal/${encodeURIComponent(vendorSlug)}?voucher=unavailable`, getCanonicalAppUrl()), { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  const voucher = await db.automationVoucherGrant.findFirst({ where, select: { currency: true, product: { select: { currency: true, customCheckoutFields: true } } } });
  if (!voucher || voucher.currency !== voucher.product.currency || !studentPortalVoucherFieldsReady(voucher.product.customCheckoutFields)) return unavailable();
  const bearer = randomBytes(32).toString("base64url");
  const updated = await db.automationVoucherGrant.updateMany({
    where: { ...where, currency: voucher.currency, product: { is: { ...studentPortalVoucherProductWhere(session.vendorId), currency: voucher.currency } } },
    data: { claimTokenHash: hashInteractionBearer(bearer) },
  });
  if (updated.count !== 1) return unavailable();
  const destination = new URL("/api/automation/vouchers/redeem", getCanonicalAppUrl());
  destination.searchParams.set("token", bearer);
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
