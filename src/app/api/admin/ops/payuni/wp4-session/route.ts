import { authorizeWp4Ops } from "@/lib/wp4-runtime-boundary";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { requestHasNonEmptyBody } from "@/lib/http-request-body";
import { WP4_PREVIEW_SESSION_TTL_SECONDS, createWp4PreviewMfaVerifiedSession } from "@/lib/auth";
import { AUTH_COOKIE, readSessionCookieToken, sessionCookieOptions } from "@/lib/session-cookie";
import { getDb } from "@/lib/db";
import { cookies } from "next/headers";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import {
  resolveWp4ExpectedSourceSha,
  wp4SourceMatchesRequest,
} from "@/lib/wp4-preview-runtime";


function unavailableResponse() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function unavailableConfigurationResponse() {
  return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
}

/**
 * Creates one tightly-scoped owner session for the approved WP4 sandbox runner.
 * This handler deliberately accepts no body: both identities are deployment-owned.
 */
export async function POST(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  // Keep this first: unauthorized callers must not consume a body or touch the DB.
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  // Production must be indistinguishable from a route that does not exist.
  if (process.env.VERCEL_ENV !== "preview") {
    return unavailableResponse();
  }

  if (process.env.PAYUNI_ENV !== "sandbox" || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true") {
    return unavailableResponse();
  }

  const vendorId = WP4_SANDBOX_FIXTURE.vendorId;
  const userId = WP4_SANDBOX_FIXTURE.userId;
  const deploymentSha = resolveWp4ExpectedSourceSha();
  if (!vendorId || !userId || !deploymentSha) {
    return unavailableConfigurationResponse();
  }

  if (!wp4SourceMatchesRequest(request, deploymentSha)) {
    return unavailableResponse();
  }

  // Vercel may represent an empty POST as a zero-byte ReadableStream. Reject
  // only actual caller content, so this protected endpoint remains usable
  // through the Preview proxy without accepting caller-owned inputs.
  if (await requestHasNonEmptyBody(request)) {
    return unavailableResponse();
  }

  try {
    const membership = await getDb().vendorMember.findFirst({
      where: {
        vendorId,
        userId,
        role: "owner",
        status: "active",
        user: { status: "active" },
      },
      select: { id: true },
    });
    if (!membership) {
      return unavailableResponse();
    }

    const { token, expiresAt } = await createWp4PreviewMfaVerifiedSession({
      userId,
      vendorId,
    });
    const response = new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
    // Exactly one Set-Cookie: the runner rejects any additional cookie, so the
    // legacy-name expiry that interactive sign-ins send is not added here.
    response.cookies.set(
      AUTH_COOKIE,
      token,
      sessionCookieOptions(expiresAt, WP4_PREVIEW_SESSION_TTL_SECONDS),
    );
    return response;
  } catch {
    return unavailableConfigurationResponse();
  }
}

/** Revoke only the fixed synthetic owner session created for this Preview run. */
export async function DELETE(request: Request) {
  const authorization = await authorizeWp4Ops(request);
  if (authorization instanceof Response) return authorization;
  if (!requireJobSecret(request)) return unauthorizedJson();
  if (process.env.VERCEL_ENV !== "preview"
    || process.env.PAYUNI_ENV !== "sandbox"
    || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true") return unavailableResponse();
  const deploymentSha = resolveWp4ExpectedSourceSha();
  if (!deploymentSha) return unavailableConfigurationResponse();
  if (!wp4SourceMatchesRequest(request, deploymentSha) || await requestHasNonEmptyBody(request)) {
    return unavailableResponse();
  }
  const token = readSessionCookieToken(await cookies());
  if (!token) return unavailableResponse();
  try {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await getDb().userSession.updateMany({
      where: {
        tokenHash,
        userId: WP4_SANDBOX_FIXTURE.userId,
        vendorId: WP4_SANDBOX_FIXTURE.vendorId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return result.count === 1
      ? new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } })
      : unavailableResponse();
  } catch {
    return unavailableConfigurationResponse();
  }
}
