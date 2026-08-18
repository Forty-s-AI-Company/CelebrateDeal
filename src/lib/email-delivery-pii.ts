import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";

const RECIPIENT_ENVELOPE_PURPOSE = "email-delivery-recipient";
const RECIPIENT_HASH_PURPOSE = "email-delivery-recipient-hash";
const UNSUBSCRIBE_TOKEN_PURPOSE = "email-delivery-unsubscribe";
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

function isPrivateOrSpecialIpv4(value: string) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first = Number.NaN, second = Number.NaN] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function parseIpv6Segments(value: string) {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const rawSegments = [...left, ...right];
  if (rawSegments.some((segment) => segment === "")) return null;

  const segments = rawSegments.flatMap((segment, index) => {
    if (!segment.includes(".")) return [/^[0-9a-f]{1,4}$/iu.test(segment) ? Number.parseInt(segment, 16) : Number.NaN];
    if (index !== rawSegments.length - 1) return [Number.NaN, Number.NaN];
    const octets = segment.split(".").map(Number);
    const [
      firstOctet = Number.NaN,
      secondOctet = Number.NaN,
      thirdOctet = Number.NaN,
      fourthOctet = Number.NaN,
    ] = octets;
    return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
      ? [(firstOctet << 8) | secondOctet, (thirdOctet << 8) | fourthOctet]
      : [Number.NaN, Number.NaN];
  });
  const zeroCount = halves.length === 2 ? 8 - segments.length : 0;
  if (zeroCount < (halves.length === 2 ? 1 : 0) || segments.length + zeroCount !== 8) return null;
  const expanded = halves.length === 2
    ? [...segments.slice(0, left.length), ...Array.from({ length: zeroCount }, () => 0), ...segments.slice(left.length)]
    : segments;
  return expanded.every((segment) => Number.isInteger(segment) && segment >= 0 && segment <= 0xffff) ? expanded : null;
}

function isUnsafeContactHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.+$/u, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const version = isIP(host);
  if (version === 4) return isPrivateOrSpecialIpv4(host);
  if (version !== 6) return false;
  const segments = parseIpv6Segments(host);
  if (!segments) return true;
  const [
    firstSegment = Number.NaN,
    secondSegment = Number.NaN,
    thirdSegment = Number.NaN,
    fourthSegment = Number.NaN,
    fifthSegment = Number.NaN,
    sixthSegment = Number.NaN,
    seventhSegment = Number.NaN,
    eighthSegment = Number.NaN,
  ] = segments;
  const isAllZero = segments.every((segment) => segment === 0);
  const isLoopback = !isAllZero && [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment, sixthSegment, seventhSegment].every((segment) => segment === 0) && eighthSegment === 1;
  const isUniqueLocal = (firstSegment & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstSegment & 0xffc0) === 0xfe80;
  const isIpv4Mapped = [firstSegment, secondSegment, thirdSegment, fourthSegment, fifthSegment].every((segment) => segment === 0) && sixthSegment === 0xffff;
  if (!isIpv4Mapped) return isAllZero || isLoopback || isUniqueLocal || isLinkLocal;
  const mappedIpv4 = [seventhSegment >> 8, seventhSegment & 0xff, eighthSegment >> 8, eighthSegment & 0xff].join(".");
  return isPrivateOrSpecialIpv4(mappedIpv4);
}

function normalizedContactUrl(value: unknown) {
  if (typeof value !== "string" || value.length > BRAND_CONTACT_URL_MAX_LENGTH || /\p{Cc}/u.test(value)) return undefined;
  const candidate = value.trim();
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || isUnsafeContactHostname(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
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
