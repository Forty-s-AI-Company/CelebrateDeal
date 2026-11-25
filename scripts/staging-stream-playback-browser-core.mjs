/**
 * Pure parts of the F-093 staging browser verification for Cloudflare Stream signed playback
 * (docs/operations/stream-signed-urls-plan.md §8 step 3). No Playwright, no network: every
 * function here is unit-tested by scripts/staging-stream-playback-browser.test.mjs.
 *
 * Secrets discipline: tokens and Stream URLs stay in memory. Only fixed enums, booleans,
 * counts, rounded seconds and HTTP status codes reach the receipt; `receiptLeaks` is the last
 * guard before anything is written or printed.
 */

export const ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
export const ORIGIN = `https://${ALIAS}`;
export const SCHEMA_VERSION = "celebratedeal-staging-stream-playback-browser/v1";

/** Mirrors src/lib/cloudflare-stream-signing.ts (replay TTL and nbf skew). */
export const REPLAY_TOKEN_TTL_SECONDS = 30 * 60;
export const TOKEN_CLOCK_SKEW_SECONDS = 30;
/** Mirrors src/lib/signed-playback-renewal.ts. */
export const RENEWAL_LEAD_SECONDS = 2 * 60;
export const MIN_RENEWAL_DELAY_SECONDS = 5;

/**
 * Fixed synthetic fixture names under the WP4 synthetic vendor. Reused across runs so the
 * 55-minute Stream video is uploaded once; only the Live is new per run.
 */
export const FIXTURE = Object.freeze({
  videoFile: "fixtures/staging-stream-fifty-five-minutes.mp4",
  videoBytes: 161162,
  videoSha256: "ef3a94eda6b02c64f2858239bbe675b6c242b9434e13b5015f96d6939b08d950",
  videoDurationSeconds: 3300,
  videoTitle: "Stream Playback QA 55min v1",
  formName: "Stream Playback QA 報名表 v2",
  formSlug: "wp4-stream-playback-qa-v2",
  formHeadline: "Stream Playback QA 合成報名頁",
  templateName: "Stream Playback QA 報名成功信 v1",
  scriptName: "Stream Playback QA 互動腳本 v1",
  liveTitlePrefix: "Stream Playback QA Replay",
});

export const STEPS = Object.freeze([
  "BINDING", "OWNER_SESSION", "FIXTURE_VIDEO", "FIXTURE_FORM", "FIXTURE_TEMPLATE", "FIXTURE_SCRIPT",
  "FIXTURE_LIVE", "PAGES", "VIEWER_START", "ORIGIN_PROBE", "RECOVERY", "RENEWAL", "SESSION_CLEANUP",
]);
const STEP_STATUSES = new Set(["PASS", "FAIL", "SKIPPED", "NOT_RUN"]);

export const VIEWER_BROWSERS = Object.freeze(["chromium", "webkit"]);
export const SCENARIOS = Object.freeze(["full", "quick"]);

/** Steps a mode deliberately does not run; everything else must PASS. */
export function skippedStepsFor(viewerBrowser, scenario) {
  const skipped = new Set();
  if (scenario === "quick") skipped.add("RENEWAL");
  if (viewerBrowser === "webkit") {
    // The WebKit job is evidence for the WebKit engine only; pages and the Origin probe
    // are browser-independent and belong to the Chromium job.
    skipped.add("PAGES");
    skipped.add("ORIGIN_PROBE");
    skipped.add("RENEWAL");
  }
  return skipped;
}

/**
 * Minutes from Live creation to the replay deadline. Full: the first renewal (~28 min after
 * the long-play source) lands after the deadline is inside the next token's 30-minute window,
 * so the renewed token's exp must equal the deadline. Quick: the deadline is already inside the
 * first token's window.
 */
export function replayDeadlineMinutes(scenario) {
  return scenario === "full" ? 58 : 20;
}

const JWT_SEGMENT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const UID_SEGMENT = /^[a-f0-9]{32}$/iu;
const CUSTOMER_HOST = /^customer-[a-z0-9]{1,64}\.cloudflarestream\.com$/u;

export function isStreamDeliveryHost(hostname) {
  const host = String(hostname).toLowerCase();
  return host === "videodelivery.net" || CUSTOMER_HOST.test(host);
}

/**
 * Classifies a Cloudflare Stream delivery URL. `token` is returned for in-memory comparison
 * only; callers never serialize it.
 */
export function classifyStreamUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || !isStreamDeliveryHost(url.hostname)) return null;
  const [, first = "", ...rest] = url.pathname.split("/");
  const suffix = rest.join("/");
  const form = JWT_SEGMENT.test(first) ? "TOKEN" : UID_SEGMENT.test(first) ? "UID" : "OTHER";
  let kind = "OTHER";
  if (/^manifest\/video\.(?:m3u8|mpd)$/u.test(suffix)) kind = "MANIFEST";
  else if (/^thumbnails\//u.test(suffix)) kind = "THUMBNAIL";
  else if (/\.(?:m3u8|mpd)$/u.test(suffix)) kind = "PLAYLIST";
  else if (suffix.length > 0) kind = "SEGMENT";
  return {
    host: url.hostname.toLowerCase() === "videodelivery.net" ? "VIDEODELIVERY" : "CUSTOMER",
    form,
    kind,
    token: form === "TOKEN" ? first : null,
  };
}

/** The token's `sub` (the Stream uid), in memory only, for the unsigned-URL lock probe. */
export function streamTokenSubject(token) {
  if (typeof token !== "string" || !JWT_SEGMENT.test(token)) return null;
  try {
    const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))?.sub;
    return typeof sub === "string" && UID_SEGMENT.test(sub) ? sub.toLowerCase() : null;
  } catch { return null; }
}

/** Cloudflare's answer to the unsigned uid manifest: 200 = not locked yet, 401/403 = locked. */
export function classifyVideoLock(status) {
  if (status === 200) return "UNLOCKED";
  if (status === 401 || status === 403) return "LOCKED";
  return "UNKNOWN";
}

/**
 * Post-lock coverage is claimed only when the same run saw the video locked (unsigned uid
 * manifest refused) and still played through the renewal past the first token's exp.
 */
export function postLockCoverage(receipt) {
  const lock = receipt?.origin?.videoLock ?? "UNKNOWN";
  if (lock === "UNLOCKED") return { postLockPlayback: "NOT_COVERED", postLockReason: "OBSERVED_BEFORE_LOCK_REQUIRE_SIGNED_URLS_FALSE" };
  if (lock !== "LOCKED") return { postLockPlayback: "NOT_COVERED", postLockReason: "VIDEO_LOCK_STATE_NOT_OBSERVED" };
  return receipt.renewal?.status === "PASS"
    ? { postLockPlayback: "PASS", postLockReason: "LOCKED_VIDEO_PLAYED_PAST_FIRST_TOKEN_EXP" }
    : { postLockPlayback: "NOT_COVERED", postLockReason: "LOCKED_BUT_RENEWAL_NOT_PASSED" };
}

