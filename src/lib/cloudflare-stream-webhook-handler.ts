import { NextResponse } from "next/server";
import { z } from "zod";
import { readTextBody } from "@/lib/api-security";
import { convergeCloudflareVideoTransition } from "@/lib/cloudflare-video-transition";
import { verifyCloudflareStreamWebhookRequest } from "@/lib/cloudflare-webhook-signature";
import type { CloudflareVideoStatus } from "@/lib/cloudflare-video-status";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";

const MAX_CLOUDFLARE_DURATION_SECONDS = 6 * 60 * 60;

function normalizedDurationSeconds(duration: number) {
  return Math.ceil(duration);
}

const StreamWebhookPayload = z.object({
  uid: z.string().min(1),
  status: z.object({
    state: z.string().optional(),
    pctComplete: z.string().optional(),
  }).optional(),
  readyToStream: z.boolean().optional(),
  thumbnail: z.string().optional(),
  duration: z.number().finite().nonnegative().max(MAX_CLOUDFLARE_DURATION_SECONDS).optional(),
  playback: z.object({
    hls: z.string().optional(),
    dash: z.string().optional(),
  }).optional(),
});

function normalizedVideoStatus(payload: z.infer<typeof StreamWebhookPayload>): CloudflareVideoStatus | null {
  if (payload.readyToStream === true) return "ready";

  const providerState = payload.status?.state?.trim().toLowerCase();
  if (["pendingupload", "queued", "downloading", "inprogress", "processing"].includes(providerState ?? "")) {
    return "processing";
  }
  if (providerState === "error") return "error";
  return null;
}

function readyProviderMetadata(payload: z.infer<typeof StreamWebhookPayload>) {
  const duration = payload.duration;
  const base = {
    cloudflareReadyToStream: true,
    cloudflarePlaybackId: payload.uid,
    videoUrl: `https://videodelivery.net/${payload.uid}/manifest/video.m3u8`,
    ...(payload.thumbnail !== undefined ? { thumbnailUrl: payload.thumbnail } : {}),
  };
  if (duration === undefined) return base;
  const durationSec = normalizedDurationSeconds(duration);
  return { ...base, durationSec, estimatedMinutes: Math.ceil(durationSec / 60) };
}

function readyMetadataChanged(
  match: {
    cloudflareReadyToStream: boolean;
    cloudflarePlaybackId: string | null;
    videoUrl: string;
    thumbnailUrl: string | null;
    durationSec: number;
    estimatedMinutes: number;
  },
  payload: z.infer<typeof StreamWebhookPayload>,
) {
  const durationSec = payload.duration === undefined ? undefined : normalizedDurationSeconds(payload.duration);
  return match.cloudflareReadyToStream !== true
    || match.cloudflarePlaybackId !== payload.uid
    || match.videoUrl !== `https://videodelivery.net/${payload.uid}/manifest/video.m3u8`
    || (payload.thumbnail !== undefined && match.thumbnailUrl !== payload.thumbnail)
    || (durationSec !== undefined && (
      match.durationSec !== durationSec
      || match.estimatedMinutes !== Math.ceil(durationSec / 60)
    ));
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
      select: {
        id: true,
        vendorId: true,
        status: true,
        cloudflareReadyToStream: true,
        cloudflarePlaybackId: true,
        videoUrl: true,
        thumbnailUrl: true,
        durationSec: true,
        estimatedMinutes: true,
      },
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

    if (!match.vendorId) {
      return NextResponse.json({ error: "Ambiguous Cloudflare Stream mapping" }, { status: 409 });
    }

    if (match.status === "archived") {
      // Keep the application-owned archive state terminal while still
      // accepting authoritative provider metadata from a ready callback.
      if (status !== "ready" || !readyMetadataChanged(match, payload)) {
        return NextResponse.json({ ok: true, updated: 0, verificationMode: verification.mode });
      }
      const updated = await db.video.updateMany({
        where: { id: match.id, vendorId: match.vendorId, status: "archived" },
        data: readyProviderMetadata(payload),
      });
      return NextResponse.json({
        ok: true,
        updated: updated.count,
        verificationMode: verification.mode,
      });
    }

    if (match.status === "ready" && status === "ready") {
      if (!readyMetadataChanged(match, payload)) {
        return NextResponse.json({ ok: true, updated: 0, verificationMode: verification.mode });
      }
      const updated = await db.video.updateMany({
        where: { id: match.id, vendorId: match.vendorId, status: "ready" },
        data: readyProviderMetadata(payload),
      });
      return NextResponse.json({
        ok: true,
        updated: updated.count,
        verificationMode: verification.mode,
      });
    }

    const transition = await converge({
      snapshot: match,
      incomingStatus: status,
      claim: async ({ id, vendorId, expectedStatus, nextStatus }) => {
        const updated = await db.video.updateMany({
          // 狀態條件是 optimistic claim；若較新的 callback 已先完成，helper 會重新讀取狀態。
          where: { id, vendorId: vendorId ?? match.vendorId, status: expectedStatus },
          data: {
            status: nextStatus,
            cloudflareReadyToStream: payload.readyToStream ?? false,
            cloudflarePlaybackId: payload.uid,
            videoUrl: `https://videodelivery.net/${payload.uid}/manifest/video.m3u8`,
            ...(payload.thumbnail !== undefined ? { thumbnailUrl: payload.thumbnail } : {}),
            ...(nextStatus === "ready" ? readyProviderMetadata(payload) : {}),
          },
        });
        return updated.count === 1;
      },
      readLatest: async (id) => db.video.findUnique({
        where: { id, vendorId: match.vendorId },
        select: { id: true, vendorId: true, status: true },
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
