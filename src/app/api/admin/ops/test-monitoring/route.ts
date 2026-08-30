import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { captureSyntheticMonitoringError } from "@/lib/monitoring";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const result = await captureSyntheticMonitoringError({
    source: "admin_ops",
    checkedAt: new Date().toISOString(),
  });

  if (!result.captured) {
    return NextResponse.json(
      { ok: false, error: "Monitoring provider is not configured" },
      { status: 503 },
    );
  }

  if (!result.flushed) {
    return NextResponse.json(
      { ok: false, error: "Monitoring provider flush failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
