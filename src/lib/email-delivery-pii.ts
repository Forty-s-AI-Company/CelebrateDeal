import { createHmac, timingSafeEqual } from "node:crypto";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

const RECIPIENT_ENVELOPE_PURPOSE = "email-delivery-recipient";
const RECIPIENT_HASH_PURPOSE = "email-delivery-recipient-hash";
const UNSUBSCRIBE_TOKEN_PURPOSE = "email-delivery-unsubscribe";
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const TOKEN_VERSION = "eu1";

type DeliveryBinding = {
  vendorId: string;
  deliveryId: string;
};

function assertBinding(binding: DeliveryBinding) {
  if (!SAFE_ID.test(binding.vendorId) || !SAFE_ID.test(binding.deliveryId)) {
    throw new Error("Invalid email delivery binding.");
  }
  return binding;
}

function normalizedEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("Invalid email delivery recipient.");
  }
  return email;
}

function recipientPurpose(binding: DeliveryBinding) {
  const safe = assertBinding(binding);
  return `${RECIPIENT_ENVELOPE_PURPOSE}:${safe.vendorId}:${safe.deliveryId}`;
}

export function createEmailRecipientHash(email: string, vendorId: string) {
  if (!SAFE_ID.test(vendorId)) throw new Error("Invalid email delivery binding.");
  return createHmac("sha256", deriveSensitiveDataKey(RECIPIENT_HASH_PURPOSE))
    .update(`${vendorId}\n${normalizedEmail(email)}`)
    .digest("base64url");
}

export function maskEmailRecipient(email: string) {
  const normalized = normalizedEmail(email);
  const [local, domain] = normalized.split("@");
  return `${local?.slice(0, 1) ?? ""}***@${domain}`;
}

export function protectEmailDeliveryPayload(input: {
  recipientEmail: string;
  subject: string;
  body: string;
}, binding: DeliveryBinding) {
  const normalized = normalizedEmail(input.recipientEmail);
  if (!input.subject.trim() || input.subject.length > 200 || !input.body.trim() || input.body.length > 25_000) {
    throw new Error("Invalid email delivery payload.");
  }
  return {
    payloadEncryptedEnvelope: encryptSensitiveValue(JSON.stringify({
      recipientEmail: normalized,
      subject: input.subject,
      body: input.body,
    }), recipientPurpose(binding)),
    recipientHash: createEmailRecipientHash(normalized, binding.vendorId),
    recipientMaskedEmail: maskEmailRecipient(normalized),
  };
}

export function revealEmailDeliveryPayload(envelope: string, binding: DeliveryBinding) {
  const parsed = JSON.parse(decryptSensitiveValue(envelope, recipientPurpose(binding))) as Record<string, unknown>;
  if (typeof parsed.recipientEmail !== "string" || typeof parsed.subject !== "string" || typeof parsed.body !== "string") {
    throw new Error("Invalid email delivery payload.");
  }
  const recipientEmail = normalizedEmail(parsed.recipientEmail);
  if (!parsed.subject.trim() || parsed.subject.length > 200 || !parsed.body.trim() || parsed.body.length > 25_000) {
    throw new Error("Invalid email delivery payload.");
  }
  return { recipientEmail, subject: parsed.subject, body: parsed.body };
}

function unsubscribeSignature(deliveryId: string) {
  if (!SAFE_ID.test(deliveryId)) throw new Error("Invalid email delivery binding.");
  return createHmac("sha256", deriveSensitiveDataKey(UNSUBSCRIBE_TOKEN_PURPOSE))
    .update(`${TOKEN_VERSION}.${deliveryId}`)
    .digest("base64url");
}

export function createEmailUnsubscribeToken(deliveryId: string) {
  return `${TOKEN_VERSION}.${deliveryId}.${unsubscribeSignature(deliveryId)}`;
}

export function verifyEmailUnsubscribeToken(token: string) {
  const [version, deliveryId, signature, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !deliveryId || !signature || extra || !SAFE_ID.test(deliveryId)) return null;
  const actual = Buffer.from(signature, "utf8");
  const expected = Buffer.from(unsubscribeSignature(deliveryId), "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? deliveryId : null;
}

export function createEmailUnsubscribeUrl(deliveryId: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error("Public application URL is not configured.");
  const url = new URL("/unsubscribe", configured);
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("Public application URL is invalid.");
  url.searchParams.set("token", createEmailUnsubscribeToken(deliveryId));
  return url.toString();
}
