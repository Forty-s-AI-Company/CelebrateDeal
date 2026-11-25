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
  formName: "Stream Playback QA 報名表 v1",
  formSlug: "wp4-stream-playback-qa-v1",
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
    },
    viewer: {
      admissionOk: false, playbackSourceResponses: 0, tokenFormPlayback: false, uidFormStreamRequests: 0,
      tokenFormStreamRequests: 0, playerPath: "NONE", firstPlayback: null,
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
    },
    pageErrors: 0, blockedWrites: 0, blockedExternal: 0, suppressedTelemetry: 0, suppressedAnalytics: 0,
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
    || /Bearer\s/iu.test(text);
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
    `stream_playback_renewal=status:${renewal.status ?? "NOT_RUN"} after_s:${renewal.observedAfterSeconds ?? "null"} expected_s:${renewal.expectedAfterSeconds ?? "null"} new_token_requests:${renewal.newTokenStreamRequests ?? "null"} renewed_exp_equals_deadline:${yes(renewal.renewedExpEqualsDeadline ?? null)} max_stall_s:${renewal.progress?.maxStallSeconds ?? "null"}`,
    `stream_playback_recovery=${receipt.recovery.length ? receipt.recovery.map((item) => `${item.mode}/${item.state}:${item.status}${item.reasons?.length ? `(${item.reasons.join("+")})` : ""}`).join(" ") : "NOT_RUN"}`,
    `stream_playback_origin=status:${origin.status ?? "NOT_RUN"} app:${origin.appOrigin ?? "null"} none:${origin.noOrigin ?? "null"} foreign:${origin.foreignOrigin ?? "null"} invalid_token:${origin.invalidToken ?? "null"} invalid_token_cors_readable:${yes(origin.invalidTokenCorsReadable ?? null)}`,
    `stream_playback_pages=${receipt.pages.length ? receipt.pages.map((item) => `${item.page}:${item.status}`).join(" ") : "NOT_RUN"}`,
    `stream_playback_coverage=chromium_hlsjs:${receipt.coverage.chromiumHlsJs} safari:${receipt.coverage.safari}(${receipt.coverage.safariReason}) webkit_native_hls:${receipt.coverage.webkitNativeHls} live_renewal:${receipt.coverage.liveRenewal}(${receipt.coverage.liveRenewalReason}) live_preview_player:${receipt.coverage.livePreviewPlayer}`,
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
