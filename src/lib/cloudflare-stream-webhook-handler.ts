import { NextResponse } from "next/server";
import { readTextBody } from "@/lib/api-security";
import {
  applyCloudflareStreamProviderState,
  CloudflareStreamProviderPayload,
  normalizedCloudflareStreamStatus,
} from "@/lib/cloudflare-stream-video-sync";
import { convergeCloudflareVideoTransition } from "@/lib/cloudflare-video-transition";
import { verifyCloudflareStreamWebhookRequest } from "@/lib/cloudflare-webhook-signature";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";

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

    const parsed = CloudflareStreamProviderPayload.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid Cloudflare Stream webhook payload" }, { status: 400 });
    }

    const payload = parsed.data;
    if (!normalizedCloudflareStreamStatus(payload)) {
      return NextResponse.json({ error: "Unsupported Cloudflare Stream status" }, { status: 400 });
    }

    // Same transition code as the GET /stream/{uid} fallback
    // (src/lib/cloudflare-stream-ready-sync.ts); see cloudflare-stream-video-sync.ts.
    const transition = await applyCloudflareStreamProviderState({ db, payload, converge });

    if (transition.outcome === "ambiguous") {
      return NextResponse.json({ error: "Ambiguous Cloudflare Stream mapping" }, { status: 409 });
    }

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
      updated: transition.updated,
      verificationMode: verification.mode,
    });
  };
}
