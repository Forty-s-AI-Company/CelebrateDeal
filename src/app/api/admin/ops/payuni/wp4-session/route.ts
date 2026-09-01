import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import {
  AUTH_COOKIE,
  WP4_PREVIEW_SESSION_TTL_SECONDS,
  createWp4PreviewMfaVerifiedSession,
  sessionCookieOptions,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
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

  // The runner must not be able to smuggle client-owned identity or payment
  // inputs into this bootstrap endpoint. Reject a body without consuming it.
  if (request.body !== null) {
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
