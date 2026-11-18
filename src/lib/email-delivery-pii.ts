import { createHmac } from "node:crypto";
import { parseSafeBrandContactUrl } from "@/lib/contact-url-safety-node";
import { DERIVED_KEY_ROTATIONS, signWithRotation, verifyWithRotation } from "@/lib/derived-key-rotation";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

const RECIPIENT_ENVELOPE_PURPOSE = "email-delivery-recipient";
const RECIPIENT_HASH_PURPOSE = "email-delivery-recipient-hash";
// Rotated after #485 (tier 3): links in sent mail must keep working, so the
// legacy key still verifies until its hard stop in derived-key-purposes.ts.
const UNSUBSCRIBE_TOKEN_KEY = DERIVED_KEY_ROTATIONS.emailUnsubscribe;
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const TOKEN_VERSION = "eu1";
const BRAND_SENDER_NAME_MAX_LENGTH = 80;
const BRAND_CONTACT_URL_MAX_LENGTH = 2_048;

export type EmailBrandSnapshot = {
  version: 1;
  senderName?: string;
  replyTo?: string;
  contactUrl?: string;
};

export type VendorEmailBrandSource = {
  senderName?: string | null;
  supportEmail?: string | null;
  contactUrl?: string | null;
};

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

function normalizedReplyTo(value: unknown) {
  if (typeof value !== "string" || /\p{Cc}/u.test(value)) return undefined;
  const candidate = value.trim().toLowerCase();
  if (
    candidate.length === 0
    || candidate.length > 320
    || /[\s<>,;]/u.test(candidate)
    || !/^[^@]+@[^@]+\.[^@]+$/u.test(candidate)
  ) return undefined;
  return candidate;
}

function normalizedSenderName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim().normalize("NFC");
  if (!candidate || Array.from(candidate).length > BRAND_SENDER_NAME_MAX_LENGTH || /\p{Cc}/u.test(candidate)) {
    return undefined;
  }
  return candidate;
}

function normalizedContactUrl(value: unknown) {
  if (typeof value !== "string" || value.length > BRAND_CONTACT_URL_MAX_LENGTH || /\p{Cc}/u.test(value)) return undefined;
  // Same rules as the brand settings save (#655 review): one implementation.
  return parseSafeBrandContactUrl(value) ?? undefined;
}

/**
 * Produces the only merchant-controlled fields that may enter an encrypted
 * delivery snapshot. Invalid legacy values are omitted instead of blocking a
 * transactional message.
 */
export function sanitizeEmailBrandSnapshot(value: unknown): EmailBrandSnapshot | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if ("version" in source && source.version !== 1) return undefined;
  const senderName = normalizedSenderName(source.senderName);
  const replyTo = normalizedReplyTo(source.version === 1 ? source.replyTo : source.supportEmail);
  const contactUrl = normalizedContactUrl(source.contactUrl);
  if (!senderName && !replyTo && !contactUrl) return undefined;
  return {
    version: 1,
    ...(senderName ? { senderName } : {}),
    ...(replyTo ? { replyTo } : {}),
    ...(contactUrl ? { contactUrl } : {}),
  };
}

export function createEmailBrandSnapshot(source: VendorEmailBrandSource): EmailBrandSnapshot {
  return sanitizeEmailBrandSnapshot(source) ?? { version: 1 };
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
  brand?: EmailBrandSnapshot | VendorEmailBrandSource;
}, binding: DeliveryBinding) {
  const normalized = normalizedEmail(input.recipientEmail);
  if (!input.subject.trim() || input.subject.length > 200 || !input.body.trim() || input.body.length > 25_000) {
    throw new Error("Invalid email delivery payload.");
  }
  const brand = sanitizeEmailBrandSnapshot(input.brand);
  return {
    payloadEncryptedEnvelope: encryptSensitiveValue(JSON.stringify({
      recipientEmail: normalized,
      subject: input.subject,
      body: input.body,
      ...(brand ? { brand } : {}),
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
  const brand = sanitizeEmailBrandSnapshot(parsed.brand);
  return {
    recipientEmail,
    subject: parsed.subject,
    body: parsed.body,
    ...(brand ? { brand } : {}),
  };
}

function unsubscribeSignedValue(deliveryId: string) {
  if (!SAFE_ID.test(deliveryId)) throw new Error("Invalid email delivery binding.");
  return `${TOKEN_VERSION}.${deliveryId}`;
}

export function createEmailUnsubscribeToken(deliveryId: string) {
  return `${TOKEN_VERSION}.${deliveryId}.${signWithRotation(UNSUBSCRIBE_TOKEN_KEY, unsubscribeSignedValue(deliveryId))}`;
}

export function verifyEmailUnsubscribeToken(token: string, now = new Date()) {
  const [version, deliveryId, signature, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !deliveryId || !signature || extra || !SAFE_ID.test(deliveryId)) return null;
  // The token carries no timestamp, so a legacy-key link relies on the hard stop alone.
  return verifyWithRotation(UNSUBSCRIBE_TOKEN_KEY, unsubscribeSignedValue(deliveryId), signature, now) ? deliveryId : null;
}

export function createEmailUnsubscribeUrl(deliveryId: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error("Public application URL is not configured.");
  const url = new URL("/unsubscribe", configured);
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("Public application URL is invalid.");
  url.searchParams.set("token", createEmailUnsubscribeToken(deliveryId));
  return url.toString();
}

// Exact envelope purpose for scripts/reencrypt-sensitive-data.ts (F-031).
export { recipientPurpose as emailDeliveryPayloadEnvelopePurpose };
