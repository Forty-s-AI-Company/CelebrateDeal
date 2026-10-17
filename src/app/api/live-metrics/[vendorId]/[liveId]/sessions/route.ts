import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { LiveChatError } from "@/lib/live-chat";
import { getLiveChatClientIp } from "@/lib/live-chat-request-security";
import { metricRequestAuthorizer } from "@/lib/live-metric-request-authorization";
import { metricCollectionReady } from "@/lib/live-metric-readiness";
import { MetricIngestError } from "@/lib/live-metric-ingestion";
import { issueMetricSession, MetricSessionLimitError } from "@/lib/live-metric-session";
import { resolveMetricSessionContext } from "@/lib/live-metric-version";
import { checkRateLimit } from "@/lib/trusted-entry-rate-limit";

export const runtime = "nodejs";
const ScopeSchema = z.object({ vendorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), liveId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict();
const headers = { "Cache-Control": "private, no-store" };
function json(value: unknown, status: number) { return NextResponse.json(value, { status, headers }); }
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }

/** Boolean eligibility only. Never allocates a nonce or discloses identity. */
export async function GET(request: Request, context: { params: Promise<{ vendorId: string; liveId: string }> }) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return privateResponse(sameOrigin);
  try {
    const limited = await checkRateLimit(request, "live-metric-readiness", 120, 60000);
    if (limited) return privateResponse(limited);
    const scope = ScopeSchema.safeParse(await context.params);
    if (!scope.success) return json({ ready: false }, 400);
    const ipAddress = getLiveChatClientIp(request);
    if (!ipAddress) return json({ ready: false }, 503);
    const ready = await metricCollectionReady(getDb(), metricRequestAuthorizer(request, scope.data, ipAddress), resolveMetricSessionContext);
    return json({ ready }, ready ? 200 : 403);
  } catch (error) {
    if (error instanceof MetricIngestError && error.code === "retryable_conflict") return json({ ready: false }, 503);
    if (error instanceof LiveChatError || error instanceof MetricIngestError) return json({ ready: false }, 403);
    return json({ ready: false }, 503);
  }
}

/** The body contains only a UUID retry key. Version/lifetime are server-selected. Verified registration and
 * admission identities come from canonical signed/opaque viewer credentials.
 */
export async function POST(request: Request, context: { params: Promise<{ vendorId: string; liveId: string }> }) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return privateResponse(sameOrigin);
  try {
    const limited = await checkRateLimit(request, "live-metric-session", 120, 60000);
    if (limited) return privateResponse(limited);
    const ipAddress = getLiveChatClientIp(request);
    if (!ipAddress) return json({ error: "Request source unavailable" }, 503);
    const scope = ScopeSchema.safeParse(await context.params);
    if (!scope.success) return json({ error: "Invalid metric request" }, 400);
    const authorize = metricRequestAuthorizer(request, scope.data, ipAddress);
    const body = await readJsonBody(request, 1024);
    const receipt = await issueMetricSession(getDb(), authorize, resolveMetricSessionContext, body, { requirePlaybackIntake: true, renewPlaybackIntake: true });
    // Read the same database clock used for the persisted anchor. Application
    // host time may differ, and idempotent retries can return an older anchor.
    const [{ now }] = await getDb().$queryRaw<{ now: Date }[]>`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`;
    return json({ ok: true, ...receipt, serverNowAtMs: +now }, 200);
  } catch (error) {
    if (error instanceof MetricSessionLimitError) {
      const retryable = error.reason === "open";
      return NextResponse.json({ error: "Metric session limit reached", retryable }, {
        status: retryable ? 429 : 409, headers: retryable ? { ...headers, "Retry-After": "30" } : headers,
      });
    }
    if (error instanceof LiveChatError) return json({ error: "Viewer access required" }, 403);
    if (error instanceof MetricIngestError) {
      if (error.code === "not_authorized") return json({ error: "Viewer access required" }, 403);
      if (error.code === "invalid_payload") return json({ error: "Invalid metric request" }, 400);
      if (error.code === "invalid_segment") return json({ error: "Invalid playback interval" }, 422);
      if (error.code === "retryable_conflict") return json({ error: "Metric collection temporarily unavailable" }, 503);
      return json({ error: "Metric session conflicts with the current state" }, 409);
    }
    // Neither SQL diagnostics nor viewer identity may enter public responses.
    return json({ error: "Unable to create metric session" }, 500);
  }
}
