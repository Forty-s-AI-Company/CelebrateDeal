import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { AUTH_COOKIE, createWp4PreviewMfaVerifiedSession, sessionCookieOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

const SOURCE_SHA_HEADER = "x-celebratedeal-source-sha";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

function unavailableResponse() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function unavailableConfigurationResponse() {
  return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
}

function timingSafeShaEqual(sourceSha: string, deploymentSha: string) {
  const source = Buffer.from(sourceSha);
  const deployment = Buffer.from(deploymentSha);
  return source.length === deployment.length && timingSafeEqual(source, deployment);
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

  const vendorId = process.env.SMOKE_VENDOR_ID?.trim();
  const userId = process.env.WP4_SMOKE_OWNER_USER_ID?.trim();
  const deploymentSha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (!vendorId || !userId || !deploymentSha || !SHA_PATTERN.test(deploymentSha)) {
    return unavailableConfigurationResponse();
  }

  const sourceSha = request.headers.get(SOURCE_SHA_HEADER);
  if (!sourceSha || !SHA_PATTERN.test(sourceSha) || !timingSafeShaEqual(sourceSha, deploymentSha)) {
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
    response.cookies.set(AUTH_COOKIE, token, sessionCookieOptions(expiresAt));
    return response;
  } catch {
    return unavailableConfigurationResponse();
  }
}
