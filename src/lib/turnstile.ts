/**
 * Cloudflare Turnstile bot protection for merchant registration and the
 * verification-mail resend (owner decision 2026-10-25).
 *
 * Configuration: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (widget, public) and
 * `TURNSTILE_SECRET_KEY` (server-side siteverify). Both are read on the
 * server at request time; the site key reaches the browser as a prop, so a
 * deployment can change it without a rebuild. When neither is set Turnstile is
 * disabled and the forms work without it (preflight warns, and refuses
 * `REGISTRATION_MODE=open` on a deployment). Exactly one of the two set is a
 * misconfiguration: the check fails closed and preflight fails.
 *
 * Verification fails closed: a missing token, a rejected token, a network
 * error, a timeout or an unexpected response all refuse the request.
 * Cloudflare's documented test keys are used only in tests.
 */
export const TURNSTILE_SITE_KEY_ENV = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
export const TURNSTILE_SECRET_KEY_ENV = "TURNSTILE_SECRET_KEY";
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Form field the widget fills. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";
/** Cloudflare documents tokens of up to 2048 characters. */
export const TURNSTILE_TOKEN_MAX_LENGTH = 2_048;
const SITEVERIFY_TIMEOUT_MS = 5_000;

export const TURNSTILE_ACTIONS = {
  register: "merchant_register",
  resendVerification: "merchant_email_verification_resend",
} as const;
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];

function configuredValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export type TurnstileConfig =
  | { status: "disabled" }
  | { status: "misconfigured" }
  | { status: "enabled"; siteKey: string; secretKey: string };

export function getTurnstileConfig(env: NodeJS.ProcessEnv = process.env): TurnstileConfig {
  const siteKey = configuredValue(env[TURNSTILE_SITE_KEY_ENV]);
  const secretKey = configuredValue(env[TURNSTILE_SECRET_KEY_ENV]);
  if (!siteKey && !secretKey) return { status: "disabled" };
  if (!siteKey || !secretKey) return { status: "misconfigured" };
  return { status: "enabled", siteKey, secretKey };
}

/** The site key a form should render, or null when no widget is needed. */
export function turnstileSiteKey(env: NodeJS.ProcessEnv = process.env) {
  const config = getTurnstileConfig(env);
  return config.status === "enabled" ? config.siteKey : null;
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
  const config = getTurnstileConfig(input.env);
  if (config.status === "disabled") return { ok: true, skipped: true };
  // Half-configured: the widget cannot be trusted to render or verify.
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
  const result = await response.json().catch(() => null) as { success?: unknown; action?: unknown } | null;
  if (!result || typeof result !== "object" || typeof result.success !== "boolean") return { ok: false, reason: "unavailable" };
  if (result.success !== true) return { ok: false, reason: "rejected" };
  // A token solved on the other form carries the other action. Cloudflare's
  // test secrets return no action, so only a present, different one refuses.
  if (typeof result.action === "string" && result.action !== "" && result.action !== input.action) return { ok: false, reason: "rejected" };
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
