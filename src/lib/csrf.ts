import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { AUTH_COOKIE } from "@/lib/auth";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";

export { CSRF_FIELD_NAME };

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

function csrfSecret() {
  return process.env.CSRF_SECRET ?? process.env.JOB_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "development-csrf-secret");
}

function sign(value: string) {
  const secret = csrfSecret();
  if (!secret) {
    throw new Error("CSRF_SECRET or JOB_SECRET must be configured in production.");
  }
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function sessionFingerprint() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE)?.value ?? "anonymous";
  return sign(sessionToken).slice(0, 32);
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

  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  if (host) {
    const proto = headerStore.get("x-forwarded-proto") ?? (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
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
  return `${body}.${sign(body)}`;
}

export async function verifyCsrfToken(token: string | null | undefined) {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 4) return false;

  const [issuedAtValue, nonce, fingerprint, signature] = parts;
  const issuedAt = Number.parseInt(issuedAtValue, 10);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > TOKEN_TTL_MS || issuedAt - Date.now() > 60_000) {
    return false;
  }

  if (fingerprint !== await sessionFingerprint()) return false;

  const body = `${issuedAtValue}.${nonce}.${fingerprint}`;
  return safeEqual(sign(body), signature);
}

export async function assertServerActionSecurity(formData: FormData) {
  await assertServerActionOrigin();
  const token = formData.get(CSRF_FIELD_NAME);
  if (typeof token !== "string" || !await verifyCsrfToken(token)) {
    throw new Error("Invalid CSRF token.");
  }
}
