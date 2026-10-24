import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { AUTH_COOKIE } from "@/lib/auth";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import { deriveCsrfMacKey } from "@/lib/sensitive-data";

export { CSRF_FIELD_NAME };

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

function csrfSecret() {
  const configured = process.env.CSRF_SECRET?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") return "";

  return process.env.JOB_SECRET?.trim() || "development-csrf-secret";
}

// CSRF_SECRET is also the sensitive-data KDF root, and the session cookie is
// attacker-controlled. HMAC(root, cookie) would therefore let anyone read
// derived keys (e.g. cookie "CelebrateDeal:mfa-encryption"). CSRF MACs use
// deriveCsrfMacKey (KDF purpose "csrf-hmac-v1"), and every message carries a tag so the
// fingerprint and token MACs cannot stand in for each other.
const FINGERPRINT_TAG = "csrf-fp:v1:";
const TOKEN_TAG = "csrf-token:v1:";

function csrfKey() {
  const secret = csrfSecret();
  if (!secret) {
    throw new Error("CSRF_SECRET must be configured in production.");
  }
  return deriveCsrfMacKey(secret);
}

function sign(tag: typeof FINGERPRINT_TAG | typeof TOKEN_TAG, value: string) {
  return createHmac("sha256", csrfKey()).update(`${tag}${value}`).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function sessionFingerprint() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE)?.value ?? "anonymous";
  return sign(FINGERPRINT_TAG, sessionToken).slice(0, 32);
}

function originFrom(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

async function allowedServerActionOrigins() {
  const headerStore = await headers();
  const origins = new Set<string>();
  const configured = originFrom(process.env.NEXT_PUBLIC_APP_URL ?? null);
  if (configured) origins.add(configured);

  // Do not let a forwarded header expand the application allowlist. Legitimate
  // public origins are represented by NEXT_PUBLIC_APP_URL or the actual Host.
  const host = headerStore.get("host");
  if (host) {
    const proto = host.includes("localhost") || host.startsWith("127.") ? "http" : "https";
    origins.add(`${proto}://${host}`);
  }

  return origins;
}

export async function assertServerActionOrigin() {
  const headerStore = await headers();
  const incomingOrigin = originFrom(headerStore.get("origin")) ?? originFrom(headerStore.get("referer"));
  if (!incomingOrigin) return;

  const allowed = await allowedServerActionOrigins();
  if (!allowed.has(incomingOrigin)) {
    throw new Error("Invalid request origin.");
  }
}

export async function getCsrfToken() {
  const issuedAt = Date.now();
  const nonce = randomBytes(24).toString("base64url");
  const fingerprint = await sessionFingerprint();
  const body = `${issuedAt}.${nonce}.${fingerprint}`;
  return `${body}.${sign(TOKEN_TAG, body)}`;
}

export async function verifyCsrfToken(token: string | null | undefined) {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;

  const [issuedAtValue, nonce, fingerprint, signature] = parts;
  if (!issuedAtValue || !nonce || !fingerprint || !signature) return false;
  const issuedAt = Number.parseInt(issuedAtValue, 10);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > TOKEN_TTL_MS || issuedAt - Date.now() > 60_000) {
    return false;
  }

  if (fingerprint !== await sessionFingerprint()) return false;

  const body = `${issuedAtValue}.${nonce}.${fingerprint}`;
  return safeEqual(sign(TOKEN_TAG, body), signature);
}

export async function assertServerActionSecurity(formData: FormData) {
  await assertServerActionOrigin();
  const token = formData.get(CSRF_FIELD_NAME);
  if (typeof token !== "string" || !await verifyCsrfToken(token)) {
    throw new Error("Invalid CSRF token.");
  }
}
