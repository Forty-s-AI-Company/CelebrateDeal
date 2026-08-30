import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

const TOKEN_VERSION = "ca1";
const TOKEN_PURPOSE = "public-checkout-admission";
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const TOKEN_PART = /^[A-Za-z0-9_-]{1,768}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const AdmissionPayload = z.object({
  vendorId: z.string().regex(IDENTIFIER),
  productId: z.string().regex(IDENTIFIER),
  productRevision: z.number().int().safe().nonnegative(),
  idempotencyKey: z.string().regex(UUID),
  expiresAt: z.number().int().safe(),
  sessionHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export const CHECKOUT_ADMISSION_COOKIE = "celebratedeal_checkout_session";
export const CHECKOUT_ADMISSION_TTL_MS = 30 * 60 * 1_000;
export const CHECKOUT_SESSION_TTL_SECONDS = 24 * 60 * 60;

export type CheckoutAdmissionBinding = {
  vendorId: string;
  productId: string;
  productRevision: number;
  idempotencyKey: string;
  expiresAt: Date;
};

function sessionHash(sessionToken: string) {
  return createHash("sha256").update(sessionToken).digest("hex");
}

function signature(payload: string) {
  return createHmac("sha256", deriveSensitiveDataKey(TOKEN_PURPOSE))
    .update(`${TOKEN_VERSION}.${payload}`)
    .digest("base64url");
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";").slice(0, 100)) {
    const separator = part.indexOf("=");
    if (separator <= 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return OPAQUE_TOKEN.test(value) ? value : null;
  }
  return null;
}

export function checkoutSessionTokenFromRequest(request: Request) {
  return readCookie(request, CHECKOUT_ADMISSION_COOKIE);
}

export function checkoutAdmissionCookieOptions(input: { secure: boolean }) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: input.secure,
    path: "/api/payments/checkout",
    maxAge: CHECKOUT_SESSION_TTL_SECONDS,
  };
}

export function issueCheckoutAdmission(input: {
  vendorId: string;
  productId: string;
  productRevision: number;
  idempotencyKey?: string | null;
  existingSessionToken?: string | null;
  now?: Date;
}) {
  if (
    !IDENTIFIER.test(input.vendorId)
    || !IDENTIFIER.test(input.productId)
    || !Number.isSafeInteger(input.productRevision)
    || input.productRevision < 0
    || (input.idempotencyKey != null && !UUID.test(input.idempotencyKey))
  ) throw new Error("Invalid checkout admission binding.");

  const now = input.now ?? new Date();
  const sessionToken = input.existingSessionToken && OPAQUE_TOKEN.test(input.existingSessionToken)
    ? input.existingSessionToken
    : randomBytes(32).toString("base64url");
  const idempotencyKey = input.idempotencyKey ?? randomUUID();
  const expiresAtSeconds = Math.floor((now.getTime() + CHECKOUT_ADMISSION_TTL_MS) / 1_000);
  const payload = Buffer.from(JSON.stringify({
    vendorId: input.vendorId,
    productId: input.productId,
    productRevision: input.productRevision,
    idempotencyKey,
    expiresAt: expiresAtSeconds,
    sessionHash: sessionHash(sessionToken),
  }), "utf8").toString("base64url");
  if (!TOKEN_PART.test(payload)) throw new Error("Checkout admission payload is too large.");

  return {
    admissionToken: `${TOKEN_VERSION}.${payload}.${signature(payload)}`,
    idempotencyKey,
    expiresAt: new Date(expiresAtSeconds * 1_000),
    sessionToken,
  };
}

export function verifyCheckoutAdmission(input: {
  admissionToken: string;
  sessionToken: string | null;
  now?: Date;
}): CheckoutAdmissionBinding | null {
  if (!input.sessionToken || !OPAQUE_TOKEN.test(input.sessionToken) || input.admissionToken.length > 900) return null;
  const [version, payload, suppliedSignature, extra] = input.admissionToken.split(".");
  if (
    version !== TOKEN_VERSION
    || !payload
    || !TOKEN_PART.test(payload)
    || !suppliedSignature
    || !SIGNATURE.test(suppliedSignature)
    || extra
  ) return null;

  const expected = Buffer.from(signature(payload), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = AdmissionPayload.safeParse(decoded);
  if (!parsed.success || parsed.data.sessionHash !== sessionHash(input.sessionToken)) return null;
  const value = parsed.data;

  const expiresAt = new Date(value.expiresAt * 1_000);
  if (expiresAt <= (input.now ?? new Date())) return null;
  return {
    vendorId: value.vendorId,
    productId: value.productId,
    productRevision: value.productRevision,
    idempotencyKey: value.idempotencyKey,
    expiresAt,
  };
}
