import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import {
  ensureWp4SandboxFixture,
  Wp4SandboxFixtureConflictError,
} from "@/lib/wp4-sandbox-fixture";

const SOURCE_SHA_HEADER = "x-celebratedeal-source-sha";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

function unavailableResponse() {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
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

function sourceMatchesDeployment(request: Request) {
  const sourceSha = request.headers.get(SOURCE_SHA_HEADER);
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (!sourceSha || !deploymentSha || !SHA_PATTERN.test(sourceSha) || !SHA_PATTERN.test(deploymentSha)) {
    return false;
  }
  const source = Buffer.from(sourceSha);
  const deployment = Buffer.from(deploymentSha);
  return source.length === deployment.length && timingSafeEqual(source, deployment);
}

function requestHasBody(request: Request) {
  if (request.body !== null) return true;
  if (request.headers.has("transfer-encoding")) return true;
  const contentLength = request.headers.get("content-length")?.trim();
  return Boolean(contentLength && contentLength !== "0");
}

/**
 * Idempotently creates only deterministic staging synthetic rows required by
 * the bounded WP4 PayUni Sandbox runner. No caller-owned fixture values exist.
 */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedResponse();
  if (!previewSandboxEnabled() || !sourceMatchesDeployment(request) || requestHasBody(request)) {
    return unavailableResponse();
  }

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
