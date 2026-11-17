/**
 * How far a server-issued timestamp may sit in the reader's future before it
 * is refused. Tokens, cookies and payloads are written on one instance and
 * often read on another a fraction of a second later (the next request, the
 * next job run); a wall clock that is slightly behind, or that time
 * synchronisation has just stepped back, must not reject what was just
 * issued. Same bound as CSRF tokens, recent MFA and evergreen viewer sessions.
 *
 * Only the "issued in the future" side is relaxed. Expiry and TTL are never
 * extended, and each timestamp this applies to is server-written inside an
 * HMAC/AEAD-protected value or a server row, so no client can choose it.
 */
export const SERVER_CLOCK_SKEW_SECONDS = 60;
export const SERVER_CLOCK_SKEW_MS = SERVER_CLOCK_SKEW_SECONDS * 1_000;
