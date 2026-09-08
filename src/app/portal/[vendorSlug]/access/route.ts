import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  consumeStudentPortalAccessToken,
  setStudentPortalSessionCookie,
  type StudentPortalAccessTokenPurpose,
  verifyStudentPortalAccessToken,
} from "@/lib/student-portal-auth";

export async function GET(request: Request, { params }: { params: Promise<{ vendorSlug: string }> }) {
  const { vendorSlug } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const purpose: StudentPortalAccessTokenPurpose = url.searchParams.get("purpose") === "checkout" ? "checkout_redirect" : "magic_link";
  const verified = verifyStudentPortalAccessToken({ token, expectedPurpose: purpose });
  if (!verified) return NextResponse.redirect(new URL(`/portal/${encodeURIComponent(vendorSlug)}/login?error=invalid_or_expired`, url.origin), 303);
  const vendor = await getDb().vendor.findFirst({ where: { id: verified.vendorId, slug: vendorSlug }, select: { id: true } });
  if (!vendor) return NextResponse.redirect(new URL(`/portal/${encodeURIComponent(vendorSlug)}/login?error=unauthorized`, url.origin), 303);
  const claim = await consumeStudentPortalAccessToken(getDb(), { token, expectedPurpose: purpose });
  if (!claim) return NextResponse.redirect(new URL(`/portal/${encodeURIComponent(vendorSlug)}/login?error=invalid_or_expired`, url.origin), 303);
  await setStudentPortalSessionCookie(claim);
  const response = NextResponse.redirect(new URL(`/portal/${encodeURIComponent(vendorSlug)}`, url.origin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
