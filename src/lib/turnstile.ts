import { getCanonicalAppUrl } from "@/lib/app-url";
import { TURNSTILE_ACTIONS, TURNSTILE_RESPONSE_FIELD, TURNSTILE_SCRIPT_URL, type TurnstileAction } from "@/lib/turnstile-constants";

export { TURNSTILE_ACTIONS, TURNSTILE_RESPONSE_FIELD, TURNSTILE_SCRIPT_URL, type TurnstileAction };

/**
 * Cloudflare Turnstile bot protection for merchant registration and the
 * verification-mail resend (owner decision 2026-10-25).
 *
 * Configuration: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (widget, public) and
 * `TURNSTILE_SECRET_KEY` (server-side siteverify). Both are read on the
 * server at request time; the site key reaches the browser as a prop, so a
 * deployment can change it without a rebuild. When neither is set Turnstile is
 * disabled and the forms work without it (preflight warns, and refuses
 * `REGISTRATION_MODE=open` on a deployment). Exactly one of the two set, or
 * Cloudflare's public test keys on a Vercel deployment, is a
 * misconfiguration: the check fails closed and preflight fails.
 *
 * Verification fails closed: a missing token, a rejected token, a network
 * error, a timeout, an unexpected response, a hostname outside this
 * deployment or another form's action all refuse the request. Only
 * Cloudflare's documented test secrets (which answer with a fixed hostname
 * and no action) skip the hostname and action checks.
 */
export const TURNSTILE_SITE_KEY_ENV = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
export const TURNSTILE_SECRET_KEY_ENV = "TURNSTILE_SECRET_KEY";
/** Optional comma-separated extra hostnames the widget may be solved on (e.g. the fixed staging or production domain). */
export const TURNSTILE_ALLOWED_HOSTNAMES_ENV = "TURNSTILE_ALLOWED_HOSTNAMES";
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare documents tokens of up to 2048 characters. */
export const TURNSTILE_TOKEN_MAX_LENGTH = 2_048;
const SITEVERIFY_TIMEOUT_MS = 5_000;
/** Cloudflare's documented dummy site keys and secrets (e.g. 1x00000000000000000000AA, 2x0000000000000000000000000000000AA). */
const CLOUDFLARE_TEST_KEY = /^[123]x0{20,31}[A-F]{2}$/u;

export function isCloudflareTurnstileTestKey(value: string) {
  return CLOUDFLARE_TEST_KEY.test(value);
}

function configuredValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isVercelDeployment(env: NodeJS.ProcessEnv) {
  return env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "production";
}

export type TurnstileConfig =
  | { status: "disabled" }
  | { status: "misconfigured"; reason: "partial" | "test_key_on_deployment" }
  | { status: "enabled"; siteKey: string; secretKey: string; testSecret: boolean };

export function getTurnstileConfig(env: NodeJS.ProcessEnv = process.env): TurnstileConfig {
  const siteKey = configuredValue(env[TURNSTILE_SITE_KEY_ENV]);
  const secretKey = configuredValue(env[TURNSTILE_SECRET_KEY_ENV]);
  if (!siteKey && !secretKey) return { status: "disabled" };
  if (!siteKey || !secretKey) return { status: "misconfigured", reason: "partial" };
  // Public test keys always pass (or always fail); they protect nothing on a real deployment.
  if (isVercelDeployment(env) && (isCloudflareTurnstileTestKey(siteKey) || isCloudflareTurnstileTestKey(secretKey))) {
    return { status: "misconfigured", reason: "test_key_on_deployment" };
  }
  return { status: "enabled", siteKey, secretKey, testSecret: isCloudflareTurnstileTestKey(secretKey) };
}

/** The site key a form should render, or null when no widget is needed. */
export function turnstileSiteKey(env: NodeJS.ProcessEnv = process.env) {
  const config = getTurnstileConfig(env);
  return config.status === "enabled" ? config.siteKey : null;
}

function hostOf(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hostnames a token may come from: the canonical app URL, this Vercel
 * preview's own URL (the only non-canonical origin the app serves forms on),
 * and any extra hosts in TURNSTILE_ALLOWED_HOSTNAMES. Never the request Host.
 */
export function turnstileAllowedHostnames(env: NodeJS.ProcessEnv = process.env) {
  const hosts = new Set<string>();
  try {
    const canonical = hostOf(getCanonicalAppUrl(env));
    if (canonical) hosts.add(canonical);
  } catch {
    // No canonical URL: only explicitly configured hosts remain.
  }
  if (env.VERCEL_ENV === "preview") {
    const preview = hostOf(env.VERCEL_URL?.trim());
    if (preview) hosts.add(preview);
  }
  for (const entry of (env[TURNSTILE_ALLOWED_HOSTNAMES_ENV] ?? "").split(",")) {
    const host = hostOf(entry.trim() || undefined);
    if (host) hosts.add(host);
  }
  return hosts;
}

export type TurnstileVerification =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: "missing" | "rejected" | "unavailable" };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Verifies a widget token with Cloudflare siteverify. `remoteIp` is optional
 * and only forwarded to Cloudflare. Never throws.
 */
export async function verifyTurnstileToken(input: {
  token: unknown;
  action: TurnstileAction;
  remoteIp?: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}): Promise<TurnstileVerification> {
  const env = input.env ?? process.env;
  const config = getTurnstileConfig(env);
  if (config.status === "disabled") return { ok: true, skipped: true };
  // Half-configured or test keys on a deployment: nothing can be trusted.
  if (config.status === "misconfigured") return { ok: false, reason: "unavailable" };
  const token = typeof input.token === "string" ? input.token.trim() : "";
  if (!token || token.length > TURNSTILE_TOKEN_MAX_LENGTH) return { ok: false, reason: "missing" };

  const body = new URLSearchParams({ secret: config.secretKey, response: token });
  const remoteIp = input.remoteIp?.trim();
  if (remoteIp && remoteIp.length <= 64) body.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };
  const result = await response.json().catch(() => null) as { success?: unknown; action?: unknown; hostname?: unknown } | null;
  if (!result || typeof result !== "object" || typeof result.success !== "boolean") return { ok: false, reason: "unavailable" };
  if (result.success !== true) return { ok: false, reason: "rejected" };
  // Test secrets answer with a fixed dummy hostname and no action.
  if (config.testSecret) return { ok: true, skipped: false };
  // A token solved on another site using the same widget, or on the other form, is refused.
  const hostname = typeof result.hostname === "string" ? result.hostname.toLowerCase() : "";
  if (!hostname || !turnstileAllowedHostnames(env).has(hostname)) return { ok: false, reason: "rejected" };
  if (result.action !== input.action) return { ok: false, reason: "rejected" };
  return { ok: true, skipped: false };
}

/** zh-TW copy for a refused verification, shared by the forms. */
export const TURNSTILE_ERROR_MESSAGES = {
  turnstile_failed: "請先完成「確認你是真人」的驗證，再重新送出。",
  turnstile_unavailable: "真人驗證服務暫時無法連線，請稍後再試。",
} as const;

export function turnstileErrorCode(result: Extract<TurnstileVerification, { ok: false }>) {
  return result.reason === "unavailable" ? "turnstile_unavailable" : "turnstile_failed";
}
