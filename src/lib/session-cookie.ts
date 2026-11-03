/**
 * Back-office session cookie (F-036 / B02-14 / B09-20).
 *
 * The cookie uses the `__Host-` prefix, so browsers accept it only with
 * `Secure`, `Path=/` and no `Domain`: a sibling subdomain can no longer plant
 * or shadow a session (session fixation by cookie tossing). `secure` is always
 * true and no longer follows NODE_ENV.
 *
 * Local development over plain http: Chromium, Edge and Firefox treat
 * http://localhost, http://127.0.0.1 and http://[::1] as secure contexts and
 * accept `Secure`/`__Host-` cookies there (verified with the Playwright
 * Chromium and Firefox builds this repo uses). That loopback rule is the only
 * http exception; WebKit/Safari does not apply it, so develop locally with
 * Chromium/Firefox or over https. Any other http origin cannot sign in.
 *
 * Transition: before this change the cookie was `celebrate_session` (no
 * prefix). Until LEGACY_AUTH_COOKIE_SUNSET (the 14-day session TTL plus
 * margin after the rollout) that name is still read, but only for a session
 * row created before LEGACY_AUTH_COOKIE_ISSUED_BEFORE (the rollout date): a
 * session created after the rollout is honoured only under the `__Host-`
 * name, so a freshly minted token planted under the old name is refused.
 * Until the sunset a sibling subdomain can still plant a pre-rollout token
 * under the old name when no `__Host-` cookie is present; the subdomain
 * cookie-tossing protection is complete only after the sunset. New sign-ins
 * always write the `__Host-` name and expire the legacy one, sign-out clears
 * both, and the legacy name never wins over a `__Host-` cookie.
 */
export const AUTH_COOKIE = "__Host-celebrate_session";
export const LEGACY_AUTH_COOKIE = "celebrate_session";
export const LEGACY_AUTH_COOKIE_ISSUED_BEFORE = new Date("2026-11-04T00:00:00.000Z");
export const LEGACY_AUTH_COOKIE_SUNSET = new Date("2026-12-15T00:00:00.000Z");

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
/** Platform administrators reach every tenant, so their sessions end after 24 hours. */
export const PLATFORM_ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24;

type CookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: true;
  path: "/";
  maxAge?: number;
  expires?: Date;
};

export type SessionCookieReader = { get(name: string): { value: string } | undefined };
export type SessionCookieWriter = {
  set(name: string, value: string, options: CookieOptions): unknown;
  delete(options: { name: string; httpOnly: true; sameSite: "lax"; secure: true; path: "/" }): unknown;
};

export function sessionCookieOptions(expiresAt?: Date, maxAge = SESSION_TTL_SECONDS): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge,
    expires: expiresAt,
  };
}

/**
 * The `__Host-` cookie wins; the legacy cookie is a read-only fallback until
 * the sunset. `legacy: true` tells the caller to accept the token only for a
 * session created before LEGACY_AUTH_COOKIE_ISSUED_BEFORE.
 */
export function readSessionCookie(store: SessionCookieReader, now = new Date()) {
  const current = store.get(AUTH_COOKIE)?.value;
  if (current) return { token: current, legacy: false };
  if (now.getTime() >= LEGACY_AUTH_COOKIE_SUNSET.getTime()) return null;
  const legacy = store.get(LEGACY_AUTH_COOKIE)?.value;
  return legacy ? { token: legacy, legacy: true } : null;
}

export function readSessionCookieToken(store: SessionCookieReader, now = new Date()) {
  return readSessionCookie(store, now)?.token;
}

/** A legacy-name token is honoured only for a session row created before the rollout. */
export function legacySessionCookieAllowed(session: { createdAt: Date }) {
  return session.createdAt.getTime() < LEGACY_AUTH_COOKIE_ISSUED_BEFORE.getTime();
}

/** maxAge follows the session row's expiry so a 24-hour session is not kept for 14 days. */
export function writeSessionCookie(store: SessionCookieWriter, token: string, expiresAt: Date, now = new Date()) {
  const maxAge = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000));
  store.set(AUTH_COOKIE, token, sessionCookieOptions(expiresAt, maxAge));
  expireLegacySessionCookie(store);
}

/**
 * A `__Host-` cookie can only be removed by a Set-Cookie that repeats Secure
 * and Path=/, so deletion passes the same attributes as the write.
 */
export function clearSessionCookies(store: SessionCookieWriter) {
  store.delete({ name: AUTH_COOKIE, ...DELETE_OPTIONS });
  expireLegacySessionCookie(store);
}

// No maxAge here: Next.js turns a maxAge into a future expiry, which would
// overwrite the epoch expiry `delete` sets and keep the cookie alive.
const DELETE_OPTIONS = { httpOnly: true, sameSite: "lax", secure: true, path: "/" } as const;

function expireLegacySessionCookie(store: SessionCookieWriter) {
  store.delete({ name: LEGACY_AUTH_COOKIE, ...DELETE_OPTIONS });
}
