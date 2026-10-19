import { requireCronSecret, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { mediaOrigin } from "@/lib/live-media-provider";
import { cleanupMediaSessions } from "@/lib/live-media-cleanup";

async function sweepMediaSessions() {
  const origin = mediaOrigin();
  if (!origin) return Response.json({ error: "Media unavailable" }, { status: 503 });
  try { return Response.json(await cleanupMediaSessions(getDb(), origin), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Media cleanup failed" }, { status: 503 }); }
}

/** Vercel Cron entry: Vercel sends GET with `Authorization: Bearer CRON_SECRET`. */
export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  return sweepMediaSessions();
}

/** Controlled job runner entry (GitHub Actions schedule holds only JOB_SECRET). */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();
  return sweepMediaSessions();
}
