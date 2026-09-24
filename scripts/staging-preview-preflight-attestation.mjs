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
  return { result: Object.values(checks).every(Boolean) ? "PASS" : "BLOCKED", checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await attestStagingPreview({
    host: process.env.CELEBRATEDEAL_DEPLOYMENT_HOST,
    jobSecret: process.env.JOB_SECRET,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.result !== "PASS") process.exitCode = 2;
}
