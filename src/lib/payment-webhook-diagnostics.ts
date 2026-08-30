import { createHash, timingSafeEqual } from "node:crypto";

function parseRawPayload(rawBody: string) {
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Object.fromEntries(new URLSearchParams(rawBody).entries()) as Record<string, unknown>;
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function payUniHashInfo(encryptInfo: string) {
  const key = process.env.PAYUNI_HASH_KEY?.trim();
  const iv = process.env.PAYUNI_HASH_IV?.trim();
  if (!key || !iv) return null;
  return createHash("sha256").update(`${key}${encryptInfo}${iv}`).digest("hex").toUpperCase();
}

function fieldSummary(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return {
    present: Boolean(text),
    length: text.length,
  };
}

export function buildPaymentWebhookDiagnostics(providerId: string, rawBody: string) {
  const raw = parseRawPayload(rawBody);
  const common = {
    provider: providerId,
    rawPayloadBytes: Buffer.byteLength(rawBody),
    rawPayloadStoragePolicy: "Sensitive raw fields are redacted before display and audit snapshots.",
  };

  if (providerId !== "payuni") {
    return common;
  }

  const encryptInfo = typeof raw.EncryptInfo === "string" ? raw.EncryptInfo : "";
  const hashInfo = typeof raw.HashInfo === "string" ? raw.HashInfo : "";
  const expectedHash = encryptInfo ? payUniHashInfo(encryptInfo) : null;

  return {
    ...common,
    payuni: {
      receivedFields: Object.keys(raw).sort(),
      expectedCheckoutFormFields: ["MerID", "Version", "EncryptInfo", "HashInfo"],
      encryptInfo: fieldSummary(encryptInfo),
      hashInfo: fieldSummary(hashInfo),
      hashInfoVerification: expectedHash && hashInfo ? (safeEqual(expectedHash, hashInfo.trim()) ? "pass" : "fail") : "not_checked",
      dashboardChecklist: [
        "PayUni UPP endpoint is selected from the approved PAYUNI_ENV mapping.",
        "MerID must match PAYUNI_MERCHANT_ID.",
        "HashKey and HashIV must be stored only in server-side env vars.",
        "NotifyURL and ReturnURL must point to /api/webhooks/payments?provider=payuni.",
      ],
    },
  };
}
