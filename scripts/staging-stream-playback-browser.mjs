import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";
import { elementHydratedInPage, HYDRATION_TIMEOUT_MS } from "./staging-browser-hydration.mjs";
import { validateBrowserSmokeBinding, verifyStagingAliasBinding } from "./staging-browser-smoke.mjs";
import {
  ORIGIN, FIXTURE, STEPS, videoFixtureFor, manualLiveSchedule, POSTER_FIXTURE, WAITING_LOOP_FIXTURE,
  assessNewTokenUse, assessPlaybackProgress, assessRecovery, assessReplayTokenExp, classifyError, classifyPlayerPath, createTokenAttribution,
  classifyRequest, classifyStoredThumbnail, classifyStreamUrl, createReceipt, decodeStreamTokenClaims,
  finalVerdict, formatReceiptLines, isStreamDeliveryHost, receiptLeaks, renewalDelaySeconds,
  replayDeadline, replayDeadlineMinutes, routeCategory, safariCoverage, setStep, shouldRefuseInRecovery, skippedStepsFor,
  PAGE_ERROR_DETAIL_LIMIT, classifyRequestFailure, classifyVideoLock, postLockCoverage, describePageError, isBenignPageError, streamTokenSubject,
  describeErrorSample, streamRequestOrigin, streamSegmentIdentity, summarizeStreamErrors, tallyStreamRequest, taipeiDateTimeLocal, validUploadUrl, withCorruptedSignature,
} from "./staging-stream-playback-browser-core.mjs";

/**
 * F-093 staging browser verification of Cloudflare Stream signed playback
 * (docs/operations/stream-signed-urls-plan.md §8 step 3), synthetic data on the fixed alias only.
 *
 * Owner side (WP4 synthetic vendor, short-lived ops session): reuse-or-create one 55-minute
 * synthetic Stream video, a registration form with it as promo video, a registration email
 * template and a published interaction script (fixed names), then create one VOD Live per run
 * that is already in replay with a replay deadline a fixed number of minutes ahead.
 *
 * Viewer side (cookie-free context, the public /live/<slug> entry + admission, no registration,
 * no checkout): token-form playback, token exp vs the replay deadline, Origin probe, token-failure
 * recovery through page.route 403s and Cloudflare-like 401s, and (full scenario) playing through
 * the first renewal on segments signed for the renewed token.
 *
 * Nothing token-like leaves memory: the receipt holds fixed enums, booleans, counts, rounded
 * seconds and HTTP status codes, and `receiptLeaks` checks the text before it is written.
 */

const VENDOR_ID = "wp4_synthetic_vendor_v1";
const SESSION_PATH = "/api/admin/ops/payuni/wp4-session";
const READY_SYNC_PATH = "/api/admin/ops/cloudflare/stream-ready-sync";
const CLIENT_HEADERS = { "x-celebratedeal-client": "web" };
const OWNER_SESSION_REFRESH_MS = 10 * 60_000;
const VIDEO_READY_TIMEOUT_MS = 18 * 60_000;
const FOREIGN_ORIGIN = "https://stream-origin-probe.invalid";
const PLAYER_VIDEO = '[data-testid="persistent-live-player"] video';
export const RECOVERY_CASES = Object.freeze([
  { mode: "token_expiry", state: "playing", blockMs: 10_000 },
  { mode: "token_expiry", state: "paused", blockMs: 10_000 },
  // What Cloudflare does once the token expired (run 45713686375): 401 "signature expired" for
  // every request carrying the token or signed (`p`/`s`) for it, and it never lifts. Requests
  // with or signed for a renewed token pass, so only a player that renews AND re-signs recovers.
  { mode: "token_expiry_401", state: "playing", blockMs: 10_000, httpStatus: 401, persistent: true },
  { mode: "token_expiry_401", state: "paused", blockMs: 10_000, httpStatus: 401, persistent: true },
  { mode: "blanket_block", state: "playing", blockMs: 20_000 },
  { mode: "blanket_block", state: "paused", blockMs: 20_000 },
]);

class ConditionNotMet extends Error {
  constructor(code = "CONDITION_NOT_MET") { super(`CONDITION_NOT_MET ${code}`); this.name = "ConditionNotMet"; this.code = code; }
}
function ensure(condition, code) { if (!condition) throw new ConditionNotMet(code); }

/** Fixed category: a ConditionNotMet code (always a constant in this file) or classifyError's enum. */
export function describeFailure(error) {
  const category = error instanceof ConditionNotMet ? `CONDITION_NOT_MET:${error.code}` : classifyError(error);
  return /^CONDITION_NOT_MET(?::[A-Z0-9_]{1,60})?$|^[A-Z_]{1,40}$/u.test(category) ? category : "OTHER";
}

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** Body of Cloudflare's answer to an expired signature (run 45713686375 error sample). */
const EXPIRED_SIGNATURE_BODY = "401 unauthorized signature expired";
const round1 = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);

function browserEnvironment() {
  return process.platform === "win32"
    ? { PATH: "C:\\Windows\\System32;C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\Windows\\Temp", TMP: "C:\\Windows\\Temp" }
    : { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/tmp", TMPDIR: "/tmp" };
}

async function visible(locator, timeout = 15_000) {
  try { await locator.first().waitFor({ state: "visible", timeout }); return true; } catch { return false; }
}

/** Select the one option whose text equals (or contains) `text`; works on any rendered select. */
async function selectOptionByText(select, text) {
  const value = await select.evaluate((element, wanted) => {
    const options = [...element.options].filter((option) => !option.disabled);
    const exact = options.find((option) => option.textContent.trim() === wanted);
    const partial = options.find((option) => option.textContent.includes(wanted));
    return (exact ?? partial)?.value ?? null;
  }, text);
  if (!value) return false;
  await select.selectOption(value);
  return true;
}

/** Reads <video> state in the page; the src only decides the player path and never leaves memory. */
function readVideoState(selector) {
  const video = document.querySelector(selector);
  if (!video) return null;
  return {
    currentTime: video.currentTime, paused: video.paused, ended: video.ended, readyState: video.readyState,
    errorCode: video.error ? video.error.code : null, src: video.currentSrc || video.src || "",
    duration: Number.isFinite(video.duration) ? video.duration : null,
  };
}

function safeResourceType(request) {
  try { return request.resourceType(); } catch { return "other"; }
}

const ERROR_SAMPLE_READ_LIMIT = 10;

/** One error response as a redacted sample; the body may be unavailable (never throws, never hangs). */
async function readErrorSample(response) {
  const atMs = Date.now();
  let contentType = null;
  let body = null;
  let timer;
  try { contentType = response.headers()["content-type"] ?? null; } catch { /* fixed fallback */ }
  try {
    body = await Promise.race([
      response.text(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2_000); }),
    ]);
  } catch { body = null; } finally { clearTimeout(timer); }
  let status = 0;
  try { status = response.status(); } catch { /* fixed fallback */ }
  return { atMs, ...describeErrorSample({ status, contentType, body }) };
}

