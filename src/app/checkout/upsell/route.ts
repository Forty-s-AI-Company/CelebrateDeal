import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { getDb } from "@/lib/db";
import { getCanonicalAppUrl } from "@/lib/app-url";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
};

/** Reject anonymous entry before App Router can stream a 200 page shell. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const grantId = query.get("grant");
  const kind = query.get("offer") ?? "upsell";
  if (!grantId || !/^[A-Za-z0-9_-]{1,191}$/u.test(grantId)
    || !["upsell", "downsell"].includes(kind) || query.getAll("grant").length !== 1
    || query.getAll("offer").length > 1) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  }
  const grant = await resolveBuyerSupportGrant(getDb(), await cookies(), grantId);
  if (!grant || grant.order.status !== "paid" || grant.order.refundedAmountCents !== 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
  }
  // Request origins can describe the internal Next server behind a proxy.
  // Keep the browser grant on the explicitly configured application origin.
  const destination = new URL("/checkout/offer", getCanonicalAppUrl());
  destination.searchParams.set("grant", grantId);
  destination.searchParams.set("offer", kind);
  return NextResponse.redirect(destination, { status: 307, headers: privateHeaders });
}
