import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { loadPublicLiveSessions } from "@/lib/live-fixed-sessions-store";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Public, read-only list of a fixed-session Live's open sessions (指定場次),
 * grouped by local date, for the landing-page session picker. Only a
 * scheduled or running Live in "fixed_sessions" mode resolves; the seat
 * counts are a hint, the registration POST takes the seat atomically.
 */
const Identifier = z.string().trim().regex(/^[A-Za-z0-9_-]+$/u).max(128);
const SessionsQuery = z.object({
  liveId: Identifier,
  vendorId: Identifier.optional(),
}).strict();

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "live-sessions", 120, 60_000);
  if (limited) return limited;
  const url = new URL(request.url);
  const parsed = SessionsQuery.safeParse({
    liveId: url.searchParams.get("liveId") ?? undefined,
    vendorId: url.searchParams.get("vendorId") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid live sessions request" }, { status: 400, headers: privateHeaders });
  const result = await loadPublicLiveSessions(getDb(), parsed.data);
  if (!result) return NextResponse.json({ error: "Live sessions unavailable" }, { status: 404, headers: privateHeaders });
  return NextResponse.json(result, { headers: privateHeaders });
}
