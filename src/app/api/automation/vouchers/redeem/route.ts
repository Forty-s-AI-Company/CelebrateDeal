import { getCanonicalAppUrl } from "@/lib/app-url";
import { NextResponse } from "next/server";
import { AUTOMATION_VOUCHER_COOKIE } from "@/lib/live-interaction";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/trusted-entry-rate-limit";
import { capabilityConfirmation, clearCapabilityConfirmation, isCapabilityConfirmationOrigin, readCapabilityConfirmationDetails } from "@/lib/capability-confirmation";
import { AUTOMATION_VOUCHER_BEARER, exchangeAutomationVoucher, previewAutomationVoucher } from "@/lib/automation-voucher-exchange";

const PATH = "/api/automation/vouchers/redeem";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
function unavailable(status: 400 | 403 | 410) {
  return new NextResponse('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>無法確認優惠券</title></head><body><main><h1>無法確認優惠券</h1><p>這次確認已失效，請重新開啟最新的優惠券連結。若已使用另一張券或更換裝置，請回到商家的學員中心，在「專屬優惠券」重新點選「立即使用」。已使用或過期的券請聯絡商家。</p></main></body></html>', { status, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" } });
}

/** 郵件預覽不設 checkout cookie，也不旋轉連結。 */
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, "automation-voucher-redeem", 60, 60_000);
  if (limited) return limited;
  const capability = new URL(request.url).searchParams.get("token") ?? "";
  if (!AUTOMATION_VOUCHER_BEARER.test(capability)) return unavailable(400);
  const grant = await previewAutomationVoucher(getDb(), capability);
  if (!grant) return unavailable(410);
  return capabilityConfirmation(PATH, capability, grant.vendor.name, "voucher");
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, "automation-voucher-confirm", 30, 60_000);
  if (limited) return limited;
  if (!isCapabilityConfirmationOrigin(request, PATH)) return unavailable(403);
  const confirmation = await readCapabilityConfirmationDetails(request, PATH, "voucher");
  if (!confirmation) return clearCapabilityConfirmation(unavailable(403), PATH, "voucher");
  const exchanged = await exchangeAutomationVoucher(getDb(), confirmation.capability, confirmation);
  if (!exchanged) return clearCapabilityConfirmation(unavailable(410), PATH, "voucher");
  const destination = new URL(`/checkout/${encodeURIComponent(exchanged.vendorId)}/${encodeURIComponent(exchanged.productId)}`, getCanonicalAppUrl());
  const response = NextResponse.redirect(destination, { status: 303, headers: PRIVATE_HEADERS });
  response.cookies.set(AUTOMATION_VOUCHER_COOKIE, exchanged.bearer, {
    httpOnly: true, sameSite: "lax", secure: destination.protocol === "https:", path: "/",
    maxAge: Math.max(1, Math.floor((exchanged.expiresAt.getTime() - Date.now()) / 1_000)),
  });
  // 保留五分鐘 challenge，讓同一份確認在遺失回應或重複點擊時可重送。
  return response;
}