/** Payload claims only; the signature is never checked or used. */
export function decodeStreamTokenClaims(token) {
  if (typeof token !== "string" || !JWT_SEGMENT.test(token)) return null;
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object") return null;
    const { nbf, exp, sub } = claims;
    if (!Number.isSafeInteger(nbf) || !Number.isSafeInteger(exp)) return null;
    return { nbf, exp, subIsUid: typeof sub === "string" && UID_SEGMENT.test(sub) };
  } catch { return null; }
}

/**
 * Redacted shape of a Stream request path for the receipt: token → <token>, uid → <uid>, long
 * ids → <long>/<hex>, numbers → <n>; query values are dropped, only sanitized key names stay.
 * Example: `customer:/<uid>/video/<n>/seg_<n>.ts?keys=p,s`.
 */
export function redactStreamPath(value) {
  let url;
  try { url = new URL(value); } catch { return "<invalid>"; }
  if (!isStreamDeliveryHost(url.hostname)) return "<non-stream>";
  const path = url.pathname.split("/").map((segment) => {
    if (segment === "") return "";
    if (JWT_SEGMENT.test(segment)) return "<token>";
    if (UID_SEGMENT.test(segment)) return "<uid>";
    // A short file extension (.m3u8, .ts, .m4s, .mp4) stays as is; only the stem is generalised.
    const [, stem, extension = ""] = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/u.exec(segment);
    return `${stem
      .replace(/[A-Za-z0-9_-]{25,}/gu, "<long>")
      .replace(/[0-9a-f]{12,}/giu, "<hex>")
      .replace(/\d+/gu, "<n>")
      .slice(0, 40)}${extension}`;
  }).join("/").slice(0, 120);
  const keys = [...new Set([...url.searchParams.keys()])]
    .map((key) => (/^[A-Za-z0-9_.-]{1,24}$/u.test(key) ? key : "<key>"))
    .sort().slice(0, 8);
  const host = url.hostname.toLowerCase() === "videodelivery.net" ? "videodelivery" : "customer";
  return `${host}:${path}${keys.length ? `?keys=${keys.join(",")}` : ""}`;
}

/**
 * Who chose a Stream URL. The app hands the player exactly one URL per source (the signed
 * `/manifest/video.m3u8`) and renders signed thumbnails; everything else the player fetches —
 * variant playlists and segments — is a URI Cloudflare wrote into its own playlists, resolved
 * by hls.js (xhr/fetch) or the native player (media). So:
 * - APP: the entry manifest (any request type), thumbnails, and any request that is not a
 *   player load (document, script, image, iframe, ...). A uid form here is an app finding.
 * - PROVIDER: a player load of a playlist or segment. A uid form here is Cloudflare's choice
 *   (recorded, and it must still succeed); it is not an unsigned URL produced by the app.
 */
export function streamRequestOrigin(parsed, resourceType) {
  if (!parsed) return null;
  const playerLoad = ["xhr", "fetch", "media"].includes(resourceType);
  return playerLoad && (parsed.kind === "PLAYLIST" || parsed.kind === "SEGMENT") ? "PROVIDER" : "APP";
}

const RESOURCE_TYPES = new Set(["xhr", "fetch", "media", "image", "document", "script", "stylesheet", "other"]);
export const STREAM_PATTERN_LIMIT = 25;

/**
 * Bounded per-shape tally of viewer Stream requests: `{ phase, origin, form, kind, resourceType,
 * pattern, requests, ok, failed, aborted, injected }`. `outcome` is "request", "ok" (2xx/3xx),
 * "failed" (4xx/5xx or a network error), "aborted" (cancelled by the browser or the player, e.g.
 * a native load replaced by hls.js) or "injected" (a 403 the runner itself served in RECOVERY).
 * Shapes beyond the limit fold into one OVERFLOW entry.
 */
export function tallyStreamRequest(list, { phase, url, resourceType }, outcome) {
  const parsed = classifyStreamUrl(url);
  if (!parsed || parsed.kind === "THUMBNAIL") return null;
  const type = RESOURCE_TYPES.has(resourceType) ? resourceType : "other";
  const entry = {
    phase: /^[A-Z_]{1,20}$/u.test(phase ?? "") ? phase : "OTHER",
    origin: streamRequestOrigin(parsed, type), form: parsed.form, kind: parsed.kind, resourceType: type,
    pattern: redactStreamPath(url),
  };
  const key = (item) => `${item.phase}|${item.origin}|${item.form}|${item.kind}|${item.resourceType}|${item.pattern}`;
  let target = list.find((item) => key(item) === key(entry));
  if (!target) {
    // The last slot is reserved for OVERFLOW so no recorded shape ever loses its counts.
    if (list.length >= STREAM_PATTERN_LIMIT - 1) {
      target = list.find((item) => item.pattern === "OVERFLOW");
      if (!target) {
        target = { phase: "OTHER", origin: "MIXED", form: "MIXED", kind: "MIXED", resourceType: "other", pattern: "OVERFLOW", requests: 0, ok: 0, failed: 0, aborted: 0, injected: 0 };
        list.push(target);
      }
    } else {
      target = { ...entry, requests: 0, ok: 0, failed: 0, aborted: 0, injected: 0 };
      list.push(target);
    }
  }
  if (outcome === "request") target.requests += 1;
  else if (outcome === "ok") target.ok += 1;
  else if (outcome === "aborted") target.aborted += 1;
  else if (outcome === "injected") target.injected += 1;
  else target.failed += 1;
  return { ...entry, parsed };
}

/**
 * Playwright's requestfailed `errorText`: a cancellation by the browser or the page (Chromium
 * net::ERR_ABORTED, WebKit "cancelled" / "Load request cancelled", Firefox NS_BINDING_ABORTED)
 * is ABORTED, not a delivery failure; anything else (HTTP is not reported here) stays FAILED.
 */
export function classifyRequestFailure(errorText) {
  if (typeof errorText !== "string") return "FAILED";
  return /net::ERR_ABORTED|NS_BINDING_ABORTED|^cancelled$|Load request cancelled|Request cancelled/iu.test(errorText.trim())
    ? "ABORTED" : "FAILED";
}

