import { NextResponse } from "next/server";
import { z } from "zod";
import { readTextBody } from "@/lib/api-security";
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

function normalizedVideoStatus(payload: z.infer<typeof StreamWebhookPayload>) {
  if (payload.readyToStream === true) return "ready";

  const providerState = payload.status?.state?.trim().toLowerCase();
  if (["pendingupload", "queued", "downloading", "inprogress", "processing"].includes(providerState ?? "")) {
    return "processing";
  }
  if (providerState === "error") return "error";
  return null;
}

export async function POST(request: Request) {
  const rawBody = await readTextBody(request);
  if (rawBody === null) {
    return NextResponse.json({ error: "Cloudflare Stream webhook payload too large" }, { status: 413 });
  }

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
  const status = normalizedVideoStatus(payload);
  if (!status) {
    return NextResponse.json({ error: "Unsupported Cloudflare Stream status" }, { status: 400 });
  }

  const db = getDb();
  const matches = await db.video.findMany({
    where: {
      OR: [
        { cloudflareStreamUid: payload.uid },
        { cloudflareLiveInputUid: payload.uid },
        { cloudflarePlaybackId: payload.uid },
      ],
    },
    select: { id: true },
    take: 2,
  });

  // A provider UID has no tenant context. Refuse to mutate when local mapping
  // is ambiguous instead of updating more than one tenant's video record.
  if (matches.length > 1) {
    return NextResponse.json({ error: "Ambiguous Cloudflare Stream mapping" }, { status: 409 });
  }
  if (matches.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, verificationMode: verification.mode });
  }

  await db.video.update({
    where: { id: matches[0].id },
    data: {
      status,
      cloudflareReadyToStream: payload.readyToStream ?? false,
      cloudflarePlaybackId: payload.uid,
      videoUrl: `https://videodelivery.net/${payload.uid}/manifest/video.m3u8`,
      thumbnailUrl: payload.thumbnail,
      durationSec: payload.duration ? Math.round(payload.duration) : undefined,
    },
  });

  return NextResponse.json({ ok: true, updated: 1, verificationMode: verification.mode });
}