/** Network and playback-source observations for one viewer page; tokens stay in memory. */
export function createViewerTracker(page, receipt, phaseOf = () => "OTHER") {
  const state = {
    sources: [], admissionOk: 0, admissionFailed: 0, tokens: [],
    stream: [], uidForm: 0, appUidForm: 0, tokenForm: 0,
  };
  const tokenIndex = (token) => {
    if (!token) return -1;
    let index = state.tokens.indexOf(token);
    if (index === -1) { state.tokens.push(token); index = state.tokens.length - 1; }
    return index;
  };
  // Which token each uid-form URI was signed for, from the playlist bodies the player loaded.
  const attribution = createTokenAttribution();
  const pendingBodies = new Set();
  const recordPlaylistBody = (response, ownTokenIndex) => {
    const playlistUrl = response.url();
    const read = response.text()
      .then((text) => { attribution.recordPlaylist(playlistUrl, text, attribution.tokenOf(playlistUrl, ownTokenIndex)); })
      .catch(() => { /* unreadable body: its URIs stay unattributed */ })
      .finally(() => { pendingBodies.delete(read); });
    pendingBodies.add(read);
  };
  const tally = (request, outcome) => tallyStreamRequest(receipt.viewer.streamRequestPatterns,
    { phase: phaseOf(), url: request.url(), resourceType: safeResourceType(request) }, outcome);
  // Requests answered by the runner's own RECOVERY 403s; they are tallied as injected, never failed.
  const injected = new WeakSet();
  /** Only a genuine delivery failure of a player load counts (not an abort, not an injected 403). */
  const countProviderFailure = (entry, outcome) => {
    if (entry?.origin === "PROVIDER" && outcome === "failed") receipt.viewer.providerRequestFailures += 1;
  };
  const errorSamples = [];
  const failureOutcome = (request) => {
    if (injected.has(request)) return "injected";
    let errorText = null;
    try { errorText = request.failure()?.errorText ?? null; } catch { /* fixed fallback */ }
    return classifyRequestFailure(errorText) === "ABORTED" ? "aborted" : "failed";
  };
  page.on("request", (request) => {
    const entry = tally(request, "request");
    if (!entry) return;
    if (entry.form === "UID") {
      state.uidForm += 1;
      receipt.viewer.uidFormStreamRequests += 1;
      if (entry.origin === "APP") { state.appUidForm += 1; receipt.viewer.appUidFormStreamRequests += 1; }
      else receipt.viewer.providerUidFormStreamRequests += 1;
    }
    if (entry.form === "TOKEN") { state.tokenForm += 1; receipt.viewer.tokenFormStreamRequests += 1; }
  });
  page.on("requestfailed", (request) => {
    // e.g. 2026-11-25 run 45554492545: Chrome's native load of `<video src>` (resourceType media)
    // got its playlist response and was then cancelled when hls.js attached MediaSource.
    const outcome = failureOutcome(request);
    countProviderFailure(tally(request, outcome), outcome);
  });
  page.on("response", (response) => {
    let url;
    try { url = new URL(response.url()); } catch { return; }
    const parsed = classifyStreamUrl(response.url());
    if (parsed && parsed.kind !== "THUMBNAIL") {
      const outcome = response.status() < 400 ? "ok" : injected.has(response.request()) ? "injected" : "failed";
      const entry = tally(response.request(), outcome);
      countProviderFailure(entry, outcome);
      const ownToken = tokenIndex(parsed.token);
      state.stream.push({
        atMs: Date.now(), status: response.status(), token: ownToken, kind: parsed.kind,
        form: parsed.form, origin: entry?.origin ?? "APP", url: response.url(),
        identity: streamSegmentIdentity(response.url()), injected: outcome === "injected",
      });
      if ((parsed.kind === "MANIFEST" || parsed.kind === "PLAYLIST") && outcome === "ok") recordPlaylistBody(response, ownToken);
      // Diagnostics only: a few non-injected error bodies, redacted before they are kept.
      if (outcome === "failed" && errorSamples.length < ERROR_SAMPLE_READ_LIMIT) errorSamples.push(readErrorSample(response));
      return;
    }
    if (url.origin !== ORIGIN) return;
    if (url.pathname === "/api/live-admission" && response.request().method() === "POST") {
      if (response.status() === 200) state.admissionOk += 1; else state.admissionFailed += 1;
      return;
    }
    if (url.pathname !== "/api/live-playback-source") return;
    const atMs = Date.now();
    void response.json().then((body) => {
      const playbackUrl = typeof body?.playbackUrl === "string" ? body.playbackUrl : null;
      const parsedSource = playbackUrl ? classifyStreamUrl(playbackUrl) : null;
      state.sources.push({
        atMs, status: response.status(), playbackUrl,
        expiresInSeconds: Number.isSafeInteger(body?.expiresInSeconds) ? body.expiresInSeconds : null,
        token: parsedSource?.token ?? null,
        tokenIndex: tokenIndex(parsedSource?.token ?? null),
        claims: decodeStreamTokenClaims(parsedSource?.token ?? null),
        manifest: parsedSource?.kind === "MANIFEST",
      });
      receipt.viewer.playbackSourceResponses += 1;
    }).catch(() => {
      state.sources.push({ atMs, status: response.status(), playbackUrl: null, expiresInSeconds: null, token: null, tokenIndex: -1, claims: null, manifest: false });
    });
  });
  return {
    state,
    latestSource: () => state.sources.at(-1) ?? null,
    /** Token of the latest Stream request (the one the player is using now). */
    currentToken: () => {
      for (let index = state.stream.length - 1; index >= 0; index -= 1) {
        const entry = state.stream[index];
        if (entry.token >= 0) return state.tokens[entry.token];
      }
      return state.sources.at(-1)?.token ?? null;
    },
    tokenIndex,
    /** Token index a Stream URL belongs to: its own token, or the token its playlist was fetched with. */
    tokenOf: (url) => attribution.tokenOf(url, tokenIndex(classifyStreamUrl(url)?.token ?? null)),
    /** Resolves once every playlist body seen so far has been read into the attribution. */
    settled: async () => {
      while (pendingBodies.size > 0) await Promise.allSettled([...pendingBodies]);
    },
    /** Stream responses with `token` replaced by the attributed token (call after `settled`). */
    attributedStream: () => state.stream.map((entry) => ({ ...entry, token: attribution.tokenOf(entry.url, entry.token) })),
    /** Call before the runner itself answers a request (RECOVERY 403s／401s). */
    markInjected: (request) => { injected.add(request); },
    streamOkSince: (sinceMs, predicate = () => true) => state.stream.some((entry) => entry.atMs > sinceMs
      && entry.status >= 200 && entry.status < 300 && predicate(entry)),
    streamErrorsSince: (sinceMs) => state.stream.filter((entry) => entry.atMs > sinceMs && entry.status >= 400).length,
    /** Aggregated, redacted diagnostics of the Stream errors after `sinceMs` (never changes a verdict). */
    streamErrorDiagnostics: async ({ sinceMs, initialExpMs, renewalMs }) => {
      const read = (await Promise.all(errorSamples)).filter((sample) => sample.atMs > sinceMs);
      return summarizeStreamErrors(state.stream, {
        sinceMs, initialExpMs, renewalMs, samples: read.map((sample) => ({ status: sample.status, contentType: sample.contentType, body: sample.body })),
      });
    },
  };
}

/** Records the exp of every observed replay token against the deadline (only comparisons are kept). */
function recordExpCheck(receipt, source, deadlineSeconds) {
  if (!source?.claims) return null;
  const assessed = assessReplayTokenExp(source.claims, deadlineSeconds);
  receipt.viewer.tokenExpChecks += 1;
  if (!assessed.matches) receipt.viewer.tokenExpMismatches += 1;
  if (assessed.deadlineCapped) {
    receipt.viewer.deadlineCappedChecks += 1;
    if (assessed.matches && assessed.expEqualsDeadline) receipt.viewer.deadlineCappedMatches += 1;
  }
  return assessed;
}

