import { NextResponse } from "next/server";
import { AUTOMATION_VOUCHER_COOKIE, hashInteractionBearer } from "@/lib/live-interaction";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const BEARER_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/** Exchanges the high-entropy bearer in a LINE link for an HttpOnly checkout cookie. */
export async function GET(request: Request) {
  const limited = await checkRateLimit(request, "automation-voucher-redeem", 60, 60_000);
  if (limited) return limited;
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token");
  if (!token || !BEARER_PATTERN.test(token)) {
    return NextResponse.json({ error: "Invalid voucher" }, { status: 400 });
  }
  const now = new Date();
  const grant = await getDb().automationVoucherGrant.findUnique({
    where: { claimTokenHash: hashInteractionBearer(token) },
    select: { vendorId: true, productId: true, expiresAt: true, usedOrderId: true },
  });
  if (!grant || grant.usedOrderId || grant.expiresAt <= now) {
    return NextResponse.json({ error: "Voucher unavailable" }, { status: 410 });
  }
  const destination = new URL(
    `/checkout/${encodeURIComponent(grant.vendorId)}/${encodeURIComponent(grant.productId)}`,
    requestUrl.origin,
  );
  const response = NextResponse.redirect(destination, 303);
  response.cookies.set(AUTOMATION_VOUCHER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: requestUrl.protocol === "https:",
    path: "/",
    maxAge: Math.max(1, Math.floor((grant.expiresAt.getTime() - now.getTime()) / 1_000)),
  });
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
