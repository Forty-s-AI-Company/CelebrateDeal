import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { chatSessionTokenFromRequest, LiveChatError, resolveVerifiedPrivateChatViewer } from "@/lib/live-chat";
import { getLiveChatClientIp } from "@/lib/live-chat-request-security";
import { hashLiveViewerToken, liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { ingestMetricIntervals, MetricIngestError } from "@/lib/live-metric-ingestion";
import { resolveMetricSessionContext } from "@/lib/live-metric-version";
import { checkRateLimit } from "@/lib/trusted-entry-rate-limit";

export const runtime = "nodejs";
const ScopeSchema = z.object({ vendorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), liveId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict();
const headers = { "Cache-Control": "private, no-store" };
function json(value: unknown, status: number) { return NextResponse.json(value, { status, headers }); }
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }

/** The body contains only session/interval data. Verified registration and
 * admission identities come from canonical signed/opaque viewer credentials.
 */
export async function POST(request: Request, context: { params: Promise<{ vendorId: string; liveId: string }> }) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return privateResponse(sameOrigin);
  try {
    const limited = await checkRateLimit(request, "live-metric-ingest", 600, 60000);
    if (limited) return privateResponse(limited);
    const ipAddress = getLiveChatClientIp(request);
    if (!ipAddress) return json({ error: "Request source unavailable" }, 503);
    const scope = ScopeSchema.safeParse(await context.params);
    if (!scope.success) return json({ error: "Invalid metric request" }, 400);
    const admissionToken = liveViewerTokenFromRequest(request);
    const chatSessionToken = chatSessionTokenFromRequest(request);
    if (!admissionToken || !chatSessionToken) return json({ error: "Viewer access required" }, 403);
    const body = await readJsonBody(request, 16 * 1024);
    const receipt = await ingestMetricIntervals(getDb(), async (tx) => {
      const viewer = await resolveVerifiedPrivateChatViewer(tx, { ...scope.data, admissionToken, chatSessionToken, ipAddress });
      const admission = await tx.liveViewerSession.findUnique({
        where: { tokenHash: hashLiveViewerToken(admissionToken) },
        select: { id: true, vendorId: true, liveId: true },
      });
      if (!admission || admission.vendorId !== scope.data.vendorId || admission.liveId !== scope.data.liveId) throw new MetricIngestError("not_authorized");
      return { vendorId: scope.data.vendorId, liveId: scope.data.liveId, submissionId: viewer.submissionId, admissionId: admission.id };
    }, body, resolveMetricSessionContext);
    return json({ ok: true, ...receipt }, 200);
  } catch (error) {
    if (error instanceof LiveChatError) return json({ error: "Viewer access required" }, 403);
    if (error instanceof MetricIngestError) {
      if (error.code === "not_authorized") return json({ error: "Viewer access required" }, 403);
      if (error.code === "invalid_payload") return json({ error: "Invalid metric request" }, 400);
      if (error.code === "invalid_segment") return json({ error: "Invalid playback interval" }, 422);
      if (error.code === "retryable_conflict") return json({ error: "Metric collection temporarily unavailable" }, 503);
      return json({ error: "Metric evidence conflicts with the current session" }, 409);
    }
    // Neither SQL diagnostics nor viewer identity may enter public responses.
    return json({ error: "Unable to record metric evidence" }, 500);
  }
}
