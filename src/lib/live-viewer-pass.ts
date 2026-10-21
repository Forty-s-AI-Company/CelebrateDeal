import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Short-lived signed viewer pass (F-091 / B06-05).
 *
 * `/api/live-admission` issues it next to the opaque admission cookie after
 * the database admission succeeded, and renews it on every admission renewal.
 * High-frequency read polls (chat list, interaction state) verify only this
 * HMAC instead of reading `LiveViewerSession` every 2-3 seconds per viewer.
 *
 * The pass binds vendorId + liveId + viewer session id + a digest of the
 * admission cookie, so it cannot be replayed for another live, another tenant
 * or with another browser's admission token. Writes (posting, responding,
 * usage heartbeats, purchases) keep the authoritative database check.
 */

export const LIVE_VIEWER_PASS_COOKIE = "celebratedeal_live_pass";
export const LIVE_VIEWER_PASS_TTL_SECONDS = 10 * 60;

const PASS_VERSION = "lvp1";
const PASS_PURPOSE = "live-viewer-pass";
const MAX_PASS_LENGTH = 1_024;
const MAX_IDENTIFIER_LENGTH = 128;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{1,900}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const ADMISSION_BINDING_PATTERN = /^[0-9a-f]{32}$/u;

type PassClaims = {
  v: string;
  l: string;
  s: string;
  a: string;
  e: number;
};

export type LiveViewerPassClaim = {
  vendorId: string;
  liveId: string;
  viewerSessionId: string;
  expiresAt: Date;
};

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH;
}

function nowSeconds(now: Date) {
  const value = Math.floor(now.getTime() / 1_000);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid viewer pass clock.");
  return value;
}

/** Binds the pass to the httpOnly admission cookie without storing the cookie itself. */
export function liveViewerAdmissionBinding(admissionToken: string) {
  return createHash("sha256").update(`${PASS_PURPOSE}:${admissionToken}`).digest("hex").slice(0, 32);
}

function signature(signedValue: string) {
  return createHmac("sha256", deriveSensitiveDataKey(PASS_PURPOSE)).update(signedValue).digest("base64url");
}

export function createLiveViewerPass(input: {
  vendorId: string;
  liveId: string;
  viewerSessionId: string;
  admissionToken: string;
  now?: Date;
}) {
  if (!isIdentifier(input.vendorId) || !isIdentifier(input.liveId) || !isIdentifier(input.viewerSessionId) || !input.admissionToken) {
    throw new Error("Invalid viewer pass binding.");
  }
  const claims: PassClaims = {
    v: input.vendorId,
    l: input.liveId,
    s: input.viewerSessionId,
    a: liveViewerAdmissionBinding(input.admissionToken),
    e: nowSeconds(input.now ?? new Date()) + LIVE_VIEWER_PASS_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signedValue = `${PASS_VERSION}.${payload}`;
  return `${signedValue}.${signature(signedValue)}`;
}

function parseClaims(payload: string): PassClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const claims = parsed as Record<string, unknown>;
  if (Object.keys(claims).sort().join(",") !== "a,e,l,s,v") return null;
  if (!isIdentifier(claims.v) || !isIdentifier(claims.l) || !isIdentifier(claims.s)) return null;
  if (typeof claims.a !== "string" || !ADMISSION_BINDING_PATTERN.test(claims.a)) return null;
  if (typeof claims.e !== "number" || !Number.isSafeInteger(claims.e)) return null;
  return claims as PassClaims;
}

/**
 * Returns the claim only for a correctly signed, unexpired pass issued for
 * exactly this vendor/live and the admission cookie presented with it.
 */
export function verifyLiveViewerPass(
  pass: string | null | undefined,
  input: { vendorId: string; liveId: string; admissionToken: string | null | undefined; now?: Date },
): LiveViewerPassClaim | null {
  if (typeof pass !== "string" || pass.length === 0 || pass.length > MAX_PASS_LENGTH || !input.admissionToken) return null;
  const [version, payload, suppliedSignature, extra] = pass.split(".");
  if (
    version !== PASS_VERSION
    || !payload
    || !PAYLOAD_PATTERN.test(payload)
    || !suppliedSignature
    || !SIGNATURE_PATTERN.test(suppliedSignature)
    || extra !== undefined
  ) return null;

  const expected = Buffer.from(signature(`${PASS_VERSION}.${payload}`), "utf8");
  const supplied = Buffer.from(suppliedSignature, "utf8");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  const claims = parseClaims(payload);
  if (!claims) return null;
  const currentSeconds = nowSeconds(input.now ?? new Date());
  if (claims.e <= currentSeconds || claims.e > currentSeconds + LIVE_VIEWER_PASS_TTL_SECONDS) return null;
  if (claims.v !== input.vendorId || claims.l !== input.liveId) return null;
  const binding = Buffer.from(liveViewerAdmissionBinding(input.admissionToken), "utf8");
  const claimedBinding = Buffer.from(claims.a, "utf8");
  if (binding.length !== claimedBinding.length || !timingSafeEqual(binding, claimedBinding)) return null;

  return {
    vendorId: claims.v,
    liveId: claims.l,
    viewerSessionId: claims.s,
    expiresAt: new Date(claims.e * 1_000),
  };
}

function readCookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const segment of header.split(";").slice(0, 100)) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    const value = segment.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function liveViewerPassFromRequest(request: Request) {
  const value = readCookieValue(request.headers.get("cookie"), LIVE_VIEWER_PASS_COOKIE);
  return value && value.length <= MAX_PASS_LENGTH ? value : null;
}

export function liveViewerPassCookieOptions(request: Request, maxAge = LIVE_VIEWER_PASS_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge,
  };
}
