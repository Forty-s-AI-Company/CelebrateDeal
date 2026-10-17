import { NextResponse } from "next/server";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/trusted-entry-rate-limit";
import { capabilityConfirmation, clearCapabilityConfirmation, isCapabilityConfirmationOrigin, readCapabilityConfirmation } from "@/lib/capability-confirmation";
import { consumeStudentPortalAccessToken, setStudentPortalSessionCookie, verifyStudentPortalAccessToken } from "@/lib/student-portal-auth";

type Context = { params: Promise<{ vendorSlug: string }> };
const purpose = "magic_link" as const;
const accessPath = (slug: string) => `/portal/${encodeURIComponent(slug)}/access`;
function redirectPrivate(path: string) {
  return NextResponse.redirect(new URL(path, getCanonicalAppUrl()), { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
async function eligible(capability: string, vendorSlug: string) {
  const verified = verifyStudentPortalAccessToken({ token: capability, expectedPurpose: purpose });
  if (!verified) return null;
  return getDb().vendor.findFirst({ where: { id: verified.vendorId, slug: vendorSlug }, select: { id: true, name: true } });
}
function validPurpose(request: Request) {
  const url = new URL(request.url);
  return !url.searchParams.has("purpose") || url.searchParams.get("purpose") === purpose;
}

/** 郵件掃描或預覽只能看到確認頁，不消耗一次性連結。 */
export async function GET(request: Request, { params }: Context) {
  const limited = await checkRateLimit(request, "student-portal-access-preview", 60, 60_000);
  if (limited) return limited;
  const { vendorSlug } = await params;
  const capability = new URL(request.url).searchParams.get("token") ?? "";
  const vendor = validPurpose(request) ? await eligible(capability, vendorSlug) : null;
  if (!vendor) return redirectPrivate(`/portal/${encodeURIComponent(vendorSlug)}/login?error=invalid_or_expired`);
  return capabilityConfirmation(accessPath(vendorSlug), capability, vendor.name);
}

/** 所有狀態寫入留在 POST，租戶核對仍先於原子的單次消耗。 */
export async function POST(request: Request, { params }: Context) {
  const limited = await checkRateLimit(request, "student-portal-access-confirm", 30, 60_000);
  if (limited) return limited;
  const { vendorSlug } = await params;
  const path = accessPath(vendorSlug);
  if (!isCapabilityConfirmationOrigin(request, path)) return NextResponse.json({ error: "confirmation_required" }, { status: 403, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  const failure = () => clearCapabilityConfirmation(redirectPrivate(`/portal/${encodeURIComponent(vendorSlug)}/login?error=invalid_or_expired`), path);
  const capability = await readCapabilityConfirmation(request, path);
  if (!capability || !validPurpose(request) || !await eligible(capability, vendorSlug)) return failure();
  const claim = await consumeStudentPortalAccessToken(getDb(), { token: capability, expectedPurpose: purpose });
  if (!claim) return failure();
  await setStudentPortalSessionCookie(claim);
  return clearCapabilityConfirmation(redirectPrivate(`/portal/${encodeURIComponent(vendorSlug)}`), path);
}
