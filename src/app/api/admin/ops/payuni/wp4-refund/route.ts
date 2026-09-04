import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { executeNextWp4PayUniSandboxRefund } from "@/lib/wp4-payuni-sandbox-refund-execution";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";

function unavailable(status = 404) {
  return NextResponse.json(
    { error: status === 503 ? "Service unavailable" : "Not found" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function previewSandboxExecutorEnabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.PAYUNI_ENV === "sandbox"
    && process.env.WP4_SANDBOX_EXECUTOR_ENABLED === "true";
}

function responseStatus(status: Awaited<ReturnType<typeof executeNextWp4PayUniSandboxRefund>>["status"]) {
  if (status === "COMPLETED") return 200;
  if (status === "FIXTURE_UNAVAILABLE") return 404;
  if (status === "CANDIDATE_AMBIGUOUS" || status === "REFUND_NOT_ELIGIBLE") return 409;
  return 503;
}

/**
 * Performs at most one fixed WP4 Sandbox refund. The request body is rejected;
 * the target, amount and phase are selected entirely by server-owned current
 * source metadata. It is not exposed in Production.
 */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!previewSandboxExecutorEnabled()) return unavailable();

  const sourceCommit = resolveWp4ExpectedSourceSha();
  if (!sourceCommit) return unavailable(503);
  if (!wp4SourceMatchesRequest(request, sourceCommit)) return unavailable();
  if (await requestHasNonEmptyBody(request)) return unavailable();

  try {
    const result = await executeNextWp4PayUniSandboxRefund(getDb(), sourceCommit);
    return NextResponse.json(result, {
      status: responseStatus(result.status),
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return unavailable(503);
  }
}

