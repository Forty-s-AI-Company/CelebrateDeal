import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const MAX_SINGLE_IP_HEADER_LENGTH = 128;
const MAX_FORWARDED_HEADER_LENGTH = 2_048;
const MAX_FORWARDED_HOPS = 16;
export const LIVE_CHAT_INGRESS_PROOF_HEADER = "x-celebratedeal-live-chat-ingress";
export const LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH = 32;
export const LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH = 256;

export type ClientIpSource = "cf-connecting-ip" | "x-real-ip" | "runtime-ip";
export type ClientIpTrustMode = "cloudflare" | "trusted-proxy" | "runtime" | "none";
export type ClientIpDeploymentSource = "cloudflare" | "vercel" | "node" | "none";

export type ClientIpTrustConfig = {
  trustMode: ClientIpTrustMode;
  deploymentSource: ClientIpDeploymentSource;
  ingressSecret?: string | null;
};

function canonicalizeIp(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_SINGLE_IP_HEADER_LENGTH || /[\r\n,]/u.test(candidate)) {
    return null;
  }

  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version !== 6) return null;

  try {
    // WHATWG URL parsing gives IPv6 addresses a stable compressed form. The
    // brackets belong to the URL syntax, not to the value stored or compared.
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Normalizes a single proxy-provided IP without accepting comma/newline
 * injection. It is exported so blacklist and route tests share the exact
 * representation used by the request resolver.
 */
export function normalizeClientIp(value: string | null | undefined) {
  return canonicalizeIp(value);
}

function firstForwardedIp(value: string) {
  if (value.length > MAX_FORWARDED_HEADER_LENGTH || /[\r\n]/u.test(value)) return null;
  const entries = value.split(",");
  if (entries.length === 0 || entries.length > MAX_FORWARDED_HOPS) return null;

  // Validate every hop before using the first one. This preserves the
  // existing rate-limiter's client-first convention without treating an
  // attacker-controlled comma suffix as trustworthy input.
  const normalized = entries.map((entry) => canonicalizeIp(entry));
  if (normalized.some((entry) => entry === null)) return null;
  return normalized[0] ?? null;
}

function hasStrongIngressSecret(value: string | null | undefined) {
  return typeof value === "string"
    && value.length >= LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH
    && value.length <= LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH
    && Buffer.byteLength(value, "utf8") >= LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH
    && Buffer.byteLength(value, "utf8") <= LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH
    && value.trim() === value
    && !/[\r\n]/u.test(value);
}

function hasValidIngressProof(request: Request, secret: string | null | undefined) {
  if (!hasStrongIngressSecret(secret)) return false;

  const providedValue = request.headers.get(LIVE_CHAT_INGRESS_PROOF_HEADER);
  if (providedValue === null
    || providedValue.length > LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH
    || Buffer.byteLength(providedValue, "utf8") > LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH) {
    return false;
  }

  const expected = Buffer.from(secret!, "utf8");
  const provided = Buffer.from(providedValue, "utf8");

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

function isTrustedConfiguration(config: ClientIpTrustConfig) {
  return (
    (config.trustMode === "cloudflare" && config.deploymentSource === "cloudflare")
    || (config.trustMode === "trusted-proxy" && config.deploymentSource === "vercel")
    || (config.trustMode === "runtime" && config.deploymentSource === "node")
    || (config.trustMode === "none" && config.deploymentSource === "none")
  );
}

function runtimeIp(request: Request) {
  const candidate = (request as Request & { ip?: unknown }).ip;
  return typeof candidate === "string" ? canonicalizeIp(candidate) : null;
}

/**
 * Resolve the client address with the same Cloudflare-first order used by the
 * in-process rate limiter. A present but malformed Cloudflare header fails
 * closed instead of silently falling back to a spoofable forwarded value.
 */
export function getRequestClientIpWithSource(
  request: Request,
  config: ClientIpTrustConfig,
): { ip: string; source: ClientIpSource } | null {
  if (!isTrustedConfiguration(config)) return null;
  if (config.trustMode === "none") return null;

  if (config.trustMode === "cloudflare") {
    // cf-ray is metadata, not proof that the request came through a trusted
    // edge. Only the dedicated edge-overwritten proof authorizes this header.
    if (!hasValidIngressProof(request, config.ingressSecret)) return null;
    const ip = canonicalizeIp(request.headers.get("cf-connecting-ip"));
    return ip ? { ip, source: "cf-connecting-ip" } : null;
  }

  if (config.trustMode === "trusted-proxy") {
    if (!hasValidIngressProof(request, config.ingressSecret)) return null;
    // Vercel's edge is the trusted proxy. x-real-ip is the edge-resolved
    // address; if X-Forwarded-For is present, validate the entire chain and
    // require its client-first value to agree with x-real-ip.
    const ip = canonicalizeIp(request.headers.get("x-real-ip"));
    if (!ip) return null;
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor !== null && firstForwardedIp(forwardedFor) !== ip) return null;
    return { ip, source: "x-real-ip" };
  }

  const ip = runtimeIp(request);
  return ip ? { ip, source: "runtime-ip" } : null;
}

export function getRequestClientIp(request: Request, config: ClientIpTrustConfig): string | null {
  return getRequestClientIpWithSource(request, config)?.ip ?? null;
}
