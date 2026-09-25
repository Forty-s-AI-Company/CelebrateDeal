import { pathToFileURL } from "node:url";

// This one-time attestation is bound to the reviewed PR #277 deployment.
const PREVIEW_HOST = "celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app";

/** Return only bounded, non-sensitive readiness evidence from the exact Preview. */
export async function attestStagingPreview({ host, jobSecret, fetchImpl = fetch }) {
  if (host !== PREVIEW_HOST) return { result: "BLOCKED", reason: "INVALID_PREVIEW_HOST" };
  if (typeof jobSecret !== "string" || jobSecret.length < 16) return { result: "BLOCKED", reason: "JOB_SECRET_UNAVAILABLE" };

  let response;
  try {
    response = await fetchImpl(`https://${host}/api/admin/preflight`, {
      method: "GET",
      headers: { Authorization: `Bearer ${jobSecret}` },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { result: "BLOCKED", reason: "PREFLIGHT_UNREACHABLE" };
  }
  if (response.status !== 200 || response.redirected) {
    return { result: "BLOCKED", reason: response.status === 401 ? "PREFLIGHT_UNAUTHORIZED" : "PREFLIGHT_HTTP_FAILURE" };
  }

  let report;
  try {
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("not-json");
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (!Number.isFinite(contentLength) || contentLength > 32_768) throw new Error("oversized");
    const body = await response.text();
    if (body.length > 32_768) throw new Error("oversized");
    report = JSON.parse(body);
  } catch {
    return { result: "BLOCKED", reason: "PREFLIGHT_RESPONSE_INVALID" };
  }

  const checks = {
    environment: report?.environment?.ok === true,
    databaseReachable: report?.database_reachable === true,
    supabaseIdentity: report?.supabase_url_match === true,
    runtimeDatabaseIdentity: report?.database_url_match === true,
    migrationDatabaseIdentity: report?.direct_url_match === true,
    stagingDatabaseIdentity: report?.staging_database_url_match === true,
    databaseIdentityGate: report?.all_passed === true,
  };
  // In this fixed Preview source, PayUni checks exist only when PayUni is the
  // selected provider. Return booleans only; never copy environment messages.
  const environmentChecks = Array.isArray(report?.environment?.checks) ? report.environment.checks : [];
  const uniqueCheck = (key) => {
    const matches = environmentChecks.filter((item) => item?.key === key);
    return matches.length === 1 ? matches[0] : null;
  };
  const payUniEnvironment = uniqueCheck("PAYUNI_ENV");
  const paymentBinding = {
    providerSelected: payUniEnvironment !== null,
    sandboxEnvironment: payUniEnvironment?.status === "pass",
    merchantCredentialsConfigured: ["PAYUNI_HASH_KEY", "PAYUNI_HASH_IV", "PAYUNI_MERCHANT_ID"]
      .every((key) => uniqueCheck(key)?.status === "pass"),
  };
  return {
    result: Object.values(checks).every(Boolean) && Object.values(paymentBinding).every(Boolean) ? "PASS" : "BLOCKED",
    checks,
    paymentBinding,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await attestStagingPreview({
    host: process.env.CELEBRATEDEAL_DEPLOYMENT_HOST,
    jobSecret: process.env.JOB_SECRET,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.result !== "PASS") process.exitCode = 2;
}
