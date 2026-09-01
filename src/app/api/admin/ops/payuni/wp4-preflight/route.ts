import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/api-security";
import { isProductDeliveryReadyForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

const SOURCE_SHA_HEADER = "x-celebratedeal-source-sha";
const PREFLIGHT_OUTCOME_HEADER = "x-celebratedeal-wp4-preflight";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const PAYABLE_INVOICE_STATUSES = ["issued", "overdue"] as const;

function unavailableResponse(outcome?: "EXECUTOR_DISABLED" | "FIXTURE_UNAVAILABLE") {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (outcome) headers[PREFLIGHT_OUTCOME_HEADER] = outcome;
  return NextResponse.json({ error: "Not found" }, { status: 404, headers });
}

function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

function unavailableConfigurationResponse() {
  return NextResponse.json(
    { error: "Service unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function timingSafeShaEqual(sourceSha: string, deploymentSha: string) {
  const source = Buffer.from(sourceSha);
  const deployment = Buffer.from(deploymentSha);
  return source.length === deployment.length && timingSafeEqual(source, deployment);
}

function previewSandboxEnabled() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.PAYUNI_ENV === "sandbox"
    && process.env.WP4_SANDBOX_EXECUTOR_ENABLED === "true";
}

function serverConfiguration() {
  const configuration = {
    vendorId: WP4_SANDBOX_FIXTURE.vendorId,
    userId: WP4_SANDBOX_FIXTURE.userId,
    productId: WP4_SANDBOX_FIXTURE.productId,
    planId: WP4_SANDBOX_FIXTURE.planId,
    invoiceId: WP4_SANDBOX_FIXTURE.invoiceId,
    deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim(),
  };
  return Object.values(configuration).every(Boolean) && SHA_PATTERN.test(configuration.deploymentSha ?? "")
    ? configuration as Record<keyof typeof configuration, string>
    : null;
}

function sourceMatchesDeployment(request: Request, deploymentSha: string) {
  const sourceSha = request.headers.get(SOURCE_SHA_HEADER);
  return Boolean(
    sourceSha
    && SHA_PATTERN.test(sourceSha)
    && timingSafeShaEqual(sourceSha, deploymentSha),
  );
}

function requestHasBody(request: Request) {
  if (request.body !== null) return true;
  if (request.headers.has("transfer-encoding")) return true;
  const contentLength = request.headers.get("content-length")?.trim();
  return Boolean(contentLength && contentLength !== "0");
}

/**
 * Read-only fixture preflight for the approved WP4 Preview/Sandbox runner.
 * Identities and values are deployment-owned; caller input is never consumed.
 */
export async function POST(request: Request) {
  // Keep this first: unauthorized callers must not consume a body or touch the DB.
  if (!requireJobSecret(request)) {
    return unauthorizedResponse();
  }

  if (!previewSandboxEnabled()) {
    return unavailableResponse(process.env.VERCEL_ENV === "preview" ? "EXECUTOR_DISABLED" : undefined);
  }

  const configuration = serverConfiguration();
  if (!configuration) {
    return unavailableConfigurationResponse();
  }
  const { vendorId, userId, productId, planId, invoiceId, deploymentSha } = configuration;

  if (!sourceMatchesDeployment(request, deploymentSha)) {
    return unavailableResponse();
  }

  // This endpoint accepts no caller-owned values. Do not consume a rejected body.
  if (requestHasBody(request)) {
    return unavailableResponse();
  }

  try {
    const db = getDb();
    const membership = await db.vendorMember.findFirst({
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
      return unavailableResponse("FIXTURE_UNAVAILABLE");
    }

    const [product, billingPlan, invoice] = await Promise.all([
      db.product.findFirst({
        where: {
          id: productId,
          vendorId,
          isActive: true,
          fulfillmentTypeConfirmed: true,
          priceCents: { gt: 0 },
          inventory: { gt: 0 },
          checkoutUrl: null,
        },
        select: {
          id: true,
          fulfillmentType: true,
          deliveryConfig: {
            select: {
              id: true,
              revision: true,
              status: true,
              fulfillmentType: true,
              deliveryKind: true,
              title: true,
              destinationEncryptedEnvelope: true,
              destinationMaskedSummary: true,
              instructionsEncryptedEnvelope: true,
              instructionsMaskedSummary: true,
              allowlist: {
                select: {
                  hostname: true,
                  pathPrefix: true,
                  allowQuery: true,
                  status: true,
                },
              },
            },
          },
        },
      }),
      db.billingPlan.findFirst({
        where: { id: planId, isActive: true, monthlyPriceCents: { gt: 0 } },
        select: { id: true },
      }),
      db.invoice.findFirst({
        where: {
          id: invoiceId,
          vendorId,
          totalCents: { gt: 0 },
          status: { in: [...PAYABLE_INVOICE_STATUSES] },
        },
        select: { id: true },
      }),
    ]);

    if (!product || !isProductDeliveryReadyForCheckout(product, vendorId) || !billingPlan || !invoice) {
      return unavailableResponse("FIXTURE_UNAVAILABLE");
    }

    return NextResponse.json(
      {
        ready: true,
        buyerOrder: true,
        platformSubscription: true,
        invoicePayment: true,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return unavailableConfigurationResponse();
  }
}
