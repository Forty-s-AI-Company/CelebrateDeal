import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { processDueWebhookRetries } from "@/lib/webhook-retry";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const results = await processDueWebhookRetries();
  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
