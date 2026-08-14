import { NextResponse } from "next/server";
import { z } from "zod";
import { readTextBody } from "@/lib/api-security";
import { convergeCloudflareVideoTransition } from "@/lib/cloudflare-video-transition";
import { verifyCloudflareStreamWebhookRequest } from "@/lib/cloudflare-webhook-signature";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";

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

type StreamWebhookDependencies = {
  db?: ReturnType<typeof getDb>;
  converge?: typeof convergeCloudflareVideoTransition;
  captureError?: typeof captureOperationalError;
};

export function createCloudflareStreamWebhookHandler({
  db = getDb(),
  converge = convergeCloudflareVideoTransition,
  captureError = captureOperationalError,
}: StreamWebhookDependencies = {}) {
  return async function handleCloudflareStreamWebhook(request: Request) {
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

    const matches = await db.video.findMany({
      where: {
        OR: [
          { cloudflareStreamUid: payload.uid },
          { cloudflareLiveInputUid: payload.uid },
          { cloudflarePlaybackId: payload.uid },
        ],
      },
      select: { id: true, status: true },
      take: 2,
    });

    // Provider UID 沒有 tenant context；若本機 mapping 不唯一就停止寫入。
    if (matches.length > 1) {
      return NextResponse.json({ error: "Ambiguous Cloudflare Stream mapping" }, { status: 409 });
    }
    if (matches.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, verificationMode: verification.mode });
    }
    const match = matches[0];
    if (!match) {
      return NextResponse.json({ ok: true, updated: 0, verificationMode: verification.mode });
    }

    if (match.status === "ready" && status === "ready") {
      return NextResponse.json({ ok: true, updated: 0, verificationMode: verification.mode });
    }

    const transition = await converge({
      snapshot: match,
      incomingStatus: status,
      claim: async ({ id, expectedStatus, nextStatus }) => {
        const updated = await db.video.updateMany({
          // 狀態條件是 optimistic claim；若較新的 callback 已先完成，helper 會重新讀取狀態。
          where: { id, status: expectedStatus },
          data: {
            status: nextStatus,
            cloudflareReadyToStream: payload.readyToStream ?? false,
            cloudflarePlaybackId: payload.uid,
            videoUrl: `https://videodelivery.net/${payload.uid}/manifest/video.m3u8`,
            thumbnailUrl: payload.thumbnail,
            durationSec: payload.duration ? Math.round(payload.duration) : undefined,
          },
        });
        return updated.count === 1;
      },
      readLatest: async (id) => db.video.findUnique({
        where: { id },
        select: { id: true, status: true },
      }),
    });

    if (transition.outcome === "contention_exhausted") {
      try {
        captureError(new Error("Cloudflare Stream webhook contention exhausted"), {
          source: "cloudflare_stream_webhook",
          operation: "status_convergence",
          provider: "cloudflare_stream",
          status: "contention_exhausted",
        });
      } catch {
        // Monitoring 是 best-effort，不能把可重試結果改成 500 或洩漏 provider 診斷。
      }
      return NextResponse.json(
        { error: "Cloudflare Stream webhook update is temporarily unavailable", code: "contention_exhausted" },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      updated: transition.outcome === "applied" ? 1 : 0,
      verificationMode: verification.mode,
    });
  };
}
