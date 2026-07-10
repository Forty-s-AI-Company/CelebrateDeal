import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const startedAt = Date.now();

  try {
    await getDb().$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "ok",
      latencyMs: Date.now() - startedAt,
    });
  } catch {
    return NextResponse.json({
      ok: false,
      database: "failed",
      latencyMs: Date.now() - startedAt,
      error: "Database health check failed",
    }, { status: 503 });
  }
}
