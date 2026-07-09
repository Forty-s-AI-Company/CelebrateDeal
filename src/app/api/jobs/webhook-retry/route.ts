import { NextResponse } from "next/server";
import { processDueWebhookRetries } from "@/lib/webhook-retry";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.JOB_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await processDueWebhookRetries();
  return NextResponse.json({
    ok: true,
    processed: results.length,
    results,
  });
}
