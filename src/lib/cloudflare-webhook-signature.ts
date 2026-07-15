import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_SIGNATURE_HEADER = "Webhook-Signature";
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export type CloudflareWebhookVerification =
  | { ok: true; mode: "official-signature" | "shared-secret-fallback" }
  | { ok: false; mode: "official-signature" | "shared-secret-fallback" | "missing"; reason: string };

function parseSignatureHeader(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Map<string, string>();
  for (const part of value.split(",")) {
    const [key, ...rest] = part.trim().split("=");
    if (key && rest.length > 0) {
      parsed.set(key, rest.join("="));
    }
  }

  return {
    time: parsed.get("time") ?? null,
    sig1: parsed.get("sig1") ?? null,
  };
}

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createCloudflareStreamWebhookSignature({
  body,
  secret,
  timestamp,
}: {
  body: string;
  secret: string;
  timestamp: number;
}) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function verifyCloudflareStreamWebhookSignature({
  header,
  body,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
}: {
  header: string | null;
  body: string;
  secret: string | undefined;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): CloudflareWebhookVerification {
  if (!secret?.trim()) {
    return { ok: false, mode: "official-signature", reason: "missing_webhook_signing_secret" };
  }

  const parsed = parseSignatureHeader(header);
  if (!parsed?.time || !parsed.sig1) {
    return { ok: false, mode: "official-signature", reason: "malformed_signature_header" };
  }

  const timestamp = Number.parseInt(parsed.time, 10);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, mode: "official-signature", reason: "invalid_timestamp" };
  }

  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, mode: "official-signature", reason: "expired_timestamp" };
  }

  const expected = createCloudflareStreamWebhookSignature({ body, secret, timestamp });
  if (!safeEqualHex(expected, parsed.sig1)) {
    return { ok: false, mode: "official-signature", reason: "invalid_signature" };
  }

  return { ok: true, mode: "official-signature" };
}

export function verifyCloudflareStreamWebhookRequest({
  request,
  body,
  sharedSecretHeader = "x-cloudflare-stream-webhook-secret",
  secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET,
}: {
  request: Request;
  body: string;
  sharedSecretHeader?: string;
  secret?: string;
}): CloudflareWebhookVerification {
  const officialHeader = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
  if (officialHeader) {
    return verifyCloudflareStreamWebhookSignature({
      header: officialHeader,
      body,
      secret,
    });
  }

  const isProduction = process.env.VERCEL_ENV === "production"
    || (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production");
  if (isProduction) {
    return { ok: false, mode: "missing", reason: "missing_webhook_signature" };
  }

  const fallbackSecret = request.headers.get(sharedSecretHeader);
  if (!secret?.trim() || !fallbackSecret) {
    return { ok: false, mode: "missing", reason: "missing_webhook_signature" };
  }

  const expected = Buffer.from(secret);
  const actual = Buffer.from(fallbackSecret);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, mode: "shared-secret-fallback", reason: "invalid_shared_secret" };
  }

  return { ok: true, mode: "shared-secret-fallback" };
}
