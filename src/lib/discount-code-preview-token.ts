import "server-only";

import { z } from "zod";

import { DERIVED_KEY_ROTATIONS, signWithRotation, verifyWithRotation } from "@/lib/derived-key-rotation";

/**
 * A4-01 review MJ-1: a successful preview returns this short-lived token so
 * the buyer's checkout skips the guessing throttle (which may be full during
 * a busy live stream). It only proves "this browser already found this code
 * for this product"; it never carries or decides an amount. Checkout still
 * prices from the DiscountCode row and refuses a token whose revision no
 * longer matches it.
 */
const VERSION = "dcp1";
export const DISCOUNT_CODE_PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;
const ROTATION = DERIVED_KEY_ROTATIONS.discountCodePreview;
const TOKEN = /^dcp1\.([A-Za-z0-9_-]{1,700})\.([A-Za-z0-9_-]{43})$/u;

const Payload = z.object({
  v: z.string().min(1).max(128),
  p: z.string().min(1).max(128),
  c: z.string().regex(/^[A-Z0-9_-]{6,32}$/u),
  r: z.number().int().positive().max(2_000_000_000),
  e: z.number().int().positive(),
}).strict();

export type DiscountCodePreviewTokenScope = { vendorId: string; productId: string; normalizedCode: string };

export function issueDiscountCodePreviewToken(scope: DiscountCodePreviewTokenScope & { revision: number; now: Date }) {
  const payload = Buffer.from(JSON.stringify(Payload.parse({
    v: scope.vendorId, p: scope.productId, c: scope.normalizedCode, r: scope.revision,
    e: scope.now.getTime() + DISCOUNT_CODE_PREVIEW_TOKEN_TTL_MS,
  }))).toString("base64url");
  return `${VERSION}.${payload}.${signWithRotation(ROTATION, `${VERSION}.${payload}`)}`;
}

/**
 * The code revision the token was issued for, or null when the token is
 * malformed, forged, expired, or names another vendor, product or code.
 */
export function verifyDiscountCodePreviewToken(token: unknown, expected: DiscountCodePreviewTokenScope & { now: Date }) {
  if (typeof token !== "string") return null;
  const match = TOKEN.exec(token);
  if (!match) return null;
  const [, payload, signature] = match;
  try {
    // New purpose, so there is no legacy key to accept.
    if (verifyWithRotation(ROTATION, `${VERSION}.${payload}`, signature!, expected.now) !== "current") return null;
    const parsed = Payload.safeParse(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const value = parsed.data;
    if (value.e <= expected.now.getTime() || value.e > expected.now.getTime() + DISCOUNT_CODE_PREVIEW_TOKEN_TTL_MS) return null;
    if (value.v !== expected.vendorId || value.p !== expected.productId || value.c !== expected.normalizedCode) return null;
    return { revision: value.r };
  } catch {
    // Missing signing configuration or malformed encoding fails closed: the checkout uses the throttle.
    return null;
  }
}