export async function runStreamPlaybackBrowser(env = process.env, dependencies = {}) {
  const receipt = createReceipt(env);
  const { viewerBrowser, scenario } = receipt;
  if (scenario === "manual" && receipt.manualHours === null) { receipt.reason = "INVALID_MANUAL_HOURS"; return receipt; }
  if (scenario === "manual" && receipt.manualMode === null) { receipt.reason = "INVALID_MANUAL_MODE"; return receipt; }
  // manual_starts_at: a real Asia/Taipei minute, only with manual_mode live, at least 2 minutes ahead.
  const requestedStartsAt = typeof receipt.manualStartsAt === "string" ? new Date(receipt.manualStartsAt) : undefined;
  if (scenario === "manual" && (receipt.manualStartsAt === null
    || (requestedStartsAt && !manualLiveSchedule((dependencies.now ?? Date.now)(), receipt.manualHours ?? undefined, videoFixtureFor(scenario).videoDurationSeconds, requestedStartsAt)))) {
    receipt.reason = "INVALID_MANUAL_STARTS_AT";
    return receipt;
  }
  const VIDEO = videoFixtureFor(scenario);
  const skipped = skippedStepsFor(viewerBrowser, scenario);
  for (const step of skipped) setStep(receipt, step, "SKIPPED");
  if (!validateBrowserSmokeBinding(env)
    || (env.CELEBRATEDEAL_BROWSER_SURFACE ?? "fixed_alias") !== "fixed_alias") return receipt;
  const now = dependencies.now ?? (() => Date.now());
  const wait = dependencies.pause ?? pause;
  const verifyLineage = dependencies.verifyLineage ?? verifyMvpPayUniLineage;
  const verifyAlias = dependencies.verifyAlias ?? verifyStagingAliasBinding;
  const fetchImpl = dependencies.fetch ?? fetch;
  const started = now();
  receipt.startedAt = new Date(started).toISOString();

  let currentStep = "BINDING";
  const stepEntry = (name) => receipt.steps.find((entry) => entry.step === name);
  const step = async (name, body) => {
    currentStep = name;
    const t0 = now();
    try {
      await body();
      setStep(receipt, name, "PASS", now() - t0);
    } catch (error) {
      setStep(receipt, name, "FAIL", now() - t0);
      throw error;
    }
  };
  /**
   * A failure here is recorded (the verdict stays BLOCKED) but later scenarios still run, so one
   * 40-minute run reports every area instead of stopping at the first failed page check.
   */
  const softStep = async (name, body) => {
    try { await step(name, body); } catch (error) {
      if (receipt.failureStep === "NONE") {
        receipt.failureStep = name;
        receipt.failureCategory = describeFailure(error);
        try { receipt.failurePage = activePage ? routeCategory(activePage.url()) : "NOT_OBSERVED"; } catch { receipt.failurePage = "INVALID_URL"; }
      }
    }
  };

  try {
    await step("BINDING", async () => {
      ensure(await verifyLineage(env), "LINEAGE");
      receipt.lineage = "VERIFIED";
      ensure(await verifyAlias(env), "ALIAS");
      receipt.aliasBinding = "VERIFIED";
    });
  } catch {
    receipt.reason = receipt.lineage === "VERIFIED" ? "ALIAS_NOT_VERIFIED" : "LINEAGE_NOT_VERIFIED";
    receipt.failureStep = "BINDING";
    receipt.totalDurationMs = now() - started;
    return receipt;
  }

  const playwright = dependencies.playwright ?? await import("playwright");
  const launched = [];
  const launch = async (kind) => {
    const browser = kind === "webkit"
      ? await playwright.webkit.launch({ headless: true, env: browserEnvironment() })
      : await playwright.chromium.launch({
        headless: true, env: browserEnvironment(),
        // Google Chrome: Playwright's bundled Chromium has no H.264, which Cloudflare Stream serves.
        ...(kind === "chrome" ? { channel: "chrome" } : {}),
        args: ["--no-proxy-server", "--disable-quic", "--autoplay-policy=no-user-gesture-required"],
      });
    launched.push(browser);
    return browser;
  };

  let ownerContext = null;
  let activePage = null;
  let ownerSessionAt = null;
  const opsHeaders = () => ({ Authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA });

  /** Every request either passes the fixed policy or is answered locally / aborted and counted. */
  const guard = (context, actor) => context.route("**/*", (route) => {
    const request = route.request();
    const kind = classifyRequest({ url: request.url(), method: request.method(), postData: request.postData() }, actor);
    if (kind === "READ" || kind === "WRITE" || kind === "STREAM") return route.continue();
    if (kind === "TELEMETRY") { receipt.suppressedTelemetry += 1; return route.fulfill({ status: 204 }); }
    if (kind === "ANALYTICS") { receipt.suppressedAnalytics += 1; return route.fulfill({ status: 204 }); }
    if (kind === "ATTRIBUTION_RESET") return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    if (kind === "EXTERNAL") receipt.blockedExternal += 1;
    else if (kind === "PAYMENT") { receipt.sideEffects.paymentSubmissions += 1; receipt.blockedWrites += 1; }
    else receipt.blockedWrites += 1;
    return route.abort();
  });
  const newContext = async (browser, actor, viewport = { width: 1365, height: 900 }) => {
    const context = await browser.newContext({ locale: "zh-TW", timezoneId: "Asia/Taipei", viewport, serviceWorkers: "block" });
    await guard(context, actor);
    await context.routeWebSocket("**/*", (socket) => socket.close());
    return context;
  };
  // Set while the runner itself reloads the viewer page (and 2 s after the new document loaded):
  // loads the old document still had in flight are cancelled by that navigation.
  const navigation = { active: false, settledUntil: 0 };
  const newPage = async (context, actor) => {
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      // Redacted fields only (describePageError); narrowly benign reports are counted apart.
      const duringNavigation = navigation.active || Date.now() <= navigation.settledUntil;
      const described = describePageError(error, { viewerBrowser, actor, duringNavigation });
      const benign = isBenignPageError(described);
      if (benign) receipt.benignPageErrors += 1; else receipt.pageErrors += 1;
      if (receipt.pageErrorDetails.length < PAGE_ERROR_DETAIL_LIMIT) {
        receipt.pageErrorDetails.push({ actor, phase: STEPS.includes(currentStep) ? currentStep : "OTHER", duringNavigation, benign, ...described });
      }
    });
    page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => {}); });
    activePage = page;
    return page;
  };

  const revokeOwnerSession = async () => {
    if (!ownerContext || ownerSessionAt === null) return;
    ownerSessionAt = null;
    try {
      if (!await verifyAlias(env)) return;
      const response = await ownerContext.request.delete(`${ORIGIN}${SESSION_PATH}`, {
        headers: opsHeaders(), maxRedirects: 0, timeout: 15_000, failOnStatusCode: false,
      });
      if (response.status() === 204) receipt.sideEffects.ownerSessionsRevoked += 1;
      await response.dispose();
    } catch { /* counted as not revoked */ }
  };
  /** Issues the 15-minute synthetic owner session, replacing it before it can lapse mid-step. */
  const ensureOwnerSession = async () => {
    if (ownerSessionAt !== null && now() - ownerSessionAt < OWNER_SESSION_REFRESH_MS) return;
    await revokeOwnerSession();
    ensure(await verifyAlias(env), "ALIAS_DRIFT");
    const response = await ownerContext.request.post(`${ORIGIN}${SESSION_PATH}`, {
      headers: opsHeaders(), maxRedirects: 0, timeout: 15_000, failOnStatusCode: false,
    });
    const status = response.status();
    await response.dispose();
    ensure(status === 204, `SESSION_${status}`);
    receipt.sideEffects.ownerSessionsIssued += 1;
    ownerSessionAt = now();
  };

  const run8 = randomUUID().replaceAll("-", "").slice(0, 8);
  const fixture = { videoId: null, waitingVideoId: null, liveId: null, liveSlug: null, scriptId: null, deadline: null, startsAt: null };

  try {
    currentStep = "OWNER_SESSION";
    // Chrome plays H.264 through hls.js; in the WebKit job the owner side only needs a stock Chromium.
    const ownerBrowser = await launch(viewerBrowser === "webkit" ? "chromium" : "chrome");
    const viewerBrowserInstance = viewerBrowser === "webkit" ? await launch("webkit") : ownerBrowser;
    ownerContext = await newContext(ownerBrowser, "owner");
    const owner = await newPage(ownerContext, "owner");

    await step("OWNER_SESSION", ensureOwnerSession);

    const ownerJson = (path, init = {}) => owner.evaluate(async ({ target, options }) => {
      const response = await fetch(target, options);
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, body };
    }, { target: path, options: init });
    const videoStatus = async (videoId) => {
      await ensureOwnerSession();
      const { status, body } = await ownerJson(`/api/media/videos/status?id=${encodeURIComponent(videoId)}`, { headers: CLIENT_HEADERS });
      if (status !== 200) return null;
      return {
        status: body?.video?.status ?? null,
        ready: body?.video?.cloudflareReadyToStream === true,
        durationSec: Number.isFinite(body?.video?.durationSec) ? body.video.durationSec : 0,
      };
    };
    const listFixtureVideoIds = async (spec) => {
      await owner.goto(`${ORIGIN}/videos?q=${encodeURIComponent(spec.videoTitle)}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return owner.locator("article").evaluateAll((articles, title) => articles
        .filter((article) => article.querySelector("h2")?.textContent?.trim() === title)
        .map((article) => {
          const href = article.querySelector('a[href^="/videos/"][href$="/edit"]')?.getAttribute("href") ?? "";
          return decodeURIComponent(href.split("/")[2] ?? "");
        })
        .filter((id) => /^[A-Za-z0-9_-]{1,128}$/u.test(id)), spec.videoTitle);
    };
    // A long fixture may lose up to a minute to Stream's duration rounding; a short loop must be whole.
    const minimumDuration = (spec) => spec.videoDurationSeconds - (spec.videoDurationSeconds > 120 ? 60 : 2);

    /** Reuses the ready fixture video of this title or uploads it once; returns its id and how. */
    const ensureFixtureVideo = async (spec) => {
      await ensureOwnerSession();
      // Reuse the ready fixture video. A still-processing duplicate from an interrupted earlier run
      // may never finish (an unfinished direct upload stays 404 at Cloudflare), so it is not awaited.
      for (const id of await listFixtureVideoIds(spec)) {
        const state = await videoStatus(id);
        if (state?.ready && state.durationSec >= minimumDuration(spec)) return { id, reused: true, uploaded: false, readyWaitSeconds: null };
      }
      const bytes = await readFile(new URL(`./${spec.videoFile}`, import.meta.url));
      ensure(bytes.length === spec.videoBytes
        && createHash("sha256").update(bytes).digest("hex") === spec.videoSha256, "FIXTURE_REJECTED");
      await owner.goto(`${ORIGIN}/videos/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const csrf = await owner.locator('input[name="_csrf"]').first().inputValue({ timeout: 15_000 });
      ensure(csrf.length > 0, "CSRF_MISSING");
      const created = await ownerJson("/api/media/videos/direct-upload", {
        method: "POST",
        headers: { ...CLIENT_HEADERS, "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({
          title: spec.videoTitle, fileName: spec.uploadFileName, mimeType: "video/mp4",
          sizeBytes: bytes.length, maxDurationSeconds: 3600,
        }),
      });
      ensure(created.status === 200 && /^[A-Za-z0-9_-]{1,128}$/u.test(created.body?.videoId ?? "")
        && created.body?.method === "POST" && validUploadUrl(created.body?.uploadUrl), "UPLOAD_SETUP_REJECTED");
      const videoId = created.body.videoId;
      const form = new FormData();
      form.set("file", new Blob([bytes], { type: "video/mp4" }), spec.uploadFileName);
      receipt.sideEffects.videoUploads += 1;
      // Only the provider's one-time upload URL receives the file; no app credential is sent.
      const uploaded = await fetchImpl(created.body.uploadUrl, { method: "POST", body: form, redirect: "manual", signal: AbortSignal.timeout(120_000) });
      await uploaded.body?.cancel();
      ensure(uploaded.ok, "UPLOAD_REJECTED");
      const uploadedAt = now();
      // A4-04: staging may never get the ready webhook; the JOB_SECRET catch-up applies the
      // provider's own state (5 min after upload at the earliest).
      const readyDeadline = now() + VIDEO_READY_TIMEOUT_MS;
      let lastSync = 0;
      while (now() < readyDeadline) {
        const state = await videoStatus(videoId);
        if (state?.ready && state.durationSec >= minimumDuration(spec)) break;
        ensure(!state || state.status !== "error", "VIDEO_PROVIDER_ERROR");
        if (now() - uploadedAt > 5 * 60_000 && now() - lastSync > 60_000) {
          lastSync = now();
          receipt.fixture.readySyncCalls += 1;
          try {
            const response = await ownerContext.request.post(`${ORIGIN}${READY_SYNC_PATH}`, {
              headers: { ...opsHeaders(), "Content-Type": "application/json" },
              data: { maxAgeHours: 24, vendorId: VENDOR_ID }, maxRedirects: 0, timeout: 70_000, failOnStatusCode: false,
            });
            await response.dispose();
          } catch { /* the next poll decides */ }
        }
        await wait(15_000);
      }
      const final = await videoStatus(videoId);
      ensure(final?.ready && final.durationSec >= minimumDuration(spec), "VIDEO_NOT_READY");
      return { id: videoId, reused: false, uploaded: true, readyWaitSeconds: Math.round((now() - uploadedAt) / 1_000) };
    };

    await step("FIXTURE_VIDEO", async () => {
      const main = await ensureFixtureVideo(VIDEO);
      fixture.videoId = main.id;
      receipt.fixture.videoReused = main.reused;
      receipt.fixture.videoUploaded = main.uploaded;
      receipt.fixture.videoReadyWaitSeconds = main.readyWaitSeconds;
      if (scenario !== "manual") return;
      // Manual: the 開播前等候影片 the demo Live loops in its waiting room (owner 2026-11-27).
      const loop = await ensureFixtureVideo(WAITING_LOOP_FIXTURE);
      fixture.waitingVideoId = loop.id;
      receipt.fixture.waitingVideoReused = loop.reused;
      receipt.fixture.waitingVideoUploaded = loop.uploaded;
    });

    /** Anonymous GET of the public registration page (no cookies): 200 means it is public. */
    const formIsPublic = async () => {
      try {
        const response = await fetchImpl(`${ORIGIN}/form/${FIXTURE.formSlug}`, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
        await response.body?.cancel();
        return response.status === 200;
      } catch { return false; }
    };
    const FORM_BUILDER_PROJECT = 'form:has(select[name="promoVideoId"]) input[name="projectId"]';
    const SWITCHER_BUTTON = '[data-workspace-switcher] button[aria-haspopup="menu"]';
    const openFormBuilder = async () => {
      await owner.goto(`${ORIGIN}/forms/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await owner.waitForFunction(elementHydratedInPage, 'select[name="promoVideoId"]', { timeout: HYDRATION_TIMEOUT_MS });
    };
    /** The sidebar project switcher, as a merchant uses it; `target` null is 全部專案總覽. */
    const switchProjectScope = async (target) => {
      await owner.waitForFunction(elementHydratedInPage, SWITCHER_BUTTON, { timeout: HYDRATION_TIMEOUT_MS });
      const button = owner.locator("[data-workspace-switcher]").filter({ visible: true }).first().locator('button[aria-haspopup="menu"]');
      await button.click({ timeout: 10_000 });
      const item = target === null
        ? owner.getByRole("menuitemradio", { name: /^全部專案總覽/u })
        : owner.getByRole("menuitemradio", { name: target, exact: true });
      await item.first().click({ timeout: 10_000 });
      const wanted = target ?? "全部專案總覽";
      for (let tries = 0; tries < 60; tries += 1) {
        if (await button.isEnabled() && ((await button.textContent()) ?? "").trim() === wanted) return true;
        await wait(250);
      }
      return false;
    };
    await step("FIXTURE_FORM", async () => {
      await ensureOwnerSession();
      if (await formIsPublic()) { receipt.fixture.formReused = true; receipt.fixture.formPublic = true; return; }
      await openFormBuilder();
      // A new form joins the merchant's selected sales project, and a project form is public only
      // once that project is published (src/lib/public-registration-form.ts). In 全部專案總覽 a new
      // form stays unattached and is public at once, so create it there and switch back after.
      let previousScope = null;
      if (await owner.locator(FORM_BUILDER_PROJECT).count() > 0) {
        await owner.waitForFunction(elementHydratedInPage, SWITCHER_BUTTON, { timeout: HYDRATION_TIMEOUT_MS });
        previousScope = ((await owner.locator("[data-workspace-switcher]").filter({ visible: true }).first()
          .locator('button[aria-haspopup="menu"]').textContent()) ?? "").trim();
        ensure(previousScope.length > 0 && previousScope !== "全部專案總覽", "PROJECT_SCOPE_UNKNOWN");
        ensure(await switchProjectScope(null), "SCOPE_SWITCH_FAILED");
        receipt.fixture.formScopeSwitched = true;
        await openFormBuilder();
        ensure(await owner.locator(FORM_BUILDER_PROJECT).count() === 0, "FORM_STILL_PROJECT_BOUND");
      }
      try {
        await owner.locator('input[name="name"]').fill(FIXTURE.formName);
        await owner.locator('input[name="slug"]').fill(FIXTURE.formSlug);
        await owner.locator('input[name="headline"]').fill(FIXTURE.formHeadline);
        ensure(await selectOptionByText(owner.locator('select[name="promoVideoId"]'), VIDEO.videoTitle), "PROMO_VIDEO_OPTION");
        await owner.getByRole("button", { name: "儲存表單", exact: true }).click({ timeout: 10_000 });
        await owner.waitForURL((url) => url.pathname === "/forms", { timeout: 30_000 });
        receipt.sideEffects.formCreates += 1;
      } finally {
        if (previousScope) {
          // Restore the synthetic owner's previous project scope for the other staging runners.
          receipt.fixture.formScopeRestored = false;
          await openFormBuilder().catch(() => {});
          receipt.fixture.formScopeRestored = await switchProjectScope(previousScope).catch(() => false);
        }
      }
      ensure(receipt.fixture.formScopeRestored !== false, "SCOPE_NOT_RESTORED");
      receipt.fixture.formPublic = await formIsPublic();
      ensure(receipt.fixture.formPublic, "FORM_NOT_PUBLIC");
    });

    await step("FIXTURE_TEMPLATE", async () => {
      await ensureOwnerSession();
      await owner.goto(`${ORIGIN}/messages/templates`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (await visible(owner.getByText(FIXTURE.templateName, { exact: true }), 8_000)) { receipt.fixture.templateReused = true; return; }
      await owner.goto(`${ORIGIN}/messages/templates/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await owner.locator('input[name="name"]').fill(FIXTURE.templateName);
      await owner.locator('select[name="trigger"]').selectOption("registration_confirmed");
      await owner.locator('input[name="subject"]').fill("{{live_title}} 報名成功");
      await owner.locator('textarea[name="body"]').fill("{{name}} 您好，已收到你的報名。\n開播時間：{{live_start_at}}\n直播入口：{{live_url}}");
      await owner.getByRole("button", { name: "儲存", exact: true }).click({ timeout: 10_000 });
      await owner.waitForURL((url) => url.pathname === "/messages/templates", { timeout: 30_000 });
      receipt.sideEffects.templateCreates += 1;
    });

    const findPublishedScript = async () => {
      await owner.goto(`${ORIGIN}/interaction-scripts`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return owner.locator("article").evaluateAll((articles, name) => {
        const match = articles.find((article) => article.querySelector("h2")?.textContent?.trim() === name
          && article.textContent?.includes("已發布"));
        const id = match?.id?.startsWith("interaction-script-") ? match.id.slice("interaction-script-".length) : null;
        return id && /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? id : null;
      }, FIXTURE.scriptName);
    };
    await softStep("FIXTURE_SCRIPT", async () => {
      await ensureOwnerSession();
      fixture.scriptId = await findPublishedScript();
      if (fixture.scriptId) { receipt.fixture.scriptReused = true; return; }
      await owner.goto(`${ORIGIN}/interaction-scripts/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await owner.waitForFunction(elementHydratedInPage, 'input[name="name"]', { timeout: HYDRATION_TIMEOUT_MS });
      await owner.locator('input[name="name"]').fill(FIXTURE.scriptName);
      // Template chat events need an interaction role the fixture vendor may not have: start empty.
      const removeButtons = owner.getByRole("button", { name: /^刪除第 \d+ 個事件$/u });
      for (let tries = 0; tries < 30 && await removeButtons.count() > 0; tries += 1) await removeButtons.first().click({ timeout: 5_000 });
      ensure(await removeButtons.count() === 0, "SCRIPT_EVENTS_NOT_CLEARED");
      const spotlight = owner.getByRole("button", { name: "新增商品聚焦", exact: true });
      if (await spotlight.isEnabled()) await spotlight.click({ timeout: 5_000 });
      else {
        await owner.getByRole("button", { name: "新增 CTA", exact: true }).click({ timeout: 5_000 });
        await owner.locator('input[name="ctaUrl"]').first().fill("https://example.com/stream-playback-qa");
      }
      await owner.getByRole("button", { name: "發布並可選用", exact: true }).click({ timeout: 10_000 });
      await owner.waitForURL((url) => url.pathname === "/interaction-scripts", { timeout: 30_000 });
      receipt.sideEffects.scriptCreates += 1;
      fixture.scriptId = await findPublishedScript();
      ensure(fixture.scriptId, "SCRIPT_NOT_PUBLISHED");
    });

    await step("FIXTURE_LIVE", async () => {
      await ensureOwnerSession();
      await owner.goto(`${ORIGIN}/lives/new`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      ensure(await visible(owner.getByRole("heading", { name: "建立直播間" })), "STUDIO_NOT_VISIBLE");
      const next = () => owner.getByRole("button", { name: "下一步", exact: true }).click({ timeout: 10_000 });
      const onStep = async (key) => {
        const button = owner.locator(`button[aria-controls="live-step-panel-${key}"]`);
        for (let tries = 0; tries < 40 && await button.getAttribute("aria-current") !== "step"; tries += 1) await wait(250);
        ensure(await button.getAttribute("aria-current") === "step", `STUDIO_STEP_${key.toUpperCase()}`);
      };
      await onStep("content");
      await owner.locator('input[name="title"]').fill(scenario === "manual"
        ? `${FIXTURE.manualLiveTitlePrefix} ${taipeiDateTimeLocal(new Date(now())).replace(/[-:]/gu, "").replace("T", "-")} ${run8}`
        : `${FIXTURE.liveTitlePrefix} ${run8}`);
      for (let tries = 0; tries < 20 && (await owner.locator("input#live-slug").inputValue()) === ""; tries += 1) await wait(250);
      await owner.locator('select[name="streamMode"]').selectOption("vod");
      ensure(await selectOptionByText(owner.locator('select[name="videoId"]'), VIDEO.videoTitle), "LIVE_VIDEO_OPTION");
      ensure(await selectOptionByText(owner.locator('select[name="formId"]'), FIXTURE.formName), "LIVE_FORM_OPTION");
      // Replay (and full/quick): natural VOD completion two days ago, so the Live is in replay as soon as it
      // exists. Manual live: scheduled shortly ahead, so the public page counts down, starts the pre-recorded
      // video by itself as a live window and only afterwards becomes a replay.
      // manual_starts_at is checked again here: uploads may have taken minutes since the run began.
      const manualLive = scenario === "manual" && receipt.manualMode === "live"
        ? manualLiveSchedule(now(), receipt.manualHours ?? undefined, VIDEO.videoDurationSeconds, requestedStartsAt) : null;
      ensure(!(scenario === "manual" && receipt.manualMode === "live") || manualLive, "MANUAL_STARTS_AT_TOO_SOON");
      if (manualLive && requestedStartsAt) receipt.fixture.replayDeadlineMinutes = Math.round((manualLive.replayUntil.getTime() - now()) / 60_000);
      await owner.locator('input[name="scheduledAt"][type="datetime-local"]').fill(taipeiDateTimeLocal(manualLive?.startsAt ?? new Date(now() - 2 * 24 * 60 * 60_000)));
      const replay = owner.locator('input[name="replayEnabled"]');
      if (!await replay.isChecked()) await replay.check();
      await owner.locator('details[data-advanced-settings="content"]').evaluate((element) => { element.open = true; });
      fixture.deadline = manualLive?.replayUntil ?? replayDeadline(now(), replayDeadlineMinutes(scenario, receipt.manualHours ?? undefined));
      fixture.startsAt = manualLive?.startsAt ?? null;
      await owner.locator('input[name="replayAvailableUntil"][type="datetime-local"]').fill(taipeiDateTimeLocal(fixture.deadline));
      if (scenario === "manual") {
        // The waiting room's poster through the studio's own image field (presign, one signed PUT to the
        // staging R2 bucket, complete), then the 開播前等候影片 from the merchant's own library.
        const posterBytes = await readFile(new URL(`./${POSTER_FIXTURE.imageFile}`, import.meta.url));
        ensure(posterBytes.length === POSTER_FIXTURE.imageBytes
          && createHash("sha256").update(posterBytes).digest("hex") === POSTER_FIXTURE.imageSha256, "POSTER_FIXTURE_REJECTED");
        const advanced = owner.locator('details[data-advanced-settings="content"]');
        await advanced.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles({
          name: POSTER_FIXTURE.uploadFileName, mimeType: "image/jpeg", buffer: posterBytes,
        });
        await advanced.getByRole("button", { name: "開始上傳", exact: true }).click({ timeout: 10_000 });
        ensure(await visible(advanced.getByText("縮圖上傳完成，儲存表單後即會套用。", { exact: true }), 45_000), "POSTER_UPLOAD");
        ensure(/^[A-Za-z0-9_-]{1,128}$/u.test(await owner.locator('input[name="heroImageAssetId"]').inputValue()), "POSTER_ASSET");
        receipt.fixture.posterUploaded = true;
        ensure(await selectOptionByText(owner.locator('select[name="waitingVideoId"]'), WAITING_LOOP_FIXTURE.videoTitle), "LIVE_WAITING_VIDEO_OPTION");
        receipt.fixture.waitingVideoBound = true;
      }
      fixture.liveSlug = await owner.locator("input#live-slug").inputValue();
      ensure(/^[a-z0-9-]{1,120}$/u.test(fixture.liveSlug), "LIVE_SLUG");
      await next();
      await onStep("sales");
      // A missing script only fails the script page checks; the replay itself does not need it.
      receipt.fixture.scriptBound = Boolean(fixture.scriptId)
        && await selectOptionByText(owner.locator('select[name="interactionScriptId"]'), FIXTURE.scriptName);
      await next();
      await onStep("notifications");
      ensure(await selectOptionByText(owner.locator('select[name="messageTemplateId"]'), FIXTURE.templateName), "LIVE_TEMPLATE_OPTION");
      await next();
      await onStep("publish");
      ensure(await visible(owner.getByText("發布條件已完成"), 15_000), "LIVE_NOT_PUBLISH_READY");
      await owner.getByRole("button", { name: "建立並排程", exact: true }).click({ timeout: 10_000 });
      const dialog = owner.getByRole("alertdialog", { name: "確定要建立並排程這場直播嗎？" });
      ensure(await visible(dialog, 10_000), "LIVE_CONFIRM_DIALOG");
      await dialog.getByRole("button", { name: "確認建立並排程", exact: true }).click({ timeout: 10_000 });
      await owner.waitForURL((url) => /^\/lives\/[A-Za-z0-9_-]+\/preview$/u.test(url.pathname), { timeout: 45_000 });
      fixture.liveId = decodeURIComponent(new URL(owner.url()).pathname.split("/")[2]);
      receipt.sideEffects.liveCreates += 1;
      receipt.fixture.liveCreated = true;
    });

    if (!skipped.has("PAGES")) {
      await softStep("PAGES", async () => {
        await ensureOwnerSession();
        const anonymous = await newContext(ownerBrowser, "viewer", { width: 390, height: 844 });
        try {
          await runPageChecks({ owner, anonymous, newPage, receipt, fixture, wait });
        } finally {
          await anonymous.close().catch(() => {});
        }
        ensure(receipt.pages.length > 0 && receipt.pages.every((item) => item.status === "PASS" || item.status === "NOT_APPLICABLE"), "PAGE_CHECK_FAILED");
      });
    }
    // The viewer phase needs no owner credential.
    await revokeOwnerSession();

    if (scenario === "manual") {
      // Manual: the Live stays for a human to open on a real Safari / iPhone; nothing is played here.
      receipt.manual.liveSlug = fixture.liveSlug;
      receipt.manual.replayUntil = fixture.deadline.toISOString();
      receipt.manual.startsAt = fixture.startsAt ? fixture.startsAt.toISOString() : null;
    } else {
      const deadlineSeconds = Math.floor(fixture.deadline.getTime() / 1_000);
      const viewerContext = await newContext(viewerBrowserInstance, "viewer", { width: 1280, height: 800 });
      const viewer = await newPage(viewerContext, "viewer");
      const tracker = createViewerTracker(viewer, receipt, () => currentStep);
      const sample = async () => viewer.evaluate(readVideoState, PLAYER_VIDEO);
      const setPaused = async (wanted) => {
        const current = await sample();
        if (!current || current.paused === wanted) return current?.paused === wanted;
        const toggle = viewer.getByTestId("live-playback-toggle");
        if (await visible(toggle, 3_000)) await toggle.first().click({ timeout: 5_000 });
        else await viewer.evaluate((selector, pauseIt) => {
          const video = document.querySelector(selector);
          if (pauseIt) video?.pause(); else void video?.play()?.catch(() => undefined);
        }, PLAYER_VIDEO, wanted);
        for (let tries = 0; tries < 40; tries += 1) {
          if ((await sample())?.paused === wanted) return true;
          await wait(250);
        }
        return false;
      };
      /** Opens the public replay as a fresh visitor and waits until it is really playing. */
      const startViewer = async () => {
        const sourcesBefore = tracker.state.sources.length;
        navigation.active = true;
        let response;
        try {
          response = await viewer.goto(`${ORIGIN}/live/${fixture.liveSlug}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        } finally {
          navigation.active = false;
          navigation.settledUntil = Date.now() + 2_000;
        }
        ensure(response?.status() === 200, "LIVE_PAGE_STATUS");
        ensure(await visible(viewer.locator(PLAYER_VIDEO), 30_000), "PLAYER_NOT_RENDERED");
        for (let tries = 0; tries < 120 && tracker.state.sources.length === sourcesBefore; tries += 1) await wait(250);
        const source = tracker.latestSource();
        ensure(tracker.state.sources.length > sourcesBefore && source?.status === 200, "PLAYBACK_SOURCE_MISSING");
        for (let tries = 0; tries < 120 && ((await sample())?.readyState ?? 0) < 1; tries += 1) await wait(250);
        ensure(await setPaused(false), "PLAY_NOT_STARTED");
        const first = await sample();
        for (let tries = 0; tries < 60; tries += 1) {
          const current = await sample();
          if (current && first && current.currentTime - first.currentTime >= 1.5) return { source, playing: current };
          await wait(500);
        }
        throw new ConditionNotMet("PLAYBACK_NOT_ADVANCING");
      };

      await step("VIEWER_START", async () => {
        const { source, playing } = await startViewer();
        receipt.viewer.admissionOk = tracker.state.admissionOk > 0;
        receipt.viewer.tokenFormPlayback = Boolean(source.manifest && source.token && source.claims?.subIsUid);
        receipt.viewer.playerPath = classifyPlayerPath(playing.src);
        const exp = recordExpCheck(receipt, source, deadlineSeconds);
        receipt.viewer.firstPlayback = {
          expiresInSeconds: source.expiresInSeconds, expMatchesExpected: exp?.matches ?? false,
          deadlineCapped: exp?.deadlineCapped ?? null, expEqualsDeadline: exp?.expEqualsDeadline ?? null,
        };
        receipt.capabilities = await viewer.evaluate(() => {
          const probe = document.createElement("video");
          const mse = typeof window.MediaSource === "function";
          const managed = typeof window.ManagedMediaSource === "function";
          const h264 = 'video/mp4; codecs="avc1.42E01E"';
          return {
            nativeHlsType: probe.canPlayType("application/vnd.apple.mpegurl") !== "",
            mediaSource: mse, managedMediaSource: managed,
            mseH264: (mse && window.MediaSource.isTypeSupported(h264)) || (managed && window.ManagedMediaSource.isTypeSupported(h264)),
          };
        });
        receipt.capabilities.playerPath = receipt.viewer.playerPath;
        ensure(receipt.viewer.admissionOk, "ADMISSION_NOT_GRANTED");
        ensure(receipt.viewer.tokenFormPlayback, "PLAYBACK_NOT_TOKEN_FORM");
        ensure(tracker.state.tokenForm > 0, "NO_TOKEN_FORM_STREAM_REQUEST");
        // Only URLs the app itself chose must be signed; uid-form playlist/segment URIs written by
        // Cloudflare into its own playlists are tallied by shape and must still load.
        ensure(tracker.state.appUidForm === 0, "APP_UID_FORM_STREAM_REQUESTS");
        ensure(receipt.viewer.providerRequestFailures === 0, "PROVIDER_STREAM_REQUESTS_FAILED");
        ensure(exp?.matches === true, "TOKEN_EXP_MISMATCH");
        // Quick: the deadline is inside the first token's window, so exp must be the deadline itself.
        if (scenario === "quick") ensure(exp.deadlineCapped && exp.expEqualsDeadline, "TOKEN_EXP_NOT_DEADLINE");
      });

      if (!skipped.has("ORIGIN_PROBE")) {
        await softStep("ORIGIN_PROBE", async () => {
          receipt.origin = await probeAllowedOrigins(tracker.latestSource()?.playbackUrl ?? null, fetchImpl);
          ensure(receipt.origin.status === "PASS", "ORIGIN_PROBE_FAILED");
        });
      }

      await softStep("RECOVERY", async () => {
        for (const recoveryCase of RECOVERY_CASES) {
          receipt.recovery.push(await runRecoveryCase({ viewer, tracker, sample, setPaused, startViewer, wait, receipt, deadlineSeconds, ...recoveryCase }));
        }
        ensure(receipt.recovery.every((item) => item.status === "PASS"), "RECOVERY_FAILED");
      });

      if (!skipped.has("RENEWAL")) {
        await softStep("RENEWAL", async () => {
          receipt.renewal = await runRenewal({ tracker, sample, startViewer, wait, receipt, deadlineSeconds, viewer });
          ensure(receipt.renewal.status === "PASS", "RENEWAL_FAILED");
        });
      }
    }

    currentStep = "SESSION_CLEANUP";
    await revokeOwnerSession();
    setStep(receipt, "SESSION_CLEANUP", receipt.sideEffects.ownerSessionsIssued === receipt.sideEffects.ownerSessionsRevoked ? "PASS" : "FAIL");
    Object.assign(receipt, finalVerdict(receipt));
  } catch (error) {
    receipt.result = "BLOCKED";
    const failedStep = STEPS.includes(currentStep) ? currentStep : "UNKNOWN";
    receipt.reason = `STEP_${failedStep}_FAILED`;
    // A hard failure is the reason the run stopped; it replaces an earlier soft-step diagnosis.
    receipt.failureStep = failedStep;
    receipt.failureCategory = describeFailure(error);
    try { receipt.failurePage = activePage ? routeCategory(activePage.url()) : "NOT_OBSERVED"; } catch { receipt.failurePage = "INVALID_URL"; }
  } finally {
    await revokeOwnerSession();
    if (stepEntry("SESSION_CLEANUP").status === "NOT_RUN") {
      setStep(receipt, "SESSION_CLEANUP", receipt.sideEffects.ownerSessionsIssued === receipt.sideEffects.ownerSessionsRevoked ? "PASS" : "FAIL");
    }
    for (const browser of launched) await browser.close().catch(() => {});
    receipt.totalDurationMs = now() - started;
  }

  // Coverage is stated, never inferred from a pass elsewhere.
  if (scenario === "manual") {
    receipt.coverage.chromiumHlsJs = "NOT_RUN";
  } else if (viewerBrowser === "chromium") {
    receipt.coverage.chromiumHlsJs = receipt.result === "PASS" && receipt.viewer.playerPath === "HLS_JS" && scenario === "full" ? "PASS"
      : receipt.result === "PASS" && receipt.viewer.playerPath === "HLS_JS" ? "PASS_WITHOUT_RENEWAL" : "FAIL";
  } else {
    Object.assign(receipt.coverage, safariCoverage(receipt.capabilities));
  }
  Object.assign(receipt.coverage, postLockCoverage(receipt));
  return receipt;
}

