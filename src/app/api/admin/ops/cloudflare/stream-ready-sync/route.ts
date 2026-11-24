import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { runStreamReadySync } from "@/lib/cloudflare-stream-ready-sync";
import { captureOperationalError } from "@/lib/monitoring";

export const runtime = "nodejs";
// Same budget as the scheduled job: at most 10 Cloudflare calls, no new call
// after 30 s, each at most 8 s.
export const maxDuration = 60;

const noStore = { "Cache-Control": "private, no-store" };

/**
 * A4-04 catch-up for uploads that were already stuck longer than the
 * scheduled job's 24 h window (for example before the fallback was deployed).
 * Runs the same fallback with a wider window, optionally for one vendor; the
 * batch limit, deadline, per-video back-off and 404 hold are unchanged, so an
 * operator repeats the call until `candidates` reaches 0 or only throttled
 * or not-ready videos remain.
 */
const CatchUpRequest = z.object({
  maxAgeHours: z.number().int().min(24).max(720),
  vendorId: z.string().trim().min(1).max(128).optional(),
}).strict();

export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();

  const parsed = CatchUpRequest.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid stream ready catch-up request" }, { status: 400, headers: noStore });
  }

  try {
    const summary = await runStreamReadySync({
      maxAgeMs: parsed.data.maxAgeHours * 60 * 60_000,
      ...(parsed.data.vendorId ? { vendorId: parsed.data.vendorId } : {}),
    });
    return NextResponse.json({ ok: true, ...summary }, { headers: noStore });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "stream_ready_sync_catch_up", operation: "scan", status: "failed" });
    } catch {
      // The HTTP contract below stays fail-closed even when monitoring is unavailable.
    }
    return NextResponse.json({ ok: false, error: "stream_ready_sync_failed" }, { status: 503, headers: noStore });
  }
}
