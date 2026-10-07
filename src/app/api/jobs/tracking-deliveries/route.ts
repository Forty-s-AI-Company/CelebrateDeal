import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { runPurchaseTrackingBatch } from "@/lib/tracking-purchase-worker";

const Input = z.object({ vendorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), limit: z.number().int().min(1).max(20).optional() }).strict();

/** Explicit Preview test-event executor; production transmission is not wired here. */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();
  if (process.env.VERCEL_ENV !== "preview" || process.env.META_TRACKING_TEST_DELIVERY_ENABLED !== "true") {
    return NextResponse.json({ ok: false, error: "tracking_executor_disabled" }, { status: 403 });
  }
  const input = Input.safeParse(await readJsonBody(request, 2048));
  if (!input.success) return NextResponse.json({ ok: false, error: "invalid_tracking_batch" }, { status: 400 });
  const apiVersion = process.env.META_GRAPH_API_VERSION;
  // Select no historical/default Graph version silently. An approved binding
  // must be supplied before an authenticated job can issue provider requests.
  if (!apiVersion || !/^v\d{1,3}\.0$/u.test(apiVersion)) {
    return NextResponse.json({ ok: false, error: "tracking_provider_not_configured" }, { status: 202 });
  }
  try {
    const result = await runPurchaseTrackingBatch({ ...input.data, apiVersion });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: "tracking_job_failed" }, { status: 503 });
  }
}
