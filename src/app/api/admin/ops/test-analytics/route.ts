import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { captureProductEvent } from "@/lib/product-analytics";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const result = await captureProductEvent({
    distinctId: "ops-smoke-test",
    event: "production_smoke_test",
    properties: {
      source: "admin_ops",
      checkedAt: new Date().toISOString(),
    },
  });

  return NextResponse.json({ ok: true, result });
}
