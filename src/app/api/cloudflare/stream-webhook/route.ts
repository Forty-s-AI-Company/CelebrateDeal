import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyCloudflareStreamWebhookRequest } from "@/lib/cloudflare-webhook-signature";
import { getDb } from "@/lib/db";

const StreamWebhookPayload = z.object({
  uid: z.string().min(1),
  status: z.object({
    state: z.string().optional(),
    pctComplete: z.string().optional(),
  }).optional(),
  readyToStream: z.boolean().optional(),
  thumbnail: z.string().optional(),
  duration: z.number().optional(),
  playback: z.object({
    hls: z.string().optional(),
    dash: z.string().optional(),
  }).optional(),
});

export async function POST(request: Request) {
  const rawBody = await request.text();
  const verification = verifyCloudflareStreamWebhookRequest({ request, body: rawBody });
  if (!verification.ok) {
    return NextResponse.json(
      {
        error: "Invalid Cloudflare Stream webhook signature",
        reason: verification.reason,
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid Cloudflare Stream webhook JSON" }, { status: 400 });
  }

  const parsed = StreamWebhookPayload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Cloudflare Stream webhook payload" }, { status: 400 });
  }

  const payload = parsed.data;
  const status = payload.readyToStream ? "ready" : payload.status?.state ?? "processing";
  const video = await getDb().video.updateMany({
    where: {
      OR: [
        { cloudflareStreamUid: payload.uid },
        { cloudflareLiveInputUid: payload.uid },
        { cloudflarePlaybackId: payload.uid },
      ],
    },
    data: {
      status,
      cloudflareReadyToStream: payload.readyToStream ?? false,
      cloudflarePlaybackId: payload.uid,
      videoUrl: `https://videodelivery.net/${payload.uid}/manifest/video.m3u8`,
      thumbnailUrl: payload.thumbnail,
      durationSec: payload.duration ? Math.round(payload.duration) : undefined,
    },
  });

  return NextResponse.json({ ok: true, updated: video.count, verificationMode: verification.mode });
}
