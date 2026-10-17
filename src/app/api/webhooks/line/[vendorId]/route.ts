import { NextResponse } from "next/server";
import { applyVerifiedLineWebhookEvents } from "@/lib/line-webhook-events";
import { getDb } from "@/lib/db";
import { verifyLineSignature } from "@/lib/line-client";
import { unprotectLineOfficialAccountCredentials } from "@/lib/line-credentials";
import { findLineAccount } from "@/lib/line-account-routing";

const MAX_WEBHOOK_BYTES = 1_000_000;

export async function POST(request: Request, context: { params: Promise<{ vendorId: string; accountId?: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const { vendorId, accountId } = await context.params;
  if (!vendorId || vendorId.length > 128) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (accountId !== undefined && (!accountId || accountId.length > 128)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const account = await findLineAccount(getDb(), vendorId, accountId);
  // Consent withdrawal must still be recorded while an existing account is paused.
  if (!account) return NextResponse.json({ error: "not_found" }, { status: 404 });

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

  // Signature verification above remains the only entry to event persistence.
  try {
    const result = await applyVerifiedLineWebhookEvents(getDb(), vendorId, rawBody, new Date(), account.id);
    if (result.status === "invalid_payload") return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    if (result.status === "retry_later") return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
  } catch {
    // Fixed response only; do not expose provider identifiers or database errors.
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