/** Waits (bounded) until an <img> has decoded pixels; returns whether its src was token-form. */
async function imageLoaded(locator, wait, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await locator.evaluate((image) => ({ src: image.currentSrc || image.src, complete: image.complete, width: image.naturalWidth }))
      .catch(() => null);
    if (state?.complete && state.width > 0) return { loaded: true, tokenForm: classifyStreamUrl(state.src)?.form === "TOKEN" };
    await wait(500);
  }
  const final = await locator.evaluate((image) => image.currentSrc || image.src).catch(() => "");
  return { loaded: false, tokenForm: classifyStreamUrl(final)?.form === "TOKEN" };
}

/** The first rendered Stream thumbnail <img> on the page (by index; the URL stays in the page). */
async function streamThumbnail(page, wait, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const sources = await page.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""));
    const index = sources.findIndex((src) => classifyStreamUrl(src)?.kind === "THUMBNAIL");
    if (index !== -1) return page.locator("img").nth(index);
    await wait(500);
  } while (Date.now() < deadline);
  return null;
}

/** Polls a <video> until readyState ≥ HAVE_METADATA; Stream manifest requests on the page are classified. */
async function videoLoaded(page, selector, wait, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let readyState = 0;
  while (Date.now() < deadline) {
    readyState = await page.evaluate((target) => document.querySelector(target)?.readyState ?? -1, selector).catch(() => -1);
    if (readyState >= 1) break;
    await wait(500);
  }
  return { loaded: readyState >= 1, readyState };
}

