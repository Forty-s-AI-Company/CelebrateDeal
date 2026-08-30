import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import {
  hasActiveLiveViewerSession,
  hashLiveViewerToken,
  liveViewerTokenFromRequest,
} from "@/lib/live-quota-admission";
import { captureProductEvent } from "@/lib/product-analytics";
import { checkRateLimit } from "@/lib/rate-limit";

const AnalyticsId = z.string().min(1).max(128);
const AnalyticsSlug = z.string().min(1).max(160);
const ReferralCode = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/).nullable().optional();
const analyticsBase = {
  vendorId: AnalyticsId,
  liveId: AnalyticsId,
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

  const token = liveViewerTokenFromRequest(request);
  if (!token) {
    return NextResponse.json(
      { error: "Verified playback session required" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const db = getDb();
  const admitted = await hasActiveLiveViewerSession(db, {
    vendorId: parsed.data.vendorId,
    liveId: parsed.data.liveId,
    token,
  });
  if (!admitted) {
    return NextResponse.json(
      { error: "Verified playback session required" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const verifiedSessionId = hashLiveViewerToken(token);

  const live = await db.live.findFirst({
    where: {
      id: parsed.data.liveId,
      vendorId: parsed.data.vendorId,
      OR: [
        { status: { in: ["scheduled", "live"] } },
        { status: "ended", replayEnabled: true },
      ],
    },
    select: { id: true },
  });
  if (!live) {
    return NextResponse.json({ error: "Live not found" }, { status: 404 });
  }

  if (parsed.data.eventType === "product_click") {
    const liveProduct = await db.liveProduct.findFirst({
      where: {
        liveId: parsed.data.liveId,
        productId: parsed.data.payload.productId,
        product: {
          vendorId: parsed.data.vendorId,
          isActive: true,
        },
      },
      select: { id: true },
    });
    if (!liveProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
  }

  await db.analyticsEvent.create({
    data: {
      vendorId: parsed.data.vendorId,
      liveId: parsed.data.liveId,
      visitorId: verifiedSessionId,
      eventType: parsed.data.eventType,
      trustLevel: "ADMITTED_LIVE_SESSION",
      payload: parsed.data.payload as Prisma.InputJsonValue,
    },
  });

  await captureProductEvent({
    distinctId: verifiedSessionId,
    event: parsed.data.eventType,
    properties: {
      vendorId: parsed.data.vendorId,
      liveId: parsed.data.liveId,
      sourceTrust: "admitted_live_session",
      ...parsed.data.payload,
    },
  }).catch(() => null);

  return NextResponse.json({ ok: true, verified: true });
}
