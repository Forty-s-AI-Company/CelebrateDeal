import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { getCloudflareStreamDiagnostics } from "@/lib/cloudflare-diagnostics";
import { getStagingDatabaseIdentityReport } from "@/lib/database-identity";
import { getDb } from "@/lib/db";
import { getEnvCheckReport } from "@/lib/env";
import { getRateLimitProviderStatus } from "@/lib/rate-limit";

export async function GET(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const envReport = getEnvCheckReport();
  let database: { status: "pass" | "fail"; message: string } = { status: "pass", message: "Database reachable" };

  try {
    await getDb().$queryRaw`SELECT 1`;
  } catch {
    database = {
      status: "fail",
      message: "Database unreachable",
    };
  }

  const databaseIdentity = getStagingDatabaseIdentityReport();
  const allPassed = database.status === "pass" && databaseIdentity.all_passed;

  return NextResponse.json({
    ok: envReport.ok && allPassed,
    environment: envReport,
    database,
    database_reachable: database.status === "pass",
    ...databaseIdentity,
    all_passed: allPassed,
    rateLimit: getRateLimitProviderStatus(),
    cloudflare: getCloudflareStreamDiagnostics(),
  });
}
