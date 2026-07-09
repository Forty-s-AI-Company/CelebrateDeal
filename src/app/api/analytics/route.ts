import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { captureProductEvent } from "@/lib/product-analytics";

const AnalyticsPayload = z.object({
  vendorId: z.string().min(1),
  liveId: z.string().nullable().optional(),
  visitorId: z.string().min(1),
  eventType: z.string().min(1).max(80),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const parsed = AnalyticsPayload.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
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
