import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";

const ATTRIBUTION_COOKIE_PREFIX = "celebrate_attr_";
export const ATTRIBUTION_WINDOW_SECONDS = 60 * 60 * 24 * 30;
export const ATTRIBUTION_WINDOW_DAYS_MIN = 1;
export const ATTRIBUTION_WINDOW_DAYS_MAX = 90;
export type AttributionPolicy = "first_touch" | "last_touch";

export function normalizeAttributionPolicy(value: string | null | undefined): AttributionPolicy {
  return value === "first_touch" ? "first_touch" : "last_touch";
}

export function normalizeAttributionWindowDays(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 30;
  return Math.min(ATTRIBUTION_WINDOW_DAYS_MAX, Math.max(ATTRIBUTION_WINDOW_DAYS_MIN, Math.trunc(value ?? 30)));
}

export function attributionPolicyVersion(policy: AttributionPolicy, windowDays: number) {
  return `${policy.replace("_", "-")}-${normalizeAttributionWindowDays(windowDays)}d-v1`;
}

export function attributionCookieName(vendorId: string) {
  return `${ATTRIBUTION_COOKIE_PREFIX}${vendorId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

type AttributionTokenPayload = {
  version: 1;
  vendorId: string;
  clickId: string;
  affiliateId: string;
  issuedAt: number;
  expiresAt: number;
};

function attributionSecret() {
  const secret = process.env.ATTRIBUTION_SECRET
    ?? (process.env.NODE_ENV === "production" ? undefined : process.env.CSRF_SECRET ?? process.env.JOB_SECRET);
  return secret && secret.length >= 16 ? secret : null;
}

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function signAttributionToken(
  input: Pick<AttributionTokenPayload, "vendorId" | "clickId" | "affiliateId">,
  options: { secret?: string; now?: number; ttlSeconds?: number } = {},
) {
  const secret = options.secret ?? attributionSecret();
  if (!secret) throw new Error("Attribution signing is not configured");
  const issuedAt = options.now ?? Math.floor(Date.now() / 1000);
  const payload: AttributionTokenPayload = {
    version: 1,
    ...input,
    issuedAt,
    expiresAt: issuedAt + (options.ttlSeconds ?? ATTRIBUTION_WINDOW_SECONDS),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyAttributionToken(
  token: string | null | undefined,
  expectedVendorId: string,
  options: { secret?: string; now?: number } = {},
) {
  const secret = options.secret ?? attributionSecret();
  if (!token || !secret) return null;
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AttributionTokenPayload;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (payload.version !== 1 || payload.vendorId !== expectedVendorId || payload.expiresAt <= now || payload.issuedAt > now + 60) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(item.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function resolveRequestAttribution(request: Request, vendorId: string) {
  const token = verifyAttributionToken(cookieValue(request, attributionCookieName(vendorId)), vendorId);
  if (!token) return null;
  const tracking = await getDb().trackingSetting.findUnique({
    where: { vendorId },
    select: { attributionPolicy: true, attributionWindowDays: true },
  });
  const policy = normalizeAttributionPolicy(tracking?.attributionPolicy);
  const windowDays = normalizeAttributionWindowDays(tracking?.attributionWindowDays);
  const oldestAccepted = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const click = await getDb().affiliateClick.findFirst({
    where: {
      id: token.clickId,
      vendorId,
      affiliateId: token.affiliateId,
      createdAt: { gte: oldestAccepted },
      affiliate: { isActive: true },
    },
    include: { affiliate: true },
  });
  if (!click?.affiliate) return null;
  return {
    ...click,
    affiliate: click.affiliate,
    attributionPolicy: policy,
    attributionWindowDays: windowDays,
    policyVersion: attributionPolicyVersion(policy, windowDays),
  };
}
