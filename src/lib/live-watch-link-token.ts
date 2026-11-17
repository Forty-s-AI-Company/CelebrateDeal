import { getCanonicalAppUrl } from "@/lib/app-url";
import { DERIVED_KEY_ROTATIONS, signWithRotation, verifyWithRotation } from "@/lib/derived-key-rotation";

/**
 * Personal watch link (Q-17) in live reminders and live-start notices sent to
 * a verified registrant. Opening it (GET /api/live-watch-link) gives that
 * browser the registration's signed cookie, the one confirming the e-mail
 * sets, and redirects to the plain viewer page, so watching on another device
 * than the one that confirmed the e-mail is still attributed to the
 * registration (LiveRegistrationAttendance, form_no_show).
 *
 * HMAC-signed with its own derived key (`live-watch-link`) behind its own
 * version tag, so no other token of the app verifies here and this one
 * verifies nowhere else. It binds the vendor, the Live and the registration;
 * the server re-checks all three, and that the registration is VERIFIED and
 * the vendor not suspended, before it sets anything.
 *
 * Reusable (several devices of one person) until 30 days after the
 * registrant's session start, the window in which the session and a typical
 * replay happen. The expiry is computed from the session start, not from
 * when the message was written, so every rendering of one reminder carries
 * the same link. Trade-offs: docs/domain-workflows.md「個人觀看連結」.
 *
 * Pure (no DB), so the e-mail and LINE writers can use it.
 */

const VERSION = "lwl1";
const KEY = DERIVED_KEY_ROTATIONS.liveWatchLink;
/** How long after the registrant's session start the link still identifies them. */
export const LIVE_WATCH_LINK_TTL_AFTER_START_SECONDS = 30 * 24 * 60 * 60;
/** Upper bound on any link's lifetime, checked again when it is opened. */
export const LIVE_WATCH_LINK_MAX_LIFETIME_SECONDS = 400 * 24 * 60 * 60;
export const LIVE_WATCH_LINK_MAX_TOKEN_LENGTH = 600;
const PAYLOAD = /^[A-Za-z0-9_-]{1,520}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;

export type LiveWatchLinkClaim = {
  vendorId: string;
  liveId: string;
  submissionId: string;
  expiresAt: Date;
};

/**
 * `valid`: genuine and unexpired. `expired`: genuine (signature checked) but
 * past its expiry; only good for finding the Live to fall back to.
 */
export type LiveWatchLinkVerification =
  | { status: "valid"; claim: LiveWatchLinkClaim }
  | { status: "expired"; claim: LiveWatchLinkClaim };

type Claims = { v: string; l: string; s: string; e: number };

function seconds(value: Date) {
  const result = Math.floor(value.getTime() / 1_000);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error("Invalid watch link clock.");
  return result;
}

/**
 * `sessionStartAt`: the registrant's own session start (their 指定場次, or the
 * Live's scheduled / actual start), always from server records.
 */
export function createLiveWatchLinkToken(
  input: { vendorId: string; liveId: string; submissionId: string; sessionStartAt: Date },
  now = new Date(),
) {
  if (!ID.test(input.vendorId) || !ID.test(input.liveId) || !ID.test(input.submissionId)) {
    throw new Error("Invalid watch link binding.");
  }
  const nowSeconds = seconds(now);
  const startSeconds = seconds(input.sessionStartAt);
  const expiresAt = Math.min(
    Math.max(startSeconds, nowSeconds) + LIVE_WATCH_LINK_TTL_AFTER_START_SECONDS,
    nowSeconds + LIVE_WATCH_LINK_MAX_LIFETIME_SECONDS,
  );
  const claims: Claims = { v: input.vendorId, l: input.liveId, s: input.submissionId, e: expiresAt };
  const value = `${VERSION}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`;
  return `${value}.${signWithRotation(KEY, value)}`;
}

/** Null for anything that is not a genuine watch link (forged, altered, another token type, malformed). */
export function verifyLiveWatchLinkToken(token: string | null | undefined, now = new Date()): LiveWatchLinkVerification | null {
  if (typeof token !== "string" || token.length === 0 || token.length > LIVE_WATCH_LINK_MAX_TOKEN_LENGTH) return null;
  const [version, payload, signature, extra] = token.split(".");
  if (version !== VERSION || !payload || !PAYLOAD.test(payload) || !signature || !SIGNATURE.test(signature) || extra !== undefined) return null;
  if (!verifyWithRotation(KEY, `${VERSION}.${payload}`, signature, now)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const claims = parsed as Partial<Claims>;
  if (
    typeof claims.v !== "string" || !ID.test(claims.v)
    || typeof claims.l !== "string" || !ID.test(claims.l)
    || typeof claims.s !== "string" || !ID.test(claims.s)
    || typeof claims.e !== "number" || !Number.isSafeInteger(claims.e) || claims.e <= 0
  ) return null;
  const claim: LiveWatchLinkClaim = {
    vendorId: claims.v,
    liveId: claims.l,
    submissionId: claims.s,
    expiresAt: new Date(claims.e * 1_000),
  };
  const nowSeconds = seconds(now);
  if (claims.e > nowSeconds + LIVE_WATCH_LINK_MAX_LIFETIME_SECONDS) return null;
  return { status: claims.e <= nowSeconds ? "expired" : "valid", claim };
}

/** The line every reminder and live-start e-mail ends with, before the unsubscribe footer. */
export const PERSONAL_WATCH_LINK_LABEL = "你的專屬觀看連結（只限本人使用，請勿轉寄或分享）";

/**
 * Appends the personal link to a merchant-authored body. `{{live_url}}` keeps
 * the public viewer page, which the template may invite readers to share; the
 * personal link is a separate, labelled line.
 */
export function appendPersonalWatchLink(body: string, personalUrl: string) {
  return [body.trim(), `${PERSONAL_WATCH_LINK_LABEL}：${personalUrl}`].filter(Boolean).join("\n\n");
}

/** The personal link itself. It carries no e-mail or other personal data, only ids. */
export function createLiveWatchLinkUrl(
  input: { vendorId: string; liveId: string; submissionId: string; sessionStartAt: Date },
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const url = new URL("/api/live-watch-link", getCanonicalAppUrl(env));
  url.searchParams.set("token", createLiveWatchLinkToken(input, now));
  return url.toString();
}
