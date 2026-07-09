import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEnvCheckReport } from "@/lib/env";

export async function GET(request: Request) {
  const secret = process.env.JOB_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const envReport = getEnvCheckReport();
  let database: { status: "pass" | "fail"; message: string } = { status: "pass", message: "Database reachable" };

  try {
    await getDb().$queryRaw`SELECT 1`;
  } catch (error) {
    database = {
      status: "fail",
      message: error instanceof Error ? error.message : "Database unreachable",
    };
  }

  return NextResponse.json({
    ok: envReport.ok && database.status === "pass",
    environment: envReport,
    database,
  });
}
