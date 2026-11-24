import { NextResponse } from "next/server";
import { requireCronSecret, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { runStreamReadySync } from "@/lib/cloudflare-stream-ready-sync";
import { captureOperationalError } from "@/lib/monitoring";

// A4-04: asks Cloudflare Stream about uploads whose ready webhook never
// arrived (5 min to 24 h after upload, at most 10 calls per run, no new call
// after 30 s, each call at most 8 s, per-video back-off) and applies a ready
// answer through the webhook's own transition code. Nothing here registers
// after(); 60 s covers the 30 s budget plus one in-flight call, and stays
// under the scheduler's 120 s wait (scripts/scheduled-jobs-runner.mjs).
export const maxDuration = 60;

async function syncStreamReadyState() {
  try {
    const summary = await runStreamReadySync();
    return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "stream_ready_sync_job", operation: "scan", status: "failed" });
    } catch {
      // The HTTP contract below stays fail-closed even when monitoring is unavailable.
    }
    return NextResponse.json(
      { ok: false, error: "stream_ready_sync_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** Vercel Cron entry: Vercel sends GET with `Authorization: Bearer CRON_SECRET`. */
export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  return syncStreamReadyState();
}

/** Controlled job runner entry (Cloudflare Worker / GitHub Actions schedule or manual operations). */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();
  return syncStreamReadyState();
}
