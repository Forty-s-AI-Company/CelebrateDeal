import { requireCronSecret, unauthorizedJson } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { mediaOrigin } from "@/lib/live-media-provider";
import { cleanupMediaSessions } from "@/lib/live-media-cleanup";

export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  const origin = mediaOrigin();
  if (!origin) return Response.json({ error: "Media unavailable" }, { status: 503 });
  try { return Response.json(await cleanupMediaSessions(getDb(), origin), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Media cleanup failed" }, { status: 503 }); }
}
