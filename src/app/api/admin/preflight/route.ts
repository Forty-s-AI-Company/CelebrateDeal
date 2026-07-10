import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { getCloudflareStreamDiagnostics } from "@/lib/cloudflare-diagnostics";
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

  return NextResponse.json({
    ok: envReport.ok && database.status === "pass",
    environment: envReport,
    database,
    rateLimit: getRateLimitProviderStatus(),
    cloudflare: getCloudflareStreamDiagnostics(),
  });
}
