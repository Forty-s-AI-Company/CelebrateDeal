/**
 * F-016 configuration shared by the smoke routes and the deployment preflight.
 * Pure functions over an environment record: no Next.js or database imports.
 */
type Environment = Readonly<Record<string, string | undefined>>;

export const MINIMUM_OPS_SMOKE_SECRET_LENGTH = 32;
/** Secrets the smoke bearer must never equal; reuse leaves the smoke endpoints closed. */
export const OPS_SMOKE_SECRET_REUSE_FORBIDDEN = [
  "JOB_SECRET",
  "CRON_SECRET",
  "CSRF_SECRET",
  "LIVE_CHAT_INGRESS_SECRET",
  "PAYUNI_LIVE_PROBE_JOB_SECRET",
] as const;
const REUSE_FORBIDDEN = OPS_SMOKE_SECRET_REUSE_FORBIDDEN;
const VENDOR_ID = /^[A-Za-z0-9_-]{1,128}$/u;

/**
 * The provider smoke endpoints (test email/analytics/monitoring and Cloudflare
 * upload/live input) have their own bearer. It is usable only when it is long
 * enough and differs from every scheduler, CSRF, ingress and probe secret, so a leaked cron/job
 * credential can never reach them and an unset or reused value leaves them
 * closed (401) instead of falling back to JOB_SECRET.
 */
export function opsSmokeSecret(env: Environment = process.env) {
  const secret = env.OPS_SMOKE_SECRET;
  if (!secret || secret.trim() !== secret || secret.length < MINIMUM_OPS_SMOKE_SECRET_LENGTH) return undefined;
  if (REUSE_FORBIDDEN.some((key) => secret === env[key])) return undefined;
  return secret;
}

/**
 * A smoke request carries only the OPS_SMOKE_SECRET bearer, so there is no
 * requester whose memberships could authorize a tenant. The only tenant a
 * smoke operation may touch is the one the deployment names in
 * SMOKE_VENDOR_ID; a missing or malformed value disables vendor-scoped smoke.
 */
export function opsSmokeVendorId(env: Environment = process.env) {
  const value = env.SMOKE_VENDOR_ID?.trim();
  return value && VENDOR_ID.test(value) ? value : null;
}
