import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { processDueNotifications } from "@/lib/notifications";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();
  const results = await processDueNotifications();
  return NextResponse.json({ ok: true, processed: results.length, results });
}
