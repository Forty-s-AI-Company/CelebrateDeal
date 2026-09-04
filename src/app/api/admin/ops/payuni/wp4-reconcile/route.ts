import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import {
  reconcileWp4PayUniSandboxRefund,
  type Wp4PayUniSandboxReconciliationResult,
} from "@/lib/wp4-payuni-sandbox-reconciliation";
import {
  resolveWp4ExpectedSourceSha,
  wp4SourceMatchesRequest,
} from "@/lib/wp4-preview-runtime";

function unavailableResponse(status = 404) {
  return NextResponse.json(
    { error: status === 503 ? "Service unavailable" : "Not found" },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function resultStatus(result: Wp4PayUniSandboxReconciliationResult) {
  if (result.reconciled) return 200;
  if (result.status === "FIXTURE_UNAVAILABLE") return 404;
  if (result.status === "CANDIDATE_AMBIGUOUS" || result.status === "PENDING_RESERVATION_UNAVAILABLE" || result.status === "REFUND_NOT_CONFIRMED") return 409;
  return 503;
}

function previewSandboxExecutorEnabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.PAYUNI_ENV === "sandbox"
    && process.env.WP4_SANDBOX_EXECUTOR_ENABLED === "true";
}

/**
 * Reconciles or verifies the deployment-owned WP4 Sandbox buyer-order refund.
 * The caller supplies no transaction, amount, provider URL, or other operation.
 */
export async function POST(request: Request) {
  // Reject unauthenticated callers before consuming a body or accessing the DB.
  if (!requireJobSecret(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!previewSandboxExecutorEnabled()) return unavailableResponse();

  const expectedSha = resolveWp4ExpectedSourceSha();
  if (!expectedSha) return unavailableResponse(503);
  if (!wp4SourceMatchesRequest(request, expectedSha)) return unavailableResponse();
  if (await requestHasNonEmptyBody(request)) return unavailableResponse();

  try {
    const result = await reconcileWp4PayUniSandboxRefund(getDb(), expectedSha);
    return NextResponse.json(result, {
      status: resultStatus(result),
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return unavailableResponse(503);
  }
}
