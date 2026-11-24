import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { isVercelDeployment } from "./vercel-runtime";

const MAX_SINGLE_IP_HEADER_LENGTH = 128;
const MAX_FORWARDED_HEADER_LENGTH = 2_048;
const MAX_FORWARDED_HOPS = 16;
export const LIVE_CHAT_INGRESS_PROOF_HEADER = "x-celebratedeal-live-chat-ingress";
export const LIVE_CHAT_INGRESS_SECRET_MIN_LENGTH = 32;
export const LIVE_CHAT_INGRESS_SECRET_MAX_LENGTH = 256;

export type ClientIpSource = "cf-connecting-ip" | "x-real-ip" | "x-forwarded-for" | "runtime-ip";
export type ClientIpTrustMode = "vercel-edge" | "local-forwarded" | "cloudflare" | "trusted-proxy" | "runtime" | "none";
export type ClientIpDeploymentSource = "cloudflare" | "vercel" | "node" | "none";

/** Anything that can answer header lookups: `Request`, `Headers`, or `await headers()`. */
export type ClientIpHeaderSource = Request | { get(name: string): string | null };

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
    (config.trustMode === "vercel-edge" && config.deploymentSource === "vercel")
    || (config.trustMode === "local-forwarded" && config.deploymentSource === "node")
    || (config.trustMode === "cloudflare" && config.deploymentSource === "cloudflare")
    || (config.trustMode === "trusted-proxy" && config.deploymentSource === "vercel")
    || (config.trustMode === "runtime" && config.deploymentSource === "node")
    || (config.trustMode === "none" && config.deploymentSource === "none")
  );
}

type HeaderReader = { get(name: string): string | null };

function isRequestLike(source: ClientIpHeaderSource): source is Request {
  return typeof (source as Partial<Request>).headers?.get === "function";
}

function headerReader(source: ClientIpHeaderSource): HeaderReader {
  return isRequestLike(source) ? source.headers : source;
}

function runtimeIp(source: ClientIpHeaderSource) {
  if (!isRequestLike(source)) return null;
  const candidate = (source as Request & { ip?: unknown }).ip;
  return typeof candidate === "string" ? canonicalizeIp(candidate) : null;
}

export { isVercelDeployment };

/**
 * Resolve the client address under an explicit trust configuration.
 *
 * - `vercel-edge`: Vercel's edge sets `x-real-ip` and overwrites
 *   `x-forwarded-for` on every request (it does not forward a client-sent
 *   value), and a Vercel Function is only reachable through that edge.
 * - `local-forwarded`: local development and tests only. Next's own server
 *   fills `x-forwarded-for` with the socket address when it is absent, but
 *   keeps a client-sent value, so this mode must never face the internet.
 * - `cloudflare` / `trusted-proxy`: the live chat ingress-proof contract for
 *   a non-Vercel runtime behind an edge that injects the proof header.
 *
 * `cf-connecting-ip`, `true-client-ip`, `x-client-ip` and `forwarded` are
 * never read outside the proof-gated `cloudflare` mode: the production domain
 * does not go through Cloudflare (O-7), so any client can send them.
 * A present but malformed trusted header fails closed (null).
 */
export function getRequestClientIpWithSource(
  source: ClientIpHeaderSource,
  config: ClientIpTrustConfig,
): { ip: string; source: ClientIpSource } | null {
  if (!isTrustedConfiguration(config)) return null;
  if (config.trustMode === "none") return null;
  const headers = headerReader(source);

  if (config.trustMode === "vercel-edge" || config.trustMode === "local-forwarded") {
    const realIp = headers.get("x-real-ip");
    if (realIp !== null) {
      const ip = canonicalizeIp(realIp);
      return ip ? { ip, source: "x-real-ip" } : null;
    }
    const forwardedFor = headers.get("x-forwarded-for");
    const forwardedIp = forwardedFor === null ? null : firstForwardedIp(forwardedFor);
    if (forwardedIp) return { ip: forwardedIp, source: "x-forwarded-for" };
    if (forwardedFor !== null || config.trustMode === "vercel-edge") return null;
    const ip = runtimeIp(source);
    return ip ? { ip, source: "runtime-ip" } : null;
  }

  // The proof-gated modes need the full request (proof header + runtime IP).
  if (!isRequestLike(source)) return null;
  const request = source;

  if (config.trustMode === "cloudflare") {
    // cf-ray is metadata, not proof that the request came through a trusted
    // edge. Only the dedicated edge-overwritten proof authorizes this header.
    if (!hasValidIngressProof(request, config.ingressSecret)) return null;
    const ip = canonicalizeIp(request.headers.get("cf-connecting-ip"));
    return ip ? { ip, source: "cf-connecting-ip" } : null;
  }

  if (config.trustMode === "trusted-proxy") {
    if (!hasValidIngressProof(request, config.ingressSecret)) return null;
    // A proxy in front of the runtime. x-real-ip is the proxy-resolved
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

export function getRequestClientIp(source: ClientIpHeaderSource, config: ClientIpTrustConfig): string | null {
  return getRequestClientIpWithSource(source, config)?.ip ?? null;
}

/**
 * A-04-03 / D-20: the one IP trust rule for rate limiting and IP logging.
 *
 * - Deployed on Vercel (Preview/Production): the edge-set `x-real-ip`, else
 *   the edge-overwritten `x-forwarded-for`.
 * - Local development and tests (NODE_ENV is not production): the same
 *   headers as set by the local Next server, else the runtime address.
 * - Any other production runtime (CI build smoke, `next start` on a laptop,
 *   self-hosting) is not a supported deployment: no address is trusted and
 *   callers get null, which the limiter counts in one shared bucket.
 */
export function clientIpTrustConfig(env: NodeJS.ProcessEnv = process.env): ClientIpTrustConfig {
  if (isVercelDeployment(env)) return { trustMode: "vercel-edge", deploymentSource: "vercel" };
  if (env.NODE_ENV !== "production") return { trustMode: "local-forwarded", deploymentSource: "node" };
  return { trustMode: "none", deploymentSource: "none" };
}

/** Trusted client IP for limiter keys, audit rows, sessions and Turnstile. Null when unknown. */
export function getTrustedClientIp(source: ClientIpHeaderSource, env: NodeJS.ProcessEnv = process.env): string | null {
  return getRequestClientIp(source, clientIpTrustConfig(env));
}

/** The only headers getTrustedClientIp reads (vercel-edge and local-forwarded modes). */
export const TRUSTED_CLIENT_IP_HEADERS = ["x-real-ip", "x-forwarded-for"] as const;

/**
 * Server actions rebuild a Request for checkRateLimit from `await headers()`.
 * Copy exactly the headers the trust rule reads, so the limiter resolves the
 * same address as getTrustedClientIp(headerStore) and spoofable alternates
 * (cf-connecting-ip, true-client-ip, ...) never reach it.
 */
export function copyTrustedClientIpHeaders(from: { get(name: string): string | null }, into = new Headers()) {
  for (const name of TRUSTED_CLIENT_IP_HEADERS) {
    const value = from.get(name);
    if (value) into.set(name, value);
  }
  return into;
}
