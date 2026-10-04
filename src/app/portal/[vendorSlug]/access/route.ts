import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  consumeStudentPortalAccessToken,
  setStudentPortalSessionCookie,
  verifyStudentPortalAccessToken,
} from "@/lib/student-portal-auth";

export async function GET(request: Request, { params }: { params: Promise<{ vendorSlug: string }> }) {
  const { vendorSlug } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  // Only mailbox-delivered capabilities may create an account-wide session.
  const purpose = "magic_link" as const;
  const redirectPrivate = (path: string) => {
    const response = NextResponse.redirect(new URL(path, url.origin), 303);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  if (url.searchParams.has("purpose") && url.searchParams.get("purpose") !== "magic_link") {
    return redirectPrivate(`/portal/${encodeURIComponent(vendorSlug)}/login?error=invalid_or_expired`);
  }
  const verified = verifyStudentPortalAccessToken({ token, expectedPurpose: purpose });
  if (!verified) return redirectPrivate(`/portal/${encodeURIComponent(vendorSlug)}/login?error=invalid_or_expired`);
  const vendor = await getDb().vendor.findFirst({ where: { id: verified.vendorId, slug: vendorSlug }, select: { id: true } });
  if (!vendor) return redirectPrivate(`/portal/${encodeURIComponent(vendorSlug)}/login?error=unauthorized`);
  const claim = await consumeStudentPortalAccessToken(getDb(), { token, expectedPurpose: purpose });
  if (!claim) return redirectPrivate(`/portal/${encodeURIComponent(vendorSlug)}/login?error=invalid_or_expired`);
  await setStudentPortalSessionCookie(claim);
  return redirectPrivate(`/portal/${encodeURIComponent(vendorSlug)}`);
}
