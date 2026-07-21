import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { captureProductEvent } from "@/lib/product-analytics";
import { checkRateLimit } from "@/lib/rate-limit";

const AnalyticsId = z.string().min(1).max(128);
const AnalyticsSlug = z.string().min(1).max(160);
const ReferralCode = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/).nullable().optional();
const analyticsBase = {
  vendorId: AnalyticsId,
  liveId: AnalyticsId,
  visitorId: AnalyticsId,
};

const AnalyticsPayload = z.discriminatedUnion("eventType", [
  z.object({
    ...analyticsBase,
    eventType: z.literal("page_view"),
    payload: z.object({ slug: AnalyticsSlug }).strict(),
  }).strict(),
  z.object({
    ...analyticsBase,
    eventType: z.literal("video_play"),
    payload: z.object({ slug: AnalyticsSlug, ref: ReferralCode }).strict(),
  }).strict(),
  z.object({
    ...analyticsBase,
    eventType: z.literal("play_progress"),
    payload: z.object({
      seconds: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(300), z.literal(600)]),
      ref: ReferralCode,
    }).strict(),
  }).strict(),
  z.object({
    ...analyticsBase,
    eventType: z.literal("product_click"),
    payload: z.object({ productId: AnalyticsId, ref: ReferralCode }).strict(),
  }).strict(),
  z.object({
    ...analyticsBase,
    eventType: z.literal("cta_click"),
    payload: z.object({ label: z.string().min(1).max(160), ref: ReferralCode }).strict(),
  }).strict(),
]);

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "analytics", 120, 60_000);
  if (limited) return limited;

  const parsed = AnalyticsPayload.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const live = await getDb().live.findFirst({
    where: { id: parsed.data.liveId, vendorId: parsed.data.vendorId },
    select: { id: true },
  });
  if (!live) {
    return NextResponse.json({ error: "Live not found" }, { status: 404 });
  }

  await getDb().analyticsEvent.create({
    data: {
      vendorId: parsed.data.vendorId,
      liveId: parsed.data.liveId,
      visitorId: parsed.data.visitorId,
      eventType: parsed.data.eventType,
      payload: parsed.data.payload as Prisma.InputJsonValue,
    },
  });

  await captureProductEvent({
    distinctId: parsed.data.visitorId,
    event: parsed.data.eventType,
    properties: {
      vendorId: parsed.data.vendorId,
      liveId: parsed.data.liveId,
      ...parsed.data.payload,
    },
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
