import { NextResponse } from "next/server";
import { z } from "zod";
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

function verifyCloudflareWebhook(request: Request) {
  const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  if (!secret) return true;
  return request.headers.get("x-cloudflare-stream-webhook-secret") === secret;
}

export async function POST(request: Request) {
  if (!verifyCloudflareWebhook(request)) {
    return NextResponse.json({ error: "Invalid Cloudflare Stream webhook secret" }, { status: 401 });
  }

  const parsed = StreamWebhookPayload.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Cloudflare Stream webhook payload" }, { status: 400 });
  }

  const payload = parsed.data;
  const status = payload.readyToStream ? "ready" : payload.status?.state ?? "processing";
  const video = await getDb().video.updateMany({
    where: { cloudflareStreamUid: payload.uid },
    data: {
      status,
      cloudflareReadyToStream: payload.readyToStream ?? false,
      thumbnailUrl: payload.thumbnail,
      durationSec: payload.duration ? Math.round(payload.duration) : undefined,
    },
  });

  return NextResponse.json({ ok: true, updated: video.count });
}