async function runPageChecks({ owner, anonymous, newPage, receipt, fixture, wait }) {
  const streamManifests = { token: 0, uid: 0 };
  owner.on("request", (request) => {
    const parsed = classifyStreamUrl(request.url());
    if (parsed?.kind !== "MANIFEST") return;
    if (parsed.form === "TOKEN") streamManifests.token += 1;
    if (parsed.form === "UID") streamManifests.uid += 1;
  });
  const record = (page, status, extra = {}) => { receipt.pages.push({ page, status, ...extra }); };
  const imagePage = async (page, path, scope) => {
    try {
      await owner.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const image = scope ? scope().locator("img").first() : await streamThumbnail(owner, wait);
      if (!image || !await visible(image, 10_000)) { record(page, "FAIL", { reason: "NO_STREAM_THUMBNAIL" }); return; }
      const result = await imageLoaded(image, wait);
      record(page, result.loaded && result.tokenForm ? "PASS" : "FAIL", { loaded: result.loaded, tokenForm: result.tokenForm });
    } catch (error) { record(page, "FAIL", { reason: classifyError(error) }); }
  };

  await imagePage("videos_list", `/videos?q=${encodeURIComponent(FIXTURE.videoTitle)}`,
    () => owner.getByLabel(`${FIXTURE.videoTitle}縮圖`, { exact: true }));

  // Video edit: signed preview, and the stored thumbnail the form submits is the uid form (before and after a save).
  try {
    const editPath = `/videos/${encodeURIComponent(fixture.videoId)}/edit`;
    await owner.goto(`${ORIGIN}${editPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const preview = await streamThumbnail(owner, wait);
    const result = preview ? await imageLoaded(preview, wait) : { loaded: false, tokenForm: false };
    record("video_edit_thumbnail", result.loaded && result.tokenForm ? "PASS" : "FAIL", { loaded: result.loaded, tokenForm: result.tokenForm });
    const storedValues = async () => owner.locator('input[name="thumbnailUrl"]').evaluateAll((inputs) => inputs.map((input) => input.value));
    const before = (await storedValues()).map(classifyStoredThumbnail);
    await owner.getByRole("button", { name: "儲存", exact: true }).click({ timeout: 10_000 });
    await owner.waitForURL((url) => url.pathname === "/videos", { timeout: 30_000 });
    receipt.sideEffects.videoSaves += 1;
    await owner.goto(`${ORIGIN}${editPath}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const after = (await storedValues()).map(classifyStoredThumbnail);
    const uidOnly = (values) => values.length > 0 && values.every((value) => value === "UID_FORM");
    record("video_edit_stored_thumbnail", uidOnly(before) && uidOnly(after) ? "PASS" : "FAIL", {
      storedBefore: [...new Set(before)].join("+") || "NONE", storedAfter: [...new Set(after)].join("+") || "NONE",
    });
  } catch (error) { record("video_edit_thumbnail", "FAIL", { reason: classifyError(error) }); }

  try {
    const before = { ...streamManifests };
    await owner.goto(`${ORIGIN}/videos/${encodeURIComponent(fixture.videoId)}/preview`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const result = await videoLoaded(owner, "main video", wait);
    const tokenForm = streamManifests.token > before.token && streamManifests.uid === before.uid;
    record("video_preview", result.loaded && tokenForm ? "PASS" : "FAIL", { loaded: result.loaded, readyState: result.readyState, tokenForm });
  } catch (error) { record("video_preview", "FAIL", { reason: classifyError(error) }); }

  // A non-evergreen Live's preview has no player (only the evergreen preview renders one).
  try {
    await owner.goto(`${ORIGIN}/lives/${encodeURIComponent(fixture.liveId)}/preview`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const headingVisible = await visible(owner.getByRole("heading", { name: "直播預覽", exact: true }));
    const players = await owner.locator("main video").count();
    if (!headingVisible) record("live_preview", "FAIL", { reason: "HEADING_NOT_VISIBLE" });
    else if (players === 0) record("live_preview", "NOT_APPLICABLE", { reason: "NO_PLAYER_FOR_NON_EVERGREEN_LIVE" });
    else {
      const result = await videoLoaded(owner, "main video", wait);
      record("live_preview", result.loaded ? "PASS" : "FAIL", { loaded: result.loaded, readyState: result.readyState });
    }
  } catch (error) { record("live_preview", "FAIL", { reason: classifyError(error) }); }

  if (fixture.scriptId && receipt.fixture.scriptBound) {
    await imagePage("interaction_scripts_list", "/interaction-scripts",
      () => owner.locator(`article#interaction-script-${fixture.scriptId}`));
    await imagePage("interaction_script_edit", `/interaction-scripts/${encodeURIComponent(fixture.scriptId)}/edit`);
  } else {
    record("interaction_scripts_list", "FAIL", { reason: "SCRIPT_UNAVAILABLE" });
    record("interaction_script_edit", "FAIL", { reason: "SCRIPT_UNAVAILABLE" });
  }

  // Public registration page promo video, as an anonymous visitor.
  try {
    const page = await newPage(anonymous, "anonymous");
    const manifests = { token: 0, uid: 0 };
    page.on("request", (request) => {
      const parsed = classifyStreamUrl(request.url());
      if (parsed?.kind === "MANIFEST") manifests[parsed.form === "TOKEN" ? "token" : "uid"] += 1;
    });
    const response = await page.goto(`${ORIGIN}/form/${FIXTURE.formSlug}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    receipt.fixture.formPublic = response?.status() === 200;
    if (!receipt.fixture.formPublic) record("public_form_promo", "FAIL", { reason: "FORM_NOT_PUBLIC" });
    else {
      const selector = 'section[aria-labelledby="registration-promo-video-title"] video';
      const result = await videoLoaded(page, selector, wait);
      const tokenForm = manifests.token > 0 && manifests.uid === 0;
      record("public_form_promo", result.loaded && tokenForm ? "PASS" : "FAIL", { loaded: result.loaded, readyState: result.readyState, tokenForm });
    }
    await page.close();
  } catch (error) { record("public_form_promo", "FAIL", { reason: classifyError(error) }); }
}

/**
 * plan §8 step 3 allowedOrigins: Cloudflare's answer to a signed manifest with the app Origin
 * (control), no Origin, a foreign Origin, and a broken signature. Status codes only.
 */
export async function probeAllowedOrigins(playbackUrl, fetchImpl = fetch) {
  const result = {
    status: "FAIL", appOrigin: null, noOrigin: null, foreignOrigin: null, invalidToken: null, invalidTokenCorsReadable: null,
    appManifest: false, unsignedUidManifest: null, videoLock: "UNKNOWN",
  };
  if (!playbackUrl || classifyStreamUrl(playbackUrl)?.form !== "TOKEN") return { ...result, reason: "NO_SIGNED_URL" };
  const probe = async (url, headers, readBody = false) => {
    try {
      const response = await fetchImpl(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
      const corsReadable = Boolean(response.headers.get("access-control-allow-origin"));
      const body = readBody && response.status === 200 ? (await response.text()).slice(0, 64) : null;
      if (!readBody || response.status !== 200) await response.body?.cancel();
      return { status: response.status, corsReadable, body };
    } catch { return { status: 0, corsReadable: false, body: null }; }
  };
  const app = await probe(playbackUrl, { Origin: ORIGIN }, true);
  result.appOrigin = app.status;
  result.appManifest = typeof app.body === "string" && app.body.startsWith("#EXTM3U");
  result.noOrigin = (await probe(playbackUrl, {})).status;
  result.foreignOrigin = (await probe(playbackUrl, { Origin: FOREIGN_ORIGIN })).status;
  const corrupted = withCorruptedSignature(playbackUrl);
  if (corrupted) {
    const invalid = await probe(corrupted, { Origin: ORIGIN });
    result.invalidToken = invalid.status;
    result.invalidTokenCorsReadable = invalid.corsReadable;
  }
  // Lock state of this video at run time: Cloudflare's answer to the unsigned uid manifest
  // (the uid comes from the token's sub, in memory only). UNLOCKED means everything this run
  // proved about renewal and Cloudflare-signed segments predates requireSignedURLs.
  const uid = streamTokenSubject(classifyStreamUrl(playbackUrl).token);
  result.unsignedUidManifest = uid ? (await probe(`https://videodelivery.net/${uid}/manifest/video.m3u8`, { Origin: ORIGIN })).status : null;
  result.videoLock = classifyVideoLock(result.unsignedUidManifest);
  // Only the app Origin must play; the others are recorded for the lock decision (plan §8 step 4).
  result.status = result.appOrigin === 200 && result.appManifest ? "PASS" : "FAIL";
  return result;
}

async function runRecoveryCase({
  viewer, tracker, sample, setPaused, startViewer, wait, receipt, deadlineSeconds, mode, state, blockMs, httpStatus = 403, persistent = false,
}) {
  const record = {
    mode, state, status: "FAIL", reasons: [], servedStatus: httpStatus, persistent,
    forbiddenServed: 0, uidFormBlocked: 0, positionBefore: null, positionAfter: null,
  };
  let handler = null;
  // One predicate instance: page.unroute matches the url argument and the handler.
  const isStream = (url) => isStreamDeliveryHost(url.hostname);
  try {
    const { source } = await startViewer();
    recordExpCheck(receipt, source, deadlineSeconds);
    await wait(3_000);
    const blockedToken = tracker.currentToken();
    if (!blockedToken) { record.reasons.push("NO_TOKEN_IN_USE"); return record; }
    const blockedIndex = tracker.tokenIndex(blockedToken);
    let active = true;
    let firstForbiddenAt = null;
    // token_expiry (403, lifted after blockMs): requests carrying the expiring token, plus every
    // uid-form playlist/segment URI (worst case: their access ends with that token).
    // token_expiry_401 (never lifted, like Cloudflare after exp): requests carrying the expired
    // token or signed for it (attributed through the playlist that listed them), and uid-form
    // URIs no recorded playlist listed (worst case); URIs signed for a renewed token pass.
    // blanket_block: every Stream request.
    handler = async (route) => {
      const request = route.request();
      const parsed = classifyStreamUrl(request.url());
      let resourceType = "other";
      try { resourceType = request.resourceType(); } catch { /* fixed fallback */ }
      const providerUid = parsed?.form === "UID" && streamRequestOrigin(parsed, resourceType) === "PROVIDER";
      let owner = -1;
      if (active && persistent && parsed) {
        // Attribution needs every playlist body seen so far (the one listing this URI included).
        await tracker.settled();
        owner = tracker.tokenOf(request.url());
      }
      if (active && shouldRefuseInRecovery({ mode, persistent, parsed, providerUid, owner, blockedToken, blockedIndex })) {
        record.forbiddenServed += 1;
        if (providerUid) record.uidFormBlocked += 1;
        tracker.markInjected(request);
        firstForbiddenAt ??= Date.now();
        // CORS-readable like a same-origin-allowed Cloudflare answer, so the player sees the status.
        return route.fulfill({
          status: httpStatus, headers: { "access-control-allow-origin": ORIGIN, "content-type": "text/plain" },
          body: httpStatus === 401 ? EXPIRED_SIGNATURE_BODY : "forbidden",
        });
      }
      return route.fallback();
    };
    let expectedPosition;
    if (state === "paused") {
      if (!await setPaused(true)) { record.reasons.push("PAUSE_FAILED"); return record; }
      await viewer.route(isStream, handler);
      // Seek past the buffered range so the paused player has to load with the expired token.
      expectedPosition = await viewer.evaluate((selector) => {
        const video = document.querySelector(selector);
        let end = video.currentTime;
        for (let index = 0; index < video.buffered.length; index += 1) end = Math.max(end, video.buffered.end(index));
        const target = Math.min((Number.isFinite(video.duration) ? video.duration : end + 600) - 120, end + 120);
        video.currentTime = target;
        return target;
      }, PLAYER_VIDEO);
    } else {
      await viewer.route(isStream, handler);
      expectedPosition = (await sample())?.currentTime ?? 0;
    }
    record.positionBefore = round1(expectedPosition);
    for (let tries = 0; tries < 90 && record.forbiddenServed === 0; tries += 1) await wait(500);
    if (record.forbiddenServed > 0) await wait(blockMs);
    if (!persistent) {
      active = false;
      await viewer.unroute(isStream, handler);
      handler = null;
    }
    await wait(state === "playing" ? 15_000 : 10_000);
    const first = await sample();
    let resumedAfterPlay = null;
    let after;
    if (state === "playing") {
      await wait(8_000);
      const second = await sample();
      after = second ? { ...second, advancedSeconds: second.currentTime - (first?.currentTime ?? second.currentTime) } : null;
    } else {
      after = first;
      if (await setPaused(false)) {
        for (let tries = 0; tries < 60 && resumedAfterPlay !== true; tries += 1) {
          const current = await sample();
          if (current && current.currentTime > expectedPosition + 1 && current.currentTime > 1) resumedAfterPlay = true;
          else await wait(500);
        }
      }
      resumedAfterPlay ??= false;
    }
    record.positionAfter = round1(after?.currentTime);
    const assessed = assessRecovery({
      state, forbiddenServed: record.forbiddenServed, expectedPosition, after, resumedAfterPlay,
      // A persistent block stays up: loading resumed only if a segment signed for another
      // (renewed) token loaded after the first refusal.
      streamOkAfterRestore: firstForbiddenAt !== null
        && tracker.streamOkSince(firstForbiddenAt, persistent ? (entry) => entry.kind === "SEGMENT" : undefined),
    });
    record.status = assessed.status;
    record.reasons = assessed.reasons;
    return record;
  } catch (error) {
    record.reasons.push(error instanceof ConditionNotMet ? error.code : classifyError(error));
    return record;
  } finally {
    if (handler) await viewer.unroute(isStream, handler).catch(() => {});
  }
}

/**
 * Full scenario: one fresh visitor plays through the first scheduled renewal (~28 minutes for a
 * 30-minute replay token) and two more minutes. Asserts the renewal happened on schedule, the
 * renewed token carries the replay deadline as exp, the player loaded a playlist with it and
 * segments signed for it before the first token expired (and nothing of the first token after),
 * and playback never stalled, paused, ended, errored or jumped back.
 */
async function runRenewal({ tracker, sample, startViewer, wait, receipt, deadlineSeconds, viewer }) {
  const result = { status: "FAIL", reasons: [] };
  const { source } = await startViewer();
  recordExpCheck(receipt, source, deadlineSeconds);
  const sourceIndex = tracker.state.sources.indexOf(source);
  const expected = renewalDelaySeconds(source.expiresInSeconds ?? 0);
  result.expectedAfterSeconds = expected;
  result.initialExpiresInSeconds = source.expiresInSeconds;
  const giveUpAt = source.atMs + (expected + 240) * 1_000;
  const samples = [];
  let renewed = null;
  let earlySourceFetches = 0;
  let unavailableSeen = false;
  // After the renewal, keep playing until the first token has been expired for 3 minutes (if the
  // replay deadline allows): segment URIs from playlists loaded with it must keep working.
  const initialExpMs = Number.isSafeInteger(source.claims?.exp) ? source.claims.exp * 1_000 : null;
  const pastExpTarget = initialExpMs === null ? null : initialExpMs + 180_000;
  const pastExpObservable = pastExpTarget !== null && pastExpTarget <= deadlineSeconds * 1_000 - 90_000;
  result.pastInitialExpObservable = pastExpObservable;
  const observeUntil = () => Math.max(renewed.atMs + 120_000, pastExpObservable ? pastExpTarget : 0);
  while (renewed ? Date.now() < observeUntil() : Date.now() < giveUpAt) {
    const current = await sample();
    if (current) samples.push({ atMs: Date.now(), ...current });
    if (await viewer.locator('[data-testid="live-unavailable"]').count() > 0) unavailableSeen = true;
    if (!renewed) {
      for (const candidate of tracker.state.sources.slice(sourceIndex + 1)) {
        if (candidate.token && candidate.token !== source.token && candidate.atMs >= source.atMs + (expected - 60) * 1_000) { renewed = candidate; break; }
      }
      earlySourceFetches = tracker.state.sources.slice(sourceIndex + 1).filter((candidate) => candidate !== renewed
        && candidate.atMs < source.atMs + (expected - 60) * 1_000).length;
    }
    await wait(5_000);
  }
  const progress = assessPlaybackProgress(samples, { maxStallSeconds: 10, minAdvanceSeconds: 60 });
  result.progress = {
    samples: progress.samples, advancedSeconds: progress.advancedSeconds, maxStallSeconds: progress.maxStallSeconds,
    regressions: progress.regressions, pausedSamples: progress.pausedSamples, endedSamples: progress.endedSamples, errorSamples: progress.errorSamples,
  };
  result.earlySourceFetches = earlySourceFetches;
  result.unavailableSeen = unavailableSeen;
  if (!renewed) { result.reasons.push("RENEWAL_NOT_OBSERVED"); }
  else {
    result.observedAfterSeconds = Math.round((renewed.atMs - source.atMs) / 1_000);
    const exp = recordExpCheck(receipt, renewed, deadlineSeconds);
    result.renewedExpMatchesExpected = exp?.matches ?? false;
    result.renewedExpDeadlineCapped = exp?.deadlineCapped ?? null;
    result.renewedExpEqualsDeadline = exp?.expEqualsDeadline ?? false;
    result.renewedExpDeltaSeconds = exp?.deltaSeconds ?? null;
    // Required: Cloudflare signs the uid-form segment URIs (`p`/`s`) for the token their playlist
    // was fetched with and refuses them from that token's exp on (run 45713686375: 27 × 401 after
    // the first exp, 0 requests with the renewed token). Between the renewal and the first exp the
    // player must load a playlist with the renewed token and segments signed for it, and must not
    // touch anything of the first token after its exp. uid-form requests are attributed through
    // the playlist bodies the player loaded (createTokenAttribution).
    await tracker.settled();
    const use = assessNewTokenUse(tracker.attributedStream(), {
      firstIndex: source.tokenIndex, renewedIndex: renewed.tokenIndex, renewedAtMs: renewed.atMs, initialExpMs,
    });
    result.newTokenStreamRequests = use.newTokenStreamRequests;
    result.newTokenPlaylistRequests = use.newTokenPlaylistRequests;
    result.newTokenSegmentRequests = use.newTokenSegmentRequests;
    result.firstTokenRequestsAfterExp = use.firstTokenRequestsAfterExp;
    result.reasons.push(...use.reasons);
    const afterRenewal = samples.filter((entry) => entry.atMs >= renewed.atMs);
    result.advancedAfterRenewalSeconds = afterRenewal.length >= 2 ? round1(afterRenewal.at(-1).currentTime - afterRenewal[0].currentTime) : 0;
    if (result.observedAfterSeconds > expected + 180) result.reasons.push("RENEWAL_LATE");
    if (!result.renewedExpMatchesExpected) result.reasons.push("RENEWED_EXP_MISMATCH");
    if (!result.renewedExpEqualsDeadline) result.reasons.push("RENEWED_EXP_NOT_DEADLINE");
    if (!(result.advancedAfterRenewalSeconds >= 60)) result.reasons.push("NOT_PLAYING_AFTER_RENEWAL");
    // The property that matters: uninterrupted playback well past the first token's exp.
    const pastExp = pastExpTarget === null ? [] : samples.filter((entry) => entry.atMs >= initialExpMs);
    result.advancedPastInitialExpSeconds = pastExp.length >= 2 ? round1(pastExp.at(-1).currentTime - pastExp[0].currentTime) : 0;
    if (!pastExpObservable) result.reasons.push("FIRST_TOKEN_EXP_NOT_OBSERVABLE_BEFORE_DEADLINE");
    else if (!(result.advancedPastInitialExpSeconds >= 120)) result.reasons.push("NOT_PLAYING_PAST_FIRST_TOKEN_EXP");
  }
  // UNLOCKED: this was observed before requireSignedURLs, so post-lock behaviour is unproven.
  result.videoLockAtRun = receipt.origin?.videoLock ?? "UNKNOWN";
  result.streamErrors = tracker.streamErrorsSince(source.atMs);
  // Diagnostics only: no verdict reads them.
  result.errorDiagnostics = await tracker.streamErrorDiagnostics({
    sinceMs: source.atMs, initialExpMs, renewalMs: renewed?.atMs ?? null,
  });
  if (!progress.ok) result.reasons.push("PLAYBACK_INTERRUPTED");
  if (result.streamErrors > 0) result.reasons.push("STREAM_ERRORS");
  if (unavailableSeen) result.reasons.push("UNAVAILABLE_STATE");
  if (tracker.state.appUidForm > 0) result.reasons.push("APP_UID_FORM_REQUESTS");
  result.status = result.reasons.length === 0 ? "PASS" : "FAIL";
  return result;
}

/** Never write or print a receipt that contains anything token- or URL-like. */
export function safeReceiptText(receipt) {
  const text = JSON.stringify(receipt);
  if (!receiptLeaks(text)) return { json: text, lines: formatReceiptLines(receipt) };
  const blocked = createReceipt({});
  blocked.sourceSha = receipt.sourceSha;
  blocked.viewerBrowser = receipt.viewerBrowser;
  blocked.scenario = receipt.scenario;
  blocked.manualHours = receipt.manualHours ?? null;
  blocked.manualMode = receipt.manualMode ?? null;
  blocked.reason = "RECEIPT_REDACTION_FAILED";
  return { json: JSON.stringify(blocked), lines: formatReceiptLines(blocked) };
}

async function main() {
  const receipt = await runStreamPlaybackBrowser(process.env);
  const { json, lines } = safeReceiptText(receipt);
  const name = `celebratedeal-staging-stream-playback-${receipt.viewerBrowser}.json`;
  if (process.env.RUNNER_TEMP) await writeFile(`${process.env.RUNNER_TEMP}/${name}`, `${json}\n`, { mode: 0o600 });
  process.stdout.write(`${lines}\n${json}\n`);
  process.exitCode = JSON.parse(json).result === "PASS" ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify({ ...createReceipt(process.env), reason: "RUNNER_CRASHED" })}\n`);
    process.exitCode = 2;
  });
}
