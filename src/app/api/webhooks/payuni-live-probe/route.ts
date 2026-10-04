import { NextResponse } from "next/server";
import { readTextBody } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { payUniLiveProbeAvailable } from "@/lib/payuni-live-probe";
import { normalizePayUniLiveProbeCallback } from "@/lib/payment-providers/payuni";

export async function POST(request: Request) {
  const vendorId = process.env.PAYUNI_LIVE_PROBE_VENDOR_ID?.trim() ?? "";
  if (!payUniLiveProbeAvailable(vendorId)) return new NextResponse(null, { status: 404 });
  const rawBody = await readTextBody(request);
  if (rawBody === null) return new NextResponse(null, { status: 413 });
  const event = normalizePayUniLiveProbeCallback(rawBody);
  if (!event) return new NextResponse(null, { status: 401 });
  const db = getDb();
  const probe = await db.payUniLiveProbe.findUnique({ where: { secondOrderNumber: event.orderNumber } });
  if (!probe || probe.vendorId !== vendorId || !probe.attemptedAt) {
    return new NextResponse(null, { status: 404 });
  }
  if (event.status === "confirmed") {
    if (probe.status === "confirmed" && probe.providerTradeNo !== event.providerTradeNo) {
      return new NextResponse(null, { status: 409 });
    }
    if (probe.status !== "confirmed") {
      await db.payUniLiveProbe.updateMany({
        where: { id: probe.id, vendorId, status: { in: ["dispatched", "ambiguous", "failed"] } },
        data: {
          status: "confirmed", providerTradeNo: event.providerTradeNo,
          completedAt: new Date(), failureCode: null,
        },
      });
    }
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
