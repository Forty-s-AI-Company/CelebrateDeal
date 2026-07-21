import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { releaseExpiredInventoryReservations } from "@/lib/inventory-reservations";
import { processDueWebhookRetries } from "@/lib/webhook-retry";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const inventory = await releaseExpiredInventoryReservations();
  const results = await processDueWebhookRetries();
  return NextResponse.json({
    ok: true,
    inventory,
    processed: results.length,
    results,
  });
}
