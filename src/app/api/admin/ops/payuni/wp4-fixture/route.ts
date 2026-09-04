import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import {
  ensureWp4SandboxFixture,
  Wp4SandboxFixtureConflictError,
} from "@/lib/wp4-sandbox-fixture";
import {
  resolveWp4ExpectedSourceSha,
  wp4SourceMatchesRequest,
} from "@/lib/wp4-preview-runtime";

const FIXTURE_OUTCOME_HEADER = "x-celebratedeal-wp4-fixture";
type FixtureClosedOutcome = "EXECUTOR_DISABLED" | "SOURCE_CONFIGURATION_UNAVAILABLE" | "SOURCE_MISMATCH" | "BODY_REJECTED";

function unavailableResponse(outcome?: FixtureClosedOutcome, status = 404) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (outcome) headers[FIXTURE_OUTCOME_HEADER] = outcome;
  return NextResponse.json(
    { error: "Not found" },
    { status, headers },
  );
}

function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

function previewSandboxEnabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.PAYUNI_ENV === "sandbox"
    && process.env.WP4_SANDBOX_EXECUTOR_ENABLED === "true";
}

/**
 * Idempotently creates only deterministic staging synthetic rows required by
 * the bounded WP4 PayUni Sandbox runner. No caller-owned fixture values exist.
 */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedResponse();
  if (!previewSandboxEnabled()) return unavailableResponse(process.env.VERCEL_ENV === "preview" ? "EXECUTOR_DISABLED" : undefined);
  const expectedSha = resolveWp4ExpectedSourceSha();
  if (!expectedSha) return unavailableResponse("SOURCE_CONFIGURATION_UNAVAILABLE", 503);
  if (!wp4SourceMatchesRequest(request, expectedSha)) return unavailableResponse("SOURCE_MISMATCH");
  if (await requestHasNonEmptyBody(request)) return unavailableResponse("BODY_REJECTED");

  try {
    const result = await ensureWp4SandboxFixture(getDb());
    return NextResponse.json(
      { ready: true, createdCount: result.createdCount, reusedCount: result.reusedCount },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Wp4SandboxFixtureConflictError) {
      return NextResponse.json(
        { error: "Conflict" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