/** Strip anything identifying from free text before it may enter the receipt. */
/**
 * Matches anything URL-like in free text: with a scheme ("https://h/p?q"), scheme-less with a
 * host ("//h/p", "/h.tld/p?q" as Playwright leaves it after splitting "https:" off WebKit's
 * text, "h.tld/p"), or a bare path with a query ("/api/x?a=1"). 2026-11-25 run 45561006960
 * printed `p=` (base64 JSON with the video and owner ids) from a scheme-less form.
 */
const URLISH = /(?:[A-Za-z][A-Za-z0-9+.-]*:)?(?:\/{1,2})?(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?(?=[/?#]))?(?:\/[^\s?#]*)?\?[^\s#]*|(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/{0,2}[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?\/[^\s]*|[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/gu;

/** One URL-like token → `<url:host-class/path-shape?keys=a,b>`; query values never survive. */
function redactUrlish(token) {
  const [beforeHash] = token.split("#");
  const queryIndex = beforeHash.indexOf("?");
  const pathPart = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : beforeHash.slice(queryIndex + 1);
  const withoutScheme = pathPart.replace(/^[A-Za-z][A-Za-z0-9+.-]*:/u, "").replace(/^\/+/u, "");
  const hostMatch = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?::\d+)?(\/.*)?$/u.exec(withoutScheme);
  const host = hostMatch ? hostMatch[1].toLowerCase() : null;
  const path = hostMatch ? (hostMatch[2] ?? "") : `/${withoutScheme}`;
  const hostClass = host === null ? "relative" : isStreamDeliveryHost(host) ? "stream" : host === ALIAS ? "app" : "other";
  const shape = path.split("/").map((segment) => {
    if (segment === "") return "";
    if (JWT_SEGMENT.test(segment)) return "<token>";
    if (UID_SEGMENT.test(segment)) return "<uid>";
    const [, stem, extension = ""] = /^(.*?)(\.[A-Za-z0-9]{1,5})?$/u.exec(segment);
    return `${stem.replace(/[A-Za-z0-9_-]{20,}/gu, "<long>").replace(/[0-9a-f]{12,}/giu, "<hex>").replace(/\d+/gu, "<n>").replace(/[^A-Za-z0-9_<>-]/gu, "").slice(0, 30)}${extension.replace(/[^.A-Za-z0-9]/gu, "")}`;
  }).join("/").slice(0, 80);
  const keys = [...new Set(query.split("&").map((pair) => pair.split("=")[0]).filter(Boolean))]
    .map((key) => (/^[A-Za-z0-9_.-]{1,24}$/u.test(key) ? key : "<key>")).sort().slice(0, 8);
  return `<url:${hostClass}${shape}${keys.length ? `?keys=${keys.join(",")}` : ""}>`;
}

function sanitizeText(value, max) {
  return String(value ?? "")
    .replace(URLISH, (token) => redactUrlish(token))
    .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu, "<token>")
    // Long base64/base64url runs (e.g. a signed `p` parameter) even outside a URL.
    .replace(/(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{20,}={0,2}/gu, "<long>")
    .replace(/[^\s@]+@[^\s@]+/gu, "<email>")
    .replace(/[0-9a-f]{12,}/giu, "<hex>")
    .replace(/bearer(?:\s+\S+)?/giu, "<bearer>")
    .replace(/customer-[a-z0-9]+/giu, "<customer>")
    .replace(/[^\p{L}\p{N} .,:;()'"_<>/\-[\]?!=#]/gu, "?")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

/** Top stack frame as `file:line:col` (bundle file name only, never the URL or its query). */
function topFrame(stack) {
  for (const line of String(stack ?? "").split("\n").slice(0, 12)) {
    const match = /([^/\s()@?#]+\.(?:m?js|tsx?))(?:\?[^\s:)]*)?:(\d{1,7}):(\d{1,7})/u.exec(line);
    if (!match) continue;
    const file = /^[A-Za-z0-9._~-]{1,80}$/u.test(match[1]) && !/[0-9a-f]{32}/iu.test(match[1]) ? match[1] : "<file>";
    return `${file}:${match[2]}:${match[3]}`;
  }
  return "NONE";
}

/**
 * A page error reduced to fixed, redacted fields `{ name, message, frame, category,
 * unhandledRejection }`. WebKit reports unhandled rejections as
 * "Unhandled Promise Rejection: <Name>: <message>".
 */
export function describePageError(error, context = {}) {
  const raw = String(error?.message ?? error ?? "");
  const unhandledRejection = raw.startsWith("Unhandled Promise Rejection: ");
  const body = unhandledRejection ? raw.slice("Unhandled Promise Rejection: ".length) : raw;
  const named = /^([A-Z][A-Za-z]{0,39}(?:Error|Exception)): ([\s\S]*)$/u.exec(body);
  const rawName = named ? named[1] : String(error?.name ?? "Error");
  const loadUrl = loadReportUrl(rawName, named ? named[2] : body);
  // Playwright splits WebKit's "https://…" text at the first colon, leaving name "https".
  const name = loadUrl || !/^[A-Za-z]{1,40}$/u.test(rawName) ? "Error" : rawName;
  const message = sanitizeText(named ? named[2] : body, 160);
  let category = "OTHER";
  // WebKit's generic "The operation was aborted." is also what an aborted fetch rejects with, so
  // only a message that names play() is treated as an interrupted media play.
  if (name === "AbortError" && /play\(\)/u.test(message)) category = "MEDIA_PLAY_INTERRUPTED";
  else if (name === "AbortError") category = "ABORT";
  else if (loadUrl) {
    category = context.viewerBrowser === "webkit" && context.actor === "viewer" && context.duringNavigation === true
      ? "WEBKIT_LOAD_CANCELLED_BY_RUNNER_NAVIGATION" : "LOAD_URL_REPORT";
  } else if (/Load failed|Failed to fetch|NetworkError/u.test(message)) category = "NETWORK";
  return { name, message, frame: topFrame(error?.stack), category, unhandledRejection };
}

/**
 * The whole report is one URL of a player load (Stream manifest/playlist/segment) or of the
 * viewer's own `/api/live-updates` poll: that is WebKit's console report of a failed or
 * cancelled network load, not an exception. Playwright's WebKit backend turns every console
 * message with level "error" and source "javascript" into `pageerror` (Chromium reports only
 * uncaught exceptions), and Playwright strips the "https:" prefix as an error name.
 */
function loadReportUrl(rawName, text) {
  // WebKit words a load it cancelled during navigation as "<url> due to access control checks."
  // (2026-11-25 run 45574586283); only that exact suffix is stripped.
  const trimmed = String(text ?? "").trim().replace(/ due to access control checks\.$/u, "");
  if (!/^\S+$/u.test(trimmed)) return null;
  let candidate = trimmed;
  if (/^https?$/iu.test(rawName) && trimmed.startsWith("/")) candidate = `${rawName}:/${trimmed}`;
  else if (/^\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\//u.test(trimmed)) candidate = `https:/${trimmed}`;
  let url;
  try { url = new URL(candidate); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const stream = classifyStreamUrl(url.href);
  if (stream && ["MANIFEST", "PLAYLIST", "SEGMENT"].includes(stream.kind)) return url;
  return url.hostname === ALIAS && url.pathname === "/api/live-updates" ? url : null;
}

/**
 * Benign, and nothing else:
 * - MEDIA_PLAY_INTERRUPTED: an AbortError naming play() (a later load or pause rejected it).
 * - WEBKIT_LOAD_CANCELLED_BY_RUNNER_NAVIGATION: in the WebKit viewer, while the runner itself was
 *   navigating the page away, WebKit's console report of a load it cancelled — a Stream player
 *   load or the `/api/live-updates` poll, and only the bare URL (optionally followed by WebKit's
 *   " due to access control checks." wording, run 45574586283). 2026-11-25 run 45561006960:
 *   4 such reports in RECOVERY (each case reloads the page), at hls.js's `xhr.send()` and the
 *   `fetch(/api/live-updates)` call (whose rejection src/lib/live-updates-client.ts:243 handles);
 *   the poll is never touched by the runner's 403 route, so only the reload can have cancelled it.
 * Every other page error, including the same URL report outside a runner navigation, blocks.
 */
export function isBenignPageError(described) {
  return described?.category === "MEDIA_PLAY_INTERRUPTED"
    || described?.category === "WEBKIT_LOAD_CANCELLED_BY_RUNNER_NAVIGATION";
}

export const PAGE_ERROR_DETAIL_LIMIT = 10;

/** Same Stream URL with a deliberately broken signature (no signing work; for the Origin probe). */
export function withCorruptedSignature(value) {
  const parsed = classifyStreamUrl(value);
  if (!parsed?.token) return null;
  const [header, payload, signature] = parsed.token.split(".");
  const last = signature.at(-1);
  const replaced = `${signature.slice(0, -1)}${last === "A" ? "B" : "A"}`;
  return value.replace(parsed.token, `${header}.${payload}.${replaced}`);
}

/** For diagnostics only: the path's token or uid replaced by a placeholder. */
export function redactStreamUrl(value) {
  const parsed = classifyStreamUrl(value);
  if (!parsed) return "<non-stream-url>";
  const url = new URL(value);
  const [, first, ...rest] = url.pathname.split("/");
  const placeholder = parsed.form === "TOKEN" ? "<token>" : parsed.form === "UID" ? "<uid>" : first ? "<segment>" : "";
  return `https://${parsed.host === "VIDEODELIVERY" ? "videodelivery.net" : "customer-<code>.cloudflarestream.com"}/${placeholder}/${rest.join("/")}`;
}

/** Deadline at a whole minute (the studio's datetime-local field has minute precision). */
export function replayDeadline(nowMs, minutesAhead) {
  const minute = 60_000;
  return new Date(Math.ceil((nowMs + minutesAhead * minute) / minute) * minute);
}

/** Asia/Taipei `YYYY-MM-DDTHH:mm` (Taiwan has no DST); the WP4 vendor uses the default zone. */
export function taipeiDateTimeLocal(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 16);
}

/**
 * Expected replay token exp (src/lib/live-playback-source.ts + signVideoUrl):
 * min(issued + 30 min, replay deadline), where issued = nbf + 30 s.
 */
export function assessReplayTokenExp({ nbf, exp }, deadlineSeconds) {
  const issued = nbf + TOKEN_CLOCK_SKEW_SECONDS;
  const ttlBound = issued + REPLAY_TOKEN_TTL_SECONDS;
  const deadlineCapped = Number.isSafeInteger(deadlineSeconds) && deadlineSeconds < ttlBound;
  const expected = deadlineCapped ? deadlineSeconds : ttlBound;
  return {
    matches: exp === expected,
    deadlineCapped,
    expEqualsDeadline: exp === deadlineSeconds,
    deltaSeconds: exp - expected,
  };
}

/** Mirrors signedPlaybackRenewalDelayMs, in seconds. */
export function renewalDelaySeconds(expiresInSeconds) {
  const lifetime = Math.max(0, expiresInSeconds);
  const delay = lifetime > RENEWAL_LEAD_SECONDS * 2 ? lifetime - RENEWAL_LEAD_SECONDS : lifetime / 2;
  return Math.max(MIN_RENEWAL_DELAY_SECONDS, Math.floor(delay));
}

/**
 * Playback samples `{ atMs, currentTime, paused, ended, errorCode }` taken while the viewer
 * expects playback. A stall is time during which currentTime did not move while not paused.
 */
export function assessPlaybackProgress(samples, { maxStallSeconds = 10, minAdvanceSeconds = 1 } = {}) {
  const valid = Array.isArray(samples)
    ? samples.filter((sample) => Number.isFinite(sample?.atMs) && Number.isFinite(sample?.currentTime))
    : [];
  const result = {
    samples: valid.length, advancedSeconds: 0, maxStallSeconds: 0, regressions: 0,
    pausedSamples: 0, endedSamples: 0, errorSamples: 0, ok: false,
  };
  if (valid.length < 2) return result;
  let stallStart = null;
  for (let index = 1; index < valid.length; index += 1) {
    const previous = valid[index - 1];
    const sample = valid[index];
    if (sample.paused) result.pausedSamples += 1;
    if (sample.ended) result.endedSamples += 1;
    if (sample.errorCode !== null && sample.errorCode !== undefined) result.errorSamples += 1;
    if (sample.currentTime < previous.currentTime - 0.5) result.regressions += 1;
    if (sample.currentTime - previous.currentTime > 0.05) stallStart = null;
    else {
      stallStart ??= previous.atMs;
      result.maxStallSeconds = Math.max(result.maxStallSeconds, (sample.atMs - stallStart) / 1_000);
    }
  }
  result.advancedSeconds = Math.round((valid.at(-1).currentTime - valid[0].currentTime) * 10) / 10;
  result.maxStallSeconds = Math.round(result.maxStallSeconds * 10) / 10;
  result.ok = result.advancedSeconds >= minAdvanceSeconds && result.maxStallSeconds <= maxStallSeconds
    && result.regressions === 0 && result.pausedSamples === 0 && result.endedSamples === 0 && result.errorSamples === 0;
  return result;
}

/**
 * Token-failure recovery verdict (plan §8 step 3). `expectedPosition` is where playback stood
 * when the 403s started (after any seek), `after` the state once requests were restored.
 * - Never reset: position after ≥ expected − tolerance (and not ~0 when expected was not ~0).
 * - Playing: it keeps advancing after restore and loading resumed (a Stream 2xx after restore).
 * - Paused: still paused and still at the expected position; pressing play then advances.
 */
export function assessRecovery({
  state, forbiddenServed, expectedPosition, after, resumedAfterPlay = null,
  streamOkAfterRestore, tolerance = 2,
}) {
  const reasons = [];
  if (!(forbiddenServed > 0)) reasons.push("NO_FORBIDDEN_SERVED");
  if (!after || !Number.isFinite(after.currentTime)) reasons.push("NO_AFTER_SAMPLE");
  else {
    if (after.errorCode !== null && after.errorCode !== undefined) reasons.push("MEDIA_ERROR");
    if (after.currentTime < expectedPosition - tolerance
      || (expectedPosition > tolerance && after.currentTime <= 0.5)) reasons.push("POSITION_RESET");
    if (state === "playing") {
      if (after.paused) reasons.push("NOT_RESUMED");
      if (!(after.advancedSeconds > 1)) reasons.push("NOT_ADVANCING");
    } else {
      if (!after.paused) reasons.push("PAUSE_NOT_KEPT");
      if (Math.abs(after.currentTime - expectedPosition) > tolerance) reasons.push("PAUSED_POSITION_MOVED");
      if (resumedAfterPlay !== true) reasons.push("PLAY_AFTER_RECOVERY_FAILED");
    }
  }
  if (streamOkAfterRestore !== true) reasons.push("LOADING_NOT_RESUMED");
  return { status: reasons.length === 0 ? "PASS" : "FAIL", reasons };
}

/** The value the video edit form submits for the stored thumbnail (plan: no token in the DB). */
export function classifyStoredThumbnail(value) {
  if (typeof value !== "string" || value.trim() === "") return "EMPTY";
  const parsed = classifyStreamUrl(value.trim());
  if (!parsed) return "NOT_STREAM";
  if (parsed.kind !== "THUMBNAIL") return "NOT_THUMBNAIL";
  return parsed.form === "UID" ? "UID_FORM" : parsed.form === "TOKEN" ? "TOKEN_FORM" : "OTHER";
}

const FORBIDDEN_PATH = /\/(?:checkout|payments?|refunds?|orders?|billing|payuni|subscriptions?)(?:\/|$)|^\/api\/admin\//u;
/** Owner writes the fixture needs (server actions post to the page path). */
const OWNER_WRITE_PATHS = [
  /^\/forms\/new$/u, /^\/messages\/templates\/new$/u, /^\/api\/interaction-scripts\/upsert$/u,
  /^\/lives\/new$/u, /^\/api\/live-studio\/drafts$/u, /^\/api\/media\/videos\/direct-upload$/u,
  /^\/videos\/[A-Za-z0-9_-]{1,128}\/edit$/u,
];
/** The viewer's own playback writes: admission (and its release) and the usage heartbeat. */
const VIEWER_WRITE = [
  { method: "POST", path: /^\/api\/live-admission$/u },
  { method: "DELETE", path: /^\/api\/live-admission$/u },
  { method: "POST", path: /^\/api\/stream-usage$/u },
];

/**
 * Request policy for both contexts. Stream delivery GETs are allowed (that is the subject under
 * test); telemetry and analytics are answered locally; anything else that writes is aborted.
 */
export function classifyRequest({ url, method, postData = null }, actor) {
  let parsed;
  try { parsed = new URL(url); } catch { return "EXTERNAL"; }
  const upper = String(method).toUpperCase();
  if (parsed.protocol === "https:" && isStreamDeliveryHost(parsed.hostname)) {
    return upper === "GET" || upper === "HEAD" ? "STREAM" : "BLOCK";
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== ALIAS || parsed.port || parsed.username || parsed.password) return "EXTERNAL";
  const path = parsed.pathname;
  if (upper === "GET" || upper === "HEAD") return "READ";
  if (upper === "POST" && (path === "/monitoring" || path === "/api/security/csp-report")) return "TELEMETRY";
  if (upper === "POST" && path === "/api/analytics") return "ANALYTICS";
  if (upper === "POST" && path === "/api/affiliate-attribution/direct-entry" && !postData) return "ATTRIBUTION_RESET";
  if (FORBIDDEN_PATH.test(path)) return upper === "POST" && /payment|checkout/u.test(path) ? "PAYMENT" : "BLOCK";
  if (actor === "owner" && upper === "POST" && OWNER_WRITE_PATHS.some((pattern) => pattern.test(path))) return "WRITE";
  if (actor === "viewer" && VIEWER_WRITE.some((entry) => entry.method === upper && entry.path.test(path))) return "WRITE";
  return "BLOCK";
}

/** Upload capability returned by the owner API: Cloudflare's upload host and a 32-hex path only. */
export function validUploadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && !url.search
      && ["upload.videodelivery.net", "upload.cloudflarestream.com"].includes(url.hostname)
      && UID_SEGMENT.test(url.pathname.slice(1));
  } catch { return false; }
}

/** How the page attached the media: hls.js (MediaSource blob URL) or native HLS (https src). */
export function classifyPlayerPath(src) {
  if (typeof src !== "string" || src === "") return "NONE";
  if (src.startsWith("blob:")) return "HLS_JS";
  return classifyStreamUrl(src) ? "NATIVE" : "OTHER";
}

/**
 * Safari is never claimed from Playwright WebKit: it is a WebKit build, not Safari, and the
 * app prefers hls.js whenever MediaSource works, so native HLS (the iOS/Safari fallback) only
 * runs where MSE is missing.
 */
export function safariCoverage(capabilities) {
  if (!capabilities) {
    return { safari: "NOT_COVERED", safariReason: "WEBKIT_NOT_RUN_REAL_SAFARI_REQUIRED", webkitNativeHls: "NOT_EXERCISED" };
  }
  const native = capabilities.playerPath === "NATIVE";
  return {
    safari: "NOT_COVERED",
    safariReason: native
      ? "PLAYWRIGHT_WEBKIT_IS_NOT_SAFARI_NATIVE_HLS_SEEN_ON_WEBKIT_ONLY"
      : capabilities.nativeHlsType
        ? "PLAYWRIGHT_WEBKIT_USED_HLS_JS_NATIVE_PATH_NOT_EXERCISED"
        : "PLAYWRIGHT_WEBKIT_HAS_NO_NATIVE_HLS",
    webkitNativeHls: native ? "EXERCISED_ON_PLAYWRIGHT_WEBKIT" : "NOT_EXERCISED",
  };
}

export function createReceipt(env = {}) {
  const viewerBrowser = VIEWER_BROWSERS.includes(env.CELEBRATEDEAL_STREAM_VIEWER_BROWSER) ? env.CELEBRATEDEAL_STREAM_VIEWER_BROWSER : "chromium";
  const scenario = SCENARIOS.includes(env.CELEBRATEDEAL_STREAM_PLAYBACK_SCENARIO) ? env.CELEBRATEDEAL_STREAM_PLAYBACK_SCENARIO : "full";
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceSha: /^[a-f0-9]{40}$/u.test(env.CELEBRATEDEAL_SOURCE_SHA ?? "") ? env.CELEBRATEDEAL_SOURCE_SHA : null,
    viewerBrowser, scenario,
    result: "BLOCKED", reason: "INVALID_BINDING",
    lineage: "NOT_VERIFIED", aliasBinding: "NOT_VERIFIED",
    startedAt: null, totalDurationMs: null,
    steps: STEPS.map((step) => ({ step, status: "NOT_RUN", durationMs: null })),
    failureStep: "NONE", failureCategory: "NONE", failurePage: "NOT_OBSERVED",
    fixture: {
      videoReused: false, videoUploaded: false, videoReadyWaitSeconds: null, readySyncCalls: 0,
      formReused: false, templateReused: false, scriptReused: false, scriptBound: false,
      liveCreated: false, replayDeadlineMinutes: replayDeadlineMinutes(scenario), formPublic: null,
      formScopeSwitched: false, formScopeRestored: null,
    },
    viewer: {
      admissionOk: false, playbackSourceResponses: 0, tokenFormPlayback: false, uidFormStreamRequests: 0,
      tokenFormStreamRequests: 0, appUidFormStreamRequests: 0, providerUidFormStreamRequests: 0,
      providerRequestFailures: 0, streamRequestPatterns: [], playerPath: "NONE", firstPlayback: null,
      tokenExpChecks: 0, tokenExpMismatches: 0, deadlineCappedChecks: 0, deadlineCappedMatches: 0,
    },
    renewal: { status: "NOT_RUN" },
    recovery: [],
    origin: { status: "NOT_RUN" },
    pages: [],
    capabilities: null,
    coverage: {
      chromiumHlsJs: "NOT_RUN",
      safari: "NOT_COVERED", safariReason: "WEBKIT_NOT_RUN_REAL_SAFARI_REQUIRED", webkitNativeHls: "NOT_EXERCISED",
      liveRenewal: "NOT_COVERED", liveRenewalReason: "NO_SYNTHETIC_LIVE_INPUT_PUBLISHER_IN_STAGING_TOOLING",
      livePreviewPlayer: "NOT_COVERED", livePreviewReason: "PREVIEW_PLAYER_ONLY_FOR_EVERGREEN_LIVE_WITH_PREVIEW",
      // Renewal and segments signed by Cloudflare are proven against locked videos only when the
      // unsigned uid manifest is refused (ORIGIN_PROBE videoLock LOCKED, plan §8 step 4).
      postLockPlayback: "NOT_COVERED", postLockReason: "VIDEO_LOCK_STATE_NOT_OBSERVED",
    },
    pageErrors: 0, benignPageErrors: 0, pageErrorDetails: [], blockedWrites: 0, blockedExternal: 0, suppressedTelemetry: 0, suppressedAnalytics: 0,
    sideEffects: {
      ownerSessionsIssued: 0, ownerSessionsRevoked: 0, videoUploads: 0, formCreates: 0, templateCreates: 0,
      scriptCreates: 0, liveCreates: 0, videoSaves: 0, paymentSubmissions: 0, formSubmissions: 0, emails: 0,
    },
  };
}

export function setStep(receipt, step, status, durationMs = null) {
  const entry = receipt.steps.find((candidate) => candidate.step === step);
  if (!entry || !STEP_STATUSES.has(status)) return;
  entry.status = status;
  entry.durationMs = Number.isSafeInteger(durationMs) ? durationMs : entry.durationMs;
}

/** PASS needs every non-skipped step and no unexpected write, payment or page error. */
export function finalVerdict(receipt) {
  const skipped = skippedStepsFor(receipt.viewerBrowser, receipt.scenario);
  for (const entry of receipt.steps) {
    if (skipped.has(entry.step)) continue;
    if (entry.status !== "PASS") return { result: "BLOCKED", reason: `STEP_${entry.step}_${entry.status}` };
  }
  if (receipt.sideEffects.paymentSubmissions > 0) return { result: "BLOCKED", reason: "PAYMENT_ATTEMPTED" };
  if (receipt.blockedWrites > 0) return { result: "BLOCKED", reason: "UNEXPECTED_WRITE_BLOCKED" };
  if (receipt.pageErrors > 0) return { result: "BLOCKED", reason: "PAGE_ERRORS" };
  // Genuine Stream delivery failures anywhere (aborts and the runner's own 403s are not counted).
  if (receipt.viewer.providerRequestFailures > 0) return { result: "BLOCKED", reason: "PROVIDER_STREAM_REQUESTS_FAILED" };
  if (receipt.sideEffects.ownerSessionsIssued !== receipt.sideEffects.ownerSessionsRevoked) {
    return { result: "BLOCKED", reason: "OWNER_SESSION_NOT_REVOKED" };
  }
  return { result: "PASS", reason: "NONE" };
}

/**
 * Last guard before a receipt leaves memory: a JWT, a 32-hex Stream uid, a URL or a
 * Cloudflare customer host anywhere in the text means something unsafe was recorded.
 */
export function receiptLeaks(text) {
  return /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u.test(text)
    || /(?<![A-Za-z0-9])[a-f0-9]{32}(?![A-Za-z0-9])/iu.test(text)
    || /:\/\//u.test(text)
    || /customer-[a-z0-9]+\.cloudflarestream/iu.test(text)
    || /Bearer\s/iu.test(text)
    // A query value: `?name=value` / `&name=value`. Only the redacted `?keys=a,b` form may appear.
    || /[?&](?!keys=)[A-Za-z0-9_.-]{1,40}=/u.test(text)
    || /[?&]keys=[^"\s)>]*=/u.test(text)
    // base64 JSON (`{"...` encodes to `eyJ`), e.g. Cloudflare's signed segment `p` parameter.
    || /eyJ[A-Za-z0-9_+/-]{8,}/u.test(text)
    // A long mixed-case base64-ish run with digits (the receipt's own codes are UPPER_SNAKE).
    || /(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{48,}/u.test(text);
}

/** Path of a Stream URL without its first (uid or token) segment and without the query: a segment's identity. */
export function streamSegmentIdentity(value) {
  if (!classifyStreamUrl(value)) return null;
  try { return new URL(value).pathname.split("/").slice(2).join("/").slice(0, 200); } catch { return null; }
}

export const ERROR_DIAG_SAMPLE_LIMIT = 3;
const ERROR_DIAG_KEY_LIMIT = 8;
const secondsBetween = (fromMs, toMs) => Math.round((toMs - fromMs) / 100) / 10;

/**
 * An error response reduced to `{ status, contentType, body }`: the media type without
 * parameters, and the first 80 characters of the body with URLs, tokens and any 16+ character
 * run (uid, hex, base64) redacted. A body that could not be read is "UNAVAILABLE".
 */
export function describeErrorSample({ status, contentType = null, body = null }) {
  const type = /^\s*([a-z]+\/[a-z0-9.+-]{1,40})/iu.exec(String(contentType ?? ""))?.[1]?.toLowerCase() ?? "NONE";
  const text = typeof body === "string"
    ? sanitizeText(body.slice(0, 400).replace(/eyJ[A-Za-z0-9_+/=-]*/gu, "<long>").replace(/[A-Za-z0-9_+/=-]{16,}/gu, "<long>"), 80)
    : "UNAVAILABLE";
  return { status: Number.isSafeInteger(status) ? status : 0, contentType: type, body: text === "" ? "EMPTY" : text };
}

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const result = Object.fromEntries(sorted.slice(0, ERROR_DIAG_KEY_LIMIT));
  const rest = sorted.slice(ERROR_DIAG_KEY_LIMIT).reduce((sum, [, count]) => sum + count, 0);
  if (rest > 0) result.OTHER = rest;
  return result;
}

/**
 * Diagnostics for Stream error responses (status >= 400, not injected by the runner) seen after
 * `sinceMs`. `entries` are the tracker's response records in arrival order
 * `{ atMs, status, kind, form, origin, identity, injected }`. Offsets are seconds from `sinceMs`
 * (the first token's issue time). Only counts, enums and rounded seconds; `samples` are already
 * redacted by describeErrorSample. Not derivable here: which playlist a failing segment's `p`/`s`
 * signature came from; `playlistReloadsBetween` is the closest cheap signal.
 */
export function summarizeStreamErrors(entries, { sinceMs, initialExpMs = null, renewalMs = null, samples = [] } = {}) {
  const window = (Array.isArray(entries) ? entries : []).filter((entry) => entry.atMs > sinceMs);
  const isOk = (entry) => entry.status >= 200 && entry.status < 300 && !entry.injected;
  const errors = window.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.status >= 400 && !entry.injected);
  const offset = (ms) => (Number.isFinite(ms) ? secondsBetween(sinceMs, ms) : null);
  const result = {
    total: errors.length,
    injectedExcluded: window.filter((entry) => entry.status >= 400 && entry.injected).length,
    byStatus: countBy(errors, ({ entry }) => String(entry.status)),
    byShape: countBy(errors, ({ entry }) => `${entry.origin ?? "APP"}/${entry.form}/${entry.kind}`),
    initialExpOffsetSeconds: offset(initialExpMs),
    renewalOffsetSeconds: offset(renewalMs),
    firstErrorOffsetSeconds: errors.length ? offset(errors[0].entry.atMs) : null,
    lastErrorOffsetSeconds: errors.length ? offset(errors.at(-1).entry.atMs) : null,
    beforeInitialExp: 0, afterInitialExp0To60: 0, afterInitialExpLater: 0, expUnknown: 0,
    retriedOk: 0, neverOk: 0,
    playlistReloadsBetween: null, lastPlaylistBeforeFirstErrorOffsetSeconds: null,
    samples: (Array.isArray(samples) ? samples : []).slice(0, ERROR_DIAG_SAMPLE_LIMIT),
  };
  for (const { entry, index } of errors) {
    if (!Number.isFinite(initialExpMs)) result.expUnknown += 1;
    else if (entry.atMs < initialExpMs) result.beforeInitialExp += 1;
    else if (entry.atMs < initialExpMs + 60_000) result.afterInitialExp0To60 += 1;
    else result.afterInitialExpLater += 1;
    const retried = entry.identity != null && window.slice(index + 1).some((later) => isOk(later) && later.identity === entry.identity);
    if (retried) result.retriedOk += 1; else result.neverOk += 1;
  }
  if (errors.length) {
    const firstIndex = errors[0].index;
    const isPlaylist = (entry) => isOk(entry) && (entry.kind === "PLAYLIST" || entry.kind === "MANIFEST");
    const firstRetryOk = window.findIndex((entry, index) => index > firstIndex && isOk(entry) && entry.identity != null && entry.identity === errors[0].entry.identity);
    const end = firstRetryOk === -1 ? window.length : firstRetryOk;
    result.playlistReloadsBetween = window.slice(firstIndex + 1, end).filter(isPlaylist).length;
    const before = window.slice(0, firstIndex).filter(isPlaylist).at(-1);
    result.lastPlaylistBeforeFirstErrorOffsetSeconds = before ? offset(before.atMs) : null;
  }
  return result;
}

/** `401:27,403:2` / `NONE` for a count map. */
function formatCounts(counts) {
  const parts = Object.entries(counts ?? {}).map(([key, count]) => `${key}:${count}`);
  return parts.length ? parts.join(",") : "NONE";
}

/** The `stream_playback_renewal_errors` summary line from `receipt.renewal.errorDiagnostics`. */
export function formatRenewalErrorsLine(diagnostics) {
  if (!diagnostics) return "stream_playback_renewal_errors=NOT_RUN";
  const value = (item) => item ?? "null";
  const samples = (diagnostics.samples ?? []).map((sample, index) => ` sample_${index + 1}=${sample.status}|${sample.contentType}|${String(sample.body).replace(/\s/gu, "_")}`).join("");
  return `stream_playback_renewal_errors=total:${diagnostics.total} injected_excluded:${diagnostics.injectedExcluded} status:${formatCounts(diagnostics.byStatus)} shapes:${formatCounts(diagnostics.byShape)} initial_exp_s:${value(diagnostics.initialExpOffsetSeconds)} renewal_s:${value(diagnostics.renewalOffsetSeconds)} first_s:${value(diagnostics.firstErrorOffsetSeconds)} last_s:${value(diagnostics.lastErrorOffsetSeconds)} before_exp:${diagnostics.beforeInitialExp} after_exp_0_60:${diagnostics.afterInitialExp0To60} after_exp_later:${diagnostics.afterInitialExpLater} exp_unknown:${diagnostics.expUnknown} retried_ok:${diagnostics.retriedOk} never_ok:${diagnostics.neverOk} playlist_reloads_between:${value(diagnostics.playlistReloadsBetween)} last_playlist_before_first_s:${value(diagnostics.lastPlaylistBeforeFirstErrorOffsetSeconds)}${samples}`;
}

const yes = (value) => (value === true ? "true" : value === false ? "false" : "null");

/** One grep-able `key=value` line per area; fixed enums, booleans, integers and status codes only. */
export function formatReceiptLines(receipt) {
  const steps = receipt.steps.map((entry) => `${entry.step}=${entry.status}${Number.isSafeInteger(entry.durationMs) ? `/${entry.durationMs}ms` : ""}`).join(" ");
  const renewal = receipt.renewal ?? {};
  const origin = receipt.origin ?? {};
  const lines = [
    `stream_playback_result=${receipt.result} reason=${receipt.reason} browser=${receipt.viewerBrowser} scenario=${receipt.scenario}`,
    `stream_playback_steps=${steps}`,
    `stream_playback_viewer=token_form:${yes(receipt.viewer.tokenFormPlayback)} uid_form_requests:${receipt.viewer.uidFormStreamRequests} player:${receipt.viewer.playerPath} exp_checks:${receipt.viewer.tokenExpChecks} exp_mismatches:${receipt.viewer.tokenExpMismatches} deadline_capped_matches:${receipt.viewer.deadlineCappedMatches}/${receipt.viewer.deadlineCappedChecks}`,
    `stream_playback_requests=app_uid:${receipt.viewer.appUidFormStreamRequests} provider_uid:${receipt.viewer.providerUidFormStreamRequests} provider_failures:${receipt.viewer.providerRequestFailures} ${(receipt.viewer.streamRequestPatterns ?? []).map((item) => `${item.phase}/${item.origin}/${item.form}/${item.kind}/${item.resourceType}:${item.pattern}:${item.requests}(ok:${item.ok},failed:${item.failed},aborted:${item.aborted ?? 0},injected:${item.injected ?? 0})`).join(" ") || "NONE"}`,
    // Redacted messages stay in the JSON receipt (pageErrorDetails); the line keeps the fixed fields.
    `stream_playback_errors=page:${receipt.pageErrors} benign:${receipt.benignPageErrors ?? 0} ${(receipt.pageErrorDetails ?? []).map((item) => `${item.actor}/${item.phase}/${item.category}/${item.name}@${item.frame}${item.benign ? "(benign)" : ""}`).join(" ") || "NONE"}`,
    `stream_playback_renewal=status:${renewal.status ?? "NOT_RUN"} after_s:${renewal.observedAfterSeconds ?? "null"} expected_s:${renewal.expectedAfterSeconds ?? "null"} new_token_requests:${renewal.newTokenStreamRequests ?? "null"} renewed_exp_equals_deadline:${yes(renewal.renewedExpEqualsDeadline ?? null)} max_stall_s:${renewal.progress?.maxStallSeconds ?? "null"}`,
    formatRenewalErrorsLine(renewal.errorDiagnostics),
    `stream_playback_recovery=${receipt.recovery.length ? receipt.recovery.map((item) => `${item.mode}/${item.state}:${item.status}${item.reasons?.length ? `(${item.reasons.join("+")})` : ""}`).join(" ") : "NOT_RUN"}`,
    `stream_playback_origin=status:${origin.status ?? "NOT_RUN"} app:${origin.appOrigin ?? "null"} none:${origin.noOrigin ?? "null"} foreign:${origin.foreignOrigin ?? "null"} invalid_token:${origin.invalidToken ?? "null"} invalid_token_cors_readable:${yes(origin.invalidTokenCorsReadable ?? null)} unsigned_uid:${origin.unsignedUidManifest ?? "null"} video_lock:${origin.videoLock ?? "UNKNOWN"}`,
    `stream_playback_pages=${receipt.pages.length ? receipt.pages.map((item) => `${item.page}:${item.status}`).join(" ") : "NOT_RUN"}`,
    `stream_playback_coverage=chromium_hlsjs:${receipt.coverage.chromiumHlsJs} safari:${receipt.coverage.safari}(${receipt.coverage.safariReason}) webkit_native_hls:${receipt.coverage.webkitNativeHls} live_renewal:${receipt.coverage.liveRenewal}(${receipt.coverage.liveRenewalReason}) live_preview_player:${receipt.coverage.livePreviewPlayer} post_lock_playback:${receipt.coverage.postLockPlayback}(${receipt.coverage.postLockReason})`,
  ];
  return lines.join("\n");
}

/** Fixed route classes for the failure page; never the URL, id or slug. */
export function routeCategory(value) {
  let url;
  try { url = new URL(value); } catch { return "INVALID_URL"; }
  if (url.href === "about:blank") return "BLANK";
  if (url.hostname !== ALIAS) return "EXTERNAL";
  const path = url.pathname;
  const fixed = {
    "/videos": "VIDEOS", "/videos/new": "VIDEO_NEW", "/forms": "FORMS", "/forms/new": "FORM_NEW",
    "/messages/templates": "TEMPLATES", "/messages/templates/new": "TEMPLATE_NEW",
    "/interaction-scripts": "SCRIPTS", "/interaction-scripts/new": "SCRIPT_NEW", "/lives/new": "LIVE_NEW",
    "/login": "LOGIN", "/beta-agreement": "BETA_AGREEMENT",
  };
  if (fixed[path]) return fixed[path];
  if (/^\/videos\/[^/]+\/edit$/u.test(path)) return "VIDEO_EDIT";
  if (/^\/videos\/[^/]+\/preview$/u.test(path)) return "VIDEO_PREVIEW";
  if (/^\/lives\/[^/]+\/preview$/u.test(path)) return "LIVE_PREVIEW";
  if (/^\/interaction-scripts\/[^/]+\/edit$/u.test(path)) return "SCRIPT_EDIT";
  if (/^\/form\/[^/]+$/u.test(path)) return "PUBLIC_FORM";
  if (/^\/live\/[^/]+$/u.test(path)) return "PUBLIC_LIVE";
  if (/^\/(?:login|mfa)(?:\/|$)/u.test(path)) return "AUTH_REDIRECT";
  return "OTHER";
}

/** Fixed category for an exception; messages can carry URLs and are never kept. */
export function classifyError(error) {
  if (error?.name === "ConditionNotMet" || /CONDITION_NOT_MET/u.test(error?.message ?? "")) return "CONDITION_NOT_MET";
  if (!(error instanceof Error)) return "OTHER";
  if (error.name === "TimeoutError" || /Timeout .*exceeded/iu.test(error.message)) return "TIMEOUT";
  if (/net::ERR_ABORTED/iu.test(error.message)) return "NAVIGATION_ABORTED";
  if (/TargetClosedError|has been closed/iu.test(error.message)) return "TARGET_CLOSED";
  return "OTHER";
}
