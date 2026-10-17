import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { checkRateLimit } from "@/lib/trusted-entry-rate-limit";
import { getDb } from "@/lib/db";
import { prepareTrackedMetricVisit, collectPreparedMetricVisit } from "@/lib/live-metric-visit-collection";
import { MetricVisitorError } from "@/lib/live-metric-visitor";
import { metricVisitorProofsFromConfig } from "@/lib/live-metric-visitor-config";

export const runtime = "nodejs";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id }).strict();
const Body = z.discriminatedUnion("action", [z.object({ action: z.literal("prepare"), eventId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("visit"), eventId: z.string().uuid() }).strict()]);
const headers = { "Cache-Control": "private, no-store" };
const json = (value: unknown, status: number) => NextResponse.json(value, { status, headers });
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }

/** Browser must serialize prepare across tabs and retain its HttpOnly cookie
 * before submitting an event. No proof or visitor identity appears in JSON.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ vendorId: string; liveId: string }> }) {
  const denied = requireSameOriginRequest(request, { requireClientHeader: true });
  if (denied) return privateResponse(denied);
  try {
    const limited = await checkRateLimit(request, "live-metric-visit", 120, 60000);
    if (limited) return privateResponse(limited);
    const scope = Scope.safeParse(await context.params);
    const body = Body.safeParse(await readJsonBody(request, 1024));
    if (!scope.success || !body.success) return json({ error: "Invalid metric request" }, 400);
    const proofs = metricVisitorProofsFromConfig(process.env.LIVE_METRIC_VISITOR_KEYRING);
    if (!proofs) return json({ error: "Metric collection unavailable" }, 503);
    const name = `__Host-cd-metric-${createHash("sha256").update(JSON.stringify([scope.data.vendorId, scope.data.liveId])).digest("hex").slice(0, 32)}`;
    const cookies = request.cookies.getAll(name);
    if (cookies.length > 1) return json({ error: "Metric identity unavailable" }, 403);
    const proof = cookies[0]?.value ?? null;
    if (proof !== null && (!proof || proof.length > 2048)) return json({ error: "Metric identity unavailable" }, 403);
    const receipt = body.data.action === "prepare"
      ? await prepareTrackedMetricVisit(getDb(), proofs, scope.data, proof, { eventId: body.data.eventId })
      : await collectPreparedMetricVisit(getDb(), proofs, scope.data, { eventId: body.data.eventId }, proof);
    const response = json(body.data.action === "prepare" ? { ok: true, prepared: true, versionId: receipt.versionId }
      : { ok: true, eventId: body.data.eventId, versionId: receipt.versionId }, 200);
    response.cookies.set(name, receipt.proof, { httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: new Date(receipt.cookieExpiresAtMs) });
    return response;
  } catch (error) {
    if (error instanceof MetricVisitorError) {
      if (error.code === "PERSISTENCE_UNAVAILABLE") return json({ error: "Metric collection unavailable" }, 503);
      if (error.code.startsWith("PROOF_") || error.code === "VISITOR_MISSING") return json({ error: "Metric identity unavailable" }, 403);
      return json({ error: "Metric scope unavailable" }, 404);
    }
    return json({ error: "Metric collection unavailable" }, 503);
  }
}
