import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyLineSignature } from "@/lib/line-client";
import { unprotectLineOfficialAccountCredentials } from "@/lib/line-credentials";

const MAX_WEBHOOK_BYTES = 1_000_000;

export async function POST(request: Request, context: { params: Promise<{ vendorId: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const { vendorId } = await context.params;
  if (!vendorId || vendorId.length > 128) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const account = await getDb().lineOfficialAccount.findUnique({ where: { vendorId } });
  if (!account || account.status !== "active") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const signature = request.headers.get("x-line-signature") ?? "";
  let valid = false;
  try {
    const credentials = unprotectLineOfficialAccountCredentials(vendorId, account);
    valid = verifyLineSignature(rawBody, signature, credentials.messagingChannelSecret);
  } catch {
    valid = false;
  }
  if (!valid) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  // The current campaign uses push notifications; webhook events are acknowledged
  // only after signature validation. Event-specific ingestion can be added without
  // weakening this raw-body verification boundary.
  return NextResponse.json({ ok: true });
}
