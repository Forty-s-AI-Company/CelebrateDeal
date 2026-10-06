import { NextResponse } from "next/server";
import { requireJobSecret } from "./api-security";
import { requestHasNonEmptyBody } from "./http-request-body";
import { getStagingDatabaseIdentityReport, WP4_STAGING_BINDING } from "./database-identity";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "./wp4-preview-runtime";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";

type Environment = Readonly<Record<string, string | undefined>>;
function url(value: string | undefined) { try { return value ? new URL(value) : null; } catch { return null; } }
/** A disposable permit is process-owned, loopback-only and never valid on Vercel. */
function disposableRuntime(env: Environment) {
  if (env.VERCEL_PROJECT_ID || env.WP4_DISPOSABLE_RUNNER_MARKER !== "verified-loopback") return false;
  const app = url(env.NEXT_PUBLIC_APP_URL), database = url(env.DATABASE_URL), direct = url(env.DIRECT_URL);
  return app?.protocol === "http:" && app.hostname === "127.0.0.1" && app.port !== ""
    && database?.protocol === "postgresql:" && direct?.protocol === "postgresql:"
    && database.hostname === "127.0.0.1" && direct.hostname === "127.0.0.1"
    && database.port !== "" && database.port === direct.port
    && database.pathname === "/celebratedeal_test" && direct.pathname === database.pathname;
}
export function isWp4BoundNonProductionRuntime(env: Environment = process.env) {
  if (env.VERCEL_ENV !== "preview" || env.PAYUNI_ENV !== "sandbox" || env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true") return false;
  return disposableRuntime(env) || (env.VERCEL_PROJECT_ID === WP4_STAGING_BINDING.projectId
    && env.NEXT_PUBLIC_APP_URL === WP4_STAGING_BINDING.appOrigin && getStagingDatabaseIdentityReport(env).all_passed);
}
export function permitsWp4SyntheticPlan(vendorId: string, userId: string, planId: string) {
  return vendorId === WP4_SANDBOX_FIXTURE.vendorId && userId === WP4_SANDBOX_FIXTURE.userId
    && planId === WP4_SANDBOX_FIXTURE.planId && isWp4BoundNonProductionRuntime() && resolveWp4ExpectedSourceSha() !== null;
}
/** Next can use localhost internally while preserving the loopback listener Host.
 * Only an already verified disposable process admits this bounded alias. */
export function wp4RequestOriginMatches(request: Request, env: Environment = process.env) {
  const incoming = new URL(request.url), configured = url(env.NEXT_PUBLIC_APP_URL);
  if (!configured) return false;
  if (incoming.origin === configured.origin) return true;
  return disposableRuntime(env) && incoming.protocol === "http:" && incoming.hostname === "localhost"
    && incoming.port === configured.port && request.headers.get("host") === configured.host;
}
export function wp4Unavailable(status = 404, reason?: "RUNTIME_REJECTED" | "REQUEST_REJECTED") {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : status === 503 ? "Service unavailable" : "Not found" }, { status, headers: { "Cache-Control": "no-store", ...(reason ? { "x-celebratedeal-wp4-fixture": reason } : {}) } });
}
/** Bearer first; rejected requests cannot consume a body or touch database/provider. */
export async function authorizeWp4Ops(request: Request): Promise<{ sourceSha: string } | Response> {
  if (!requireJobSecret(request)) return wp4Unavailable(401);
  if (!isWp4BoundNonProductionRuntime()) return wp4Unavailable(404, "RUNTIME_REJECTED");
  const expected = resolveWp4ExpectedSourceSha();
  if (!expected) return wp4Unavailable(503);
  const incoming = new URL(request.url);
  if (!wp4RequestOriginMatches(request) || incoming.search || !wp4SourceMatchesRequest(request, expected)
    || await requestHasNonEmptyBody(request)) return wp4Unavailable(404, "REQUEST_REJECTED");
  return { sourceSha: expected };
}

export function wp4PlanSelectionAllowed(plan: { id: string; code: string; monthlyPriceCents: number }, vendorId: string, userId: string | undefined) {
  return plan.id === WP4_SANDBOX_FIXTURE.planId && plan.code === WP4_SANDBOX_FIXTURE.planCode
    && plan.monthlyPriceCents === 100 && permitsWp4SyntheticPlan(vendorId, userId ?? "", plan.id);
}

export function wp4FinanceUserId(context: { user?: { id: string } }) { return context.user?.id; }
export function wp4PlanScopeAllowed(planId: string, permit: boolean) {
  return planId !== WP4_SANDBOX_FIXTURE.planId || permit;
}
