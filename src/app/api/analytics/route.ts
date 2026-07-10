import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { captureProductEvent } from "@/lib/product-analytics";
import { checkRateLimit } from "@/lib/rate-limit";

const AnalyticsPayload = z.object({
  vendorId: z.string().min(1),
  liveId: z.string().nullable().optional(),
  visitorId: z.string().min(1),
  eventType: z.string().min(1).max(80),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "analytics", 120, 60_000);
  if (limited) return limited;

  const parsed = AnalyticsPayload.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (parsed.data.liveId) {
    const live = await getDb().live.findFirst({
      where: { id: parsed.data.liveId, vendorId: parsed.data.vendorId },
      select: { id: true },
    });
    if (!live) {
      return NextResponse.json({ error: "Live not found" }, { status: 404 });
    }
  } else {
    const vendor = await getDb().vendor.findUnique({ where: { id: parsed.data.vendorId }, select: { id: true } });
    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }
  }

  await getDb().analyticsEvent.create({
    data: {
      vendorId: parsed.data.vendorId,
      liveId: parsed.data.liveId ?? null,
      visitorId: parsed.data.visitorId,
      eventType: parsed.data.eventType,
      payload: (parsed.data.payload ?? {}) as Prisma.InputJsonValue,
    },
  });

  await captureProductEvent({
    distinctId: parsed.data.visitorId,
    event: parsed.data.eventType,
    properties: {
      vendorId: parsed.data.vendorId,
      liveId: parsed.data.liveId ?? null,
      ...(parsed.data.payload ?? {}),
    },
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
