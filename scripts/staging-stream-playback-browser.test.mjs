import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ALIAS, FIXTURE, ORIGIN, STEPS, STREAM_PATTERN_LIMIT,
  assessPlaybackProgress, redactStreamPath, streamRequestOrigin, tallyStreamRequest, assessRecovery, assessReplayTokenExp, classifyPlayerPath, classifyRequest,
  classifyStoredThumbnail, classifyStreamUrl, createReceipt, decodeStreamTokenClaims, finalVerdict,
  formatReceiptLines, receiptLeaks, redactStreamUrl, renewalDelaySeconds, replayDeadline,
  replayDeadlineMinutes, routeCategory, safariCoverage, setStep, skippedStepsFor, taipeiDateTimeLocal,
  validUploadUrl, withCorruptedSignature,
} from "./staging-stream-playback-browser-core.mjs";
import { describeFailure, probeAllowedOrigins, runStreamPlaybackBrowser, safeReceiptText } from "./staging-stream-playback-browser.mjs";

const uid = "0123456789abcdef0123456789abcdef";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(claims, signature = "c2lnbmF0dXJlLXN5bnRoZXRpYw") {
  return `${b64({ alg: "RS256", kid: "synthetic-kid" })}.${b64({ sub: uid, kid: "synthetic-kid", ...claims })}.${signature}`;
}
const customer = "https://customer-synthetic01.cloudflarestream.com";
const nbf = 1_800_000_000;
const signedManifest = `${customer}/${token({ nbf, exp: nbf + 30 + 1800 })}/manifest/video.m3u8`;
const env = {
  CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40), CELEBRATEDEAL_DEPLOYMENT_HOST: "staging-fixture.vercel.app",
  GITHUB_TOKEN: "synthetic-github", VERCEL_TOKEN: "synthetic-vercel", JOB_SECRET: "synthetic-job-secret-0123456789",
};

test("Stream URLs are classified by form and kind; the token stays out of redacted output", () => {
  const manifest = classifyStreamUrl(signedManifest);
  assert.equal(manifest.form, "TOKEN");
  assert.equal(manifest.kind, "MANIFEST");
  assert.equal(manifest.host, "CUSTOMER");
  assert.equal(classifyStreamUrl(`https://videodelivery.net/${uid}/manifest/video.m3u8`).form, "UID");
  assert.equal(classifyStreamUrl(`https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?time=1s`).kind, "THUMBNAIL");
  assert.equal(classifyStreamUrl(`${customer}/${token({ nbf, exp: nbf })}/video/240/seg_1.ts`).kind, "SEGMENT");
  assert.equal(classifyStreamUrl(`${customer}/${token({ nbf, exp: nbf })}/video/240/stream.m3u8`).kind, "PLAYLIST");
  for (const value of ["http://videodelivery.net/x/manifest/video.m3u8", "https://videodelivery.net.attacker.test/x", "https://customer-x.cloudflarestream.com.evil.test/a", "not a url"]) {
    assert.equal(classifyStreamUrl(value), null, value);
  }
  const redacted = redactStreamUrl(signedManifest);
  assert.equal(redacted, "https://customer-<code>.cloudflarestream.com/<token>/manifest/video.m3u8");
  assert.equal(redacted.includes(manifest.token), false);
});

test("request shapes are redacted: no token, uid, long id or query value survives", () => {
  const tokenValue = classifyStreamUrl(signedManifest).token;
  const cases = [
    [signedManifest, "customer:/<token>/manifest/video.m3u8"],
    [`https://videodelivery.net/${uid}/video/240/seg_12.ts?p=abc&s=def`, "videodelivery:/<uid>/video/<n>/seg_<n>.ts?keys=p,s"],
    [`${customer}/${tokenValue}/manifest/stream_t0a1b2c3d4e5f6a7b8c9d0.m3u8?CMCD=1`, "customer:/<token>/manifest/<long>.m3u8?keys=CMCD"],
    [`${customer}/${uid}/thumbnails/thumbnail.jpg?time=1s&height=270`, "customer:/<uid>/thumbnails/thumbnail.jpg?keys=height,time"],
    ["https://example.com/a", "<non-stream>"],
    ["nope", "<invalid>"],
  ];
  for (const [url, expected] of cases) {
    const redacted = redactStreamPath(url);
    assert.equal(redacted, expected, url);
    assert.equal(receiptLeaks(JSON.stringify({ redacted })), false, url);
  }
  assert.equal(redactStreamPath(`https://videodelivery.net/${uid}/x?${"k".repeat(30)}=1`), "videodelivery:/<uid>/x?keys=<key>");
});

test("only app-chosen Stream URLs must be signed; player loads of playlist URIs are provider-chosen", () => {
  const parse = (path) => classifyStreamUrl(`https://videodelivery.net/${uid}/${path}`);
  // The entry manifest is the URL the app hands out: a uid form is an app finding whatever loads it.
  for (const type of ["xhr", "fetch", "media", "document", "other"]) assert.equal(streamRequestOrigin(parse("manifest/video.m3u8"), type), "APP", type);
  for (const path of ["video/240/seg_1.ts", "manifest/stream_t1.m3u8", "video/240/init.mp4"]) {
    for (const type of ["xhr", "fetch", "media"]) assert.equal(streamRequestOrigin(parse(path), type), "PROVIDER", `${path} ${type}`);
    // Anything else (an <img>, a <script>, a document or iframe) was placed by the page itself.
    for (const type of ["image", "script", "document", "other"]) assert.equal(streamRequestOrigin(parse(path), type), "APP", `${path} ${type}`);
  }
  assert.equal(streamRequestOrigin(parse("thumbnails/thumbnail.jpg"), "image"), "APP");
  assert.equal(streamRequestOrigin(null, "xhr"), null);
});

test("stream request tally is bounded, keeps counts per shape and phase, and skips thumbnails", () => {
  const list = [];
  const seg = (n) => `https://videodelivery.net/${uid}/video/240/seg_${n}.ts`;
  tallyStreamRequest(list, { phase: "VIEWER_START", url: seg(1), resourceType: "xhr" }, "request");
  tallyStreamRequest(list, { phase: "VIEWER_START", url: seg(2), resourceType: "xhr" }, "request");
  tallyStreamRequest(list, { phase: "VIEWER_START", url: seg(2), resourceType: "xhr" }, "ok");
  tallyStreamRequest(list, { phase: "RENEWAL", url: seg(3), resourceType: "xhr" }, "failed");
  assert.equal(tallyStreamRequest(list, { phase: "VIEWER_START", url: `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg`, resourceType: "image" }, "request"), null);
  assert.deepEqual(list, [
    { phase: "VIEWER_START", origin: "PROVIDER", form: "UID", kind: "SEGMENT", resourceType: "xhr", pattern: "videodelivery:/<uid>/video/<n>/seg_<n>.ts", requests: 2, ok: 1, failed: 0 },
    { phase: "RENEWAL", origin: "PROVIDER", form: "UID", kind: "SEGMENT", resourceType: "xhr", pattern: "videodelivery:/<uid>/video/<n>/seg_<n>.ts", requests: 0, ok: 0, failed: 1 },
  ]);
  const crowded = [];
  for (let index = 0; index < STREAM_PATTERN_LIMIT + 10; index += 1) {
    const dir = `dir${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}`;
    tallyStreamRequest(crowded, { phase: "VIEWER_START", url: `https://videodelivery.net/${uid}/${dir}/seg.ts`, resourceType: "xhr" }, "request");
  }
  assert.equal(crowded.length, STREAM_PATTERN_LIMIT);
  assert.equal(crowded.at(-1).pattern, "OVERFLOW");
  assert.equal(crowded.at(-1).requests, 11);
  assert.equal(crowded.reduce((sum, item) => sum + item.requests, 0), STREAM_PATTERN_LIMIT + 10);
  // An unknown phase or resource type is normalised and still counted.
  tallyStreamRequest(crowded, { phase: "weird phase", url: seg(1), resourceType: "beacon" }, "request");
  assert.equal(crowded.at(-1).requests, 12);
});

test("token claims are decoded from the payload only and broken tokens are rejected", () => {
  assert.deepEqual(decodeStreamTokenClaims(classifyStreamUrl(signedManifest).token), { nbf, exp: nbf + 1830, subIsUid: true });
  assert.equal(decodeStreamTokenClaims("a.b"), null);
  assert.equal(decodeStreamTokenClaims(`${b64({})}.${b64({ nbf: "x", exp: 1 })}.sig`), null);
  assert.equal(decodeStreamTokenClaims(`${b64({})}.not-json.sig`), null);
  const corrupted = withCorruptedSignature(signedManifest);
  assert.notEqual(corrupted, signedManifest);
  assert.equal(classifyStreamUrl(corrupted).form, "TOKEN");
  assert.deepEqual(decodeStreamTokenClaims(classifyStreamUrl(corrupted).token), decodeStreamTokenClaims(classifyStreamUrl(signedManifest).token));
  assert.equal(withCorruptedSignature(`https://videodelivery.net/${uid}/manifest/video.m3u8`), null);
});

test("replay exp is min(issued + 30 min, deadline) with issued = nbf + 30 s, compared exactly", () => {
  const issued = nbf + 30;
  // Deadline far away: the 30-minute TTL bounds exp; equality with the deadline is not expected.
  assert.deepEqual(assessReplayTokenExp({ nbf, exp: issued + 1800 }, issued + 3600),
    { matches: true, deadlineCapped: false, expEqualsDeadline: false, deltaSeconds: 0 });
  // Deadline inside the window: exp must be exactly the deadline.
  assert.deepEqual(assessReplayTokenExp({ nbf, exp: issued + 600 }, issued + 600),
    { matches: true, deadlineCapped: true, expEqualsDeadline: true, deltaSeconds: 0 });
  assert.equal(assessReplayTokenExp({ nbf, exp: issued + 1800 }, issued + 600).matches, false);
  assert.equal(assessReplayTokenExp({ nbf, exp: issued + 601 }, issued + 600).deltaSeconds, 1);
  // A deadline exactly at the TTL bound is not "capped" but still matches.
  assert.equal(assessReplayTokenExp({ nbf, exp: issued + 1800 }, issued + 1800).deadlineCapped, false);
});

test("renewal timing mirrors the player (2 minutes early, half-life for short tokens, 5 s floor)", () => {
  assert.equal(renewalDelaySeconds(1800), 1680);
  assert.equal(renewalDelaySeconds(600), 480);
  assert.equal(renewalDelaySeconds(200), 100);
  assert.equal(renewalDelaySeconds(4), 5);
  assert.equal(renewalDelaySeconds(-1), 5);
});

test("the replay deadline lands on a whole minute in the future and renders in Taipei time", () => {
  const base = Date.UTC(2026, 10, 25, 1, 2, 3);
  const deadline = replayDeadline(base, 58);
  assert.equal(deadline.getTime() % 60_000, 0);
  assert.ok(deadline.getTime() >= base + 58 * 60_000);
  assert.ok(deadline.getTime() < base + 59 * 60_000);
  assert.equal(taipeiDateTimeLocal(new Date(Date.UTC(2026, 10, 25, 16, 30))), "2026-11-26T00:30");
  // Full: the first renewal (~28 min after the long-play start) must fall inside a deadline-capped window.
  assert.ok(replayDeadlineMinutes("full") > 30 && replayDeadlineMinutes("full") < 60);
  assert.ok(replayDeadlineMinutes("quick") < 30);
});

test("playback progress fails on stalls, regressions, pauses, ends and media errors", () => {
  const steady = Array.from({ length: 10 }, (_, index) => ({ atMs: index * 5_000, currentTime: index * 5, paused: false, ended: false, errorCode: null }));
  const ok = assessPlaybackProgress(steady, { maxStallSeconds: 10, minAdvanceSeconds: 30 });
  assert.equal(ok.ok, true);
  assert.equal(ok.advancedSeconds, 45);
  const stalled = steady.map((sample, index) => (index >= 3 && index <= 6 ? { ...sample, currentTime: 15 } : sample));
  const stall = assessPlaybackProgress(stalled, { maxStallSeconds: 10, minAdvanceSeconds: 1 });
  assert.equal(stall.ok, false);
  assert.equal(stall.maxStallSeconds, 15);
  const regressed = steady.map((sample, index) => (index === 5 ? { ...sample, currentTime: 0 } : sample));
  assert.equal(assessPlaybackProgress(regressed).regressions, 1);
  assert.equal(assessPlaybackProgress(regressed).ok, false);
  assert.equal(assessPlaybackProgress(steady.map((sample, index) => (index === 4 ? { ...sample, paused: true } : sample))).ok, false);
  assert.equal(assessPlaybackProgress(steady.map((sample, index) => (index === 4 ? { ...sample, errorCode: 2 } : sample))).ok, false);
  assert.equal(assessPlaybackProgress(steady.map((sample, index) => (index === 9 ? { ...sample, ended: true } : sample))).ok, false);
  assert.equal(assessPlaybackProgress([steady[0]]).ok, false);
  assert.equal(assessPlaybackProgress(null).ok, false);
});

test("recovery: playing must resume near the old position, paused must stay paused, both must reload", () => {
  const playing = { state: "playing", forbiddenServed: 3, expectedPosition: 120, streamOkAfterRestore: true };
  assert.deepEqual(assessRecovery({ ...playing, after: { currentTime: 140, paused: false, errorCode: null, advancedSeconds: 7 } }),
    { status: "PASS", reasons: [] });
  assert.deepEqual(assessRecovery({ ...playing, after: { currentTime: 0.2, paused: false, errorCode: null, advancedSeconds: 7 } }).reasons, ["POSITION_RESET"]);
  assert.deepEqual(assessRecovery({ ...playing, after: { currentTime: 125, paused: true, errorCode: null, advancedSeconds: 0 } }).reasons, ["NOT_RESUMED", "NOT_ADVANCING"]);
  assert.deepEqual(assessRecovery({ ...playing, streamOkAfterRestore: false, after: { currentTime: 140, paused: false, errorCode: null, advancedSeconds: 7 } }).reasons, ["LOADING_NOT_RESUMED"]);
  assert.deepEqual(assessRecovery({ ...playing, forbiddenServed: 0, after: { currentTime: 140, paused: false, errorCode: null, advancedSeconds: 7 } }).reasons, ["NO_FORBIDDEN_SERVED"]);
  assert.deepEqual(assessRecovery({ ...playing, after: { currentTime: 140, paused: false, errorCode: 2, advancedSeconds: 7 } }).reasons, ["MEDIA_ERROR"]);

  const paused = { state: "paused", forbiddenServed: 1, expectedPosition: 300, streamOkAfterRestore: true };
  assert.deepEqual(assessRecovery({ ...paused, after: { currentTime: 300.4, paused: true, errorCode: null }, resumedAfterPlay: true }),
    { status: "PASS", reasons: [] });
  assert.deepEqual(assessRecovery({ ...paused, after: { currentTime: 310, paused: false, errorCode: null }, resumedAfterPlay: true }).reasons,
    ["PAUSE_NOT_KEPT", "PAUSED_POSITION_MOVED"]);
  assert.deepEqual(assessRecovery({ ...paused, after: { currentTime: 300, paused: true, errorCode: null }, resumedAfterPlay: false }).reasons,
    ["PLAY_AFTER_RECOVERY_FAILED"]);
  assert.deepEqual(assessRecovery({ ...paused, after: { currentTime: 0, paused: true, errorCode: null }, resumedAfterPlay: true }).reasons,
    ["POSITION_RESET", "PAUSED_POSITION_MOVED"]);
  assert.deepEqual(assessRecovery({ ...paused, after: null }).reasons, ["NO_AFTER_SAMPLE"]);
});

test("the stored thumbnail must be the uid form, never a token", () => {
  assert.equal(classifyStoredThumbnail(`https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg`), "UID_FORM");
  assert.equal(classifyStoredThumbnail(`${customer}/${token({ nbf, exp: nbf })}/thumbnails/thumbnail.jpg`), "TOKEN_FORM");
  assert.equal(classifyStoredThumbnail(""), "EMPTY");
  assert.equal(classifyStoredThumbnail("https://example.com/a.jpg"), "NOT_STREAM");
  assert.equal(classifyStoredThumbnail(`https://videodelivery.net/${uid}/manifest/video.m3u8`), "NOT_THUMBNAIL");
});

test("request policy: Stream reads pass, owner and viewer write only their own endpoints, payments never", () => {
  const req = (path, method = "GET", postData = null) => ({ url: path.startsWith("https://") ? path : `${ORIGIN}${path}`, method, postData });
  assert.equal(classifyRequest(req(signedManifest), "viewer"), "STREAM");
  assert.equal(classifyRequest(req(signedManifest, "POST"), "viewer"), "BLOCK");
  for (const path of ["/forms/new", "/messages/templates/new", "/api/interaction-scripts/upsert", "/lives/new", "/api/live-studio/drafts", "/api/media/videos/direct-upload", "/videos/abc_123/edit"]) {
    assert.equal(classifyRequest(req(path, "POST"), "owner"), "WRITE", path);
    assert.equal(classifyRequest(req(path, "POST"), "viewer"), "BLOCK", path);
  }
  assert.equal(classifyRequest(req("/api/live-admission", "POST"), "viewer"), "WRITE");
  assert.equal(classifyRequest(req("/api/live-admission", "DELETE"), "viewer"), "WRITE");
  assert.equal(classifyRequest(req("/api/stream-usage", "POST"), "viewer"), "WRITE");
  assert.equal(classifyRequest(req("/api/live-admission", "POST"), "owner"), "BLOCK");
  assert.equal(classifyRequest(req("/api/live-interactions", "POST"), "viewer"), "BLOCK");
  assert.equal(classifyRequest(req("/api/form-submissions", "POST"), "viewer"), "BLOCK");
  assert.equal(classifyRequest(req("/api/payments/checkout", "POST"), "viewer"), "PAYMENT");
  assert.equal(classifyRequest(req("/checkout/v/p", "POST"), "owner"), "PAYMENT");
  assert.equal(classifyRequest(req("/api/admin/ops/payuni/wp4-session", "POST"), "owner"), "BLOCK");
  assert.equal(classifyRequest(req("/lives/abc/edit", "POST"), "owner"), "BLOCK");
  assert.equal(classifyRequest(req("/api/analytics", "POST"), "viewer"), "ANALYTICS");
  assert.equal(classifyRequest(req("/monitoring", "POST"), "viewer"), "TELEMETRY");
  assert.equal(classifyRequest(req("/api/affiliate-attribution/direct-entry", "POST"), "viewer"), "ATTRIBUTION_RESET");
  assert.equal(classifyRequest(req("/api/affiliate-attribution/direct-entry", "POST", "{}"), "viewer"), "BLOCK");
  assert.equal(classifyRequest(req("/live/slug"), "viewer"), "READ");
  assert.equal(classifyRequest(req("https://example.com/x"), "viewer"), "EXTERNAL");
  assert.equal(classifyRequest(req(`http://${ALIAS}/lives/new`, "POST"), "owner"), "EXTERNAL");
});

test("upload capability and player path are narrowly recognised", () => {
  assert.equal(validUploadUrl(`https://upload.videodelivery.net/${uid}`), true);
  for (const value of [`https://upload.videodelivery.net/${uid}?x=1`, `http://upload.videodelivery.net/${uid}`, `https://upload.videodelivery.net.evil.test/${uid}`, `https://upload.videodelivery.net/${uid}/extra`, "https://user:pw@upload.videodelivery.net/x"]) {
    assert.equal(validUploadUrl(value), false, value);
  }
  assert.equal(classifyPlayerPath("blob:https://celebrate/abc"), "HLS_JS");
  assert.equal(classifyPlayerPath(signedManifest), "NATIVE");
  assert.equal(classifyPlayerPath(""), "NONE");
  assert.equal(classifyPlayerPath("https://example.com/v.mp4"), "OTHER");
});

test("Safari is never claimed from Playwright WebKit, whatever path WebKit took", () => {
  assert.equal(safariCoverage(null).safari, "NOT_COVERED");
  const hlsJs = safariCoverage({ playerPath: "HLS_JS", nativeHlsType: true });
  assert.deepEqual(hlsJs, { safari: "NOT_COVERED", safariReason: "PLAYWRIGHT_WEBKIT_USED_HLS_JS_NATIVE_PATH_NOT_EXERCISED", webkitNativeHls: "NOT_EXERCISED" });
  const native = safariCoverage({ playerPath: "NATIVE", nativeHlsType: true });
  assert.equal(native.safari, "NOT_COVERED");
  assert.equal(native.webkitNativeHls, "EXERCISED_ON_PLAYWRIGHT_WEBKIT");
  assert.equal(safariCoverage({ playerPath: "NONE", nativeHlsType: false }).safariReason, "PLAYWRIGHT_WEBKIT_HAS_NO_NATIVE_HLS");
});

test("modes skip only their declared steps; PASS needs every other step and no blocked write", () => {
  assert.deepEqual([...skippedStepsFor("chromium", "full")], []);
  assert.deepEqual([...skippedStepsFor("chromium", "quick")], ["RENEWAL"]);
  assert.deepEqual([...skippedStepsFor("webkit", "quick")].sort(), ["ORIGIN_PROBE", "PAGES", "RENEWAL"]);
  const receipt = createReceipt({ ...env, CELEBRATEDEAL_STREAM_VIEWER_BROWSER: "chromium", CELEBRATEDEAL_STREAM_PLAYBACK_SCENARIO: "full" });
  for (const step of STEPS) setStep(receipt, step, "PASS", 1);
  assert.deepEqual(finalVerdict(receipt), { result: "PASS", reason: "NONE" });
  setStep(receipt, "RENEWAL", "SKIPPED");
  assert.deepEqual(finalVerdict(receipt), { result: "BLOCKED", reason: "STEP_RENEWAL_SKIPPED" });
  setStep(receipt, "RENEWAL", "PASS");
  receipt.blockedWrites = 1;
  assert.deepEqual(finalVerdict(receipt), { result: "BLOCKED", reason: "UNEXPECTED_WRITE_BLOCKED" });
  receipt.blockedWrites = 0;
  receipt.sideEffects.ownerSessionsIssued = 2;
  receipt.sideEffects.ownerSessionsRevoked = 1;
  assert.deepEqual(finalVerdict(receipt), { result: "BLOCKED", reason: "OWNER_SESSION_NOT_REVOKED" });
  const quick = createReceipt({ CELEBRATEDEAL_STREAM_VIEWER_BROWSER: "webkit", CELEBRATEDEAL_STREAM_PLAYBACK_SCENARIO: "quick" });
  for (const step of STEPS) setStep(quick, step, skippedStepsFor("webkit", "quick").has(step) ? "SKIPPED" : "PASS");
  assert.equal(finalVerdict(quick).result, "PASS");
  // Unknown inputs fall back to the strictest mode.
  const fallback = createReceipt({ CELEBRATEDEAL_STREAM_VIEWER_BROWSER: "safari", CELEBRATEDEAL_STREAM_PLAYBACK_SCENARIO: "short" });
  assert.equal(fallback.viewerBrowser, "chromium");
  assert.equal(fallback.scenario, "full");
});

test("receipt leak guard catches tokens, uids, URLs, customer hosts and bearer values", () => {
  const clean = createReceipt(env);
  clean.startedAt = new Date(0).toISOString();
  assert.equal(receiptLeaks(JSON.stringify(clean)), false);
  assert.equal(receiptLeaks(formatReceiptLines(clean)), false);
  for (const leak of [classifyStreamUrl(signedManifest).token, uid, signedManifest, "customer-abc123.cloudflarestream", "Bearer x", "https://example.com"]) {
    assert.equal(receiptLeaks(`{"x":"${leak}"}`), true, leak);
  }
  const leaky = createReceipt(env);
  leaky.pages.push({ page: "videos_list", status: "PASS", note: signedManifest });
  const safe = safeReceiptText(leaky);
  assert.equal(JSON.parse(safe.json).reason, "RECEIPT_REDACTION_FAILED");
  assert.equal(safe.json.includes(signedManifest), false);
  assert.equal(safe.lines.includes("stream_playback_result=BLOCKED"), true);
});

test("receipt lines are single-line key=value records with fixed vocabulary", () => {
  const receipt = createReceipt(env);
  receipt.recovery.push({ mode: "token_expiry", state: "playing", status: "FAIL", reasons: ["NOT_RESUMED", "NOT_ADVANCING"] });
  receipt.origin = { status: "PASS", appOrigin: 200, noOrigin: 200, foreignOrigin: 403, invalidToken: 401, invalidTokenCorsReadable: false };
  tallyStreamRequest(receipt.viewer.streamRequestPatterns, { phase: "VIEWER_START", url: `https://videodelivery.net/${uid}/video/240/seg_12.ts?p=secret`, resourceType: "xhr" }, "request");
  const lines = formatReceiptLines(receipt).split("\n");
  assert.equal(lines.length, 9);
  assert.ok(lines.some((line) => line.startsWith("stream_playback_requests=app_uid:0 provider_uid:0 provider_failures:0 VIEWER_START/PROVIDER/UID/SEGMENT/xhr:videodelivery:/<uid>/video/<n>/seg_<n>.ts?keys=p=1(ok:0,failed:0)")));
  assert.equal(receiptLeaks(lines.join("\n")), false);
  for (const line of lines) assert.match(line, /^stream_playback_[a-z]+=\S/u);
  assert.ok(lines.some((line) => line.includes("token_expiry/playing:FAIL(NOT_RESUMED+NOT_ADVANCING)")));
  assert.ok(lines.some((line) => line === "stream_playback_origin=status:PASS app:200 none:200 foreign:403 invalid_token:401 invalid_token_cors_readable:false"));
  assert.ok(lines.some((line) => line.includes("safari:NOT_COVERED")));
  assert.ok(lines.some((line) => line.includes("live_renewal:NOT_COVERED")));
});

test("failure categories and route classes are fixed enums, never messages or URLs", () => {
  const timeout = new Error(`Timeout 30000ms exceeded while waiting for ${signedManifest}`);
  timeout.name = "TimeoutError";
  assert.equal(describeFailure(timeout), "TIMEOUT");
  assert.equal(describeFailure(new Error(`net::ERR_ABORTED at ${signedManifest}`)), "NAVIGATION_ABORTED");
  assert.equal(describeFailure(new Error(signedManifest)), "OTHER");
  assert.equal(describeFailure("string"), "OTHER");
  assert.equal(routeCategory(`${ORIGIN}/videos/abc/edit`), "VIDEO_EDIT");
  assert.equal(routeCategory(`${ORIGIN}/live/some-slug`), "PUBLIC_LIVE");
  assert.equal(routeCategory(`${ORIGIN}/form/some-slug`), "PUBLIC_FORM");
  assert.equal(routeCategory("https://example.com/videos"), "EXTERNAL");
  assert.equal(routeCategory("nope"), "INVALID_URL");
});

test("Origin probe records Cloudflare status codes only, with the app Origin as the control", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers, redirect: options.redirect });
    const origin = options.headers.Origin;
    if (url !== signedManifest) return new Response("", { status: 401, headers: { "access-control-allow-origin": "*" } });
    if (origin === ORIGIN) return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nx.m3u8", { status: 200 });
    if (origin) return new Response("", { status: 403 });
    return new Response("#EXTM3U", { status: 200 });
  };
  const result = await probeAllowedOrigins(signedManifest, fetchImpl);
  assert.deepEqual(result, { status: "PASS", appOrigin: 200, noOrigin: 200, foreignOrigin: 403, invalidToken: 401, invalidTokenCorsReadable: true, appManifest: true });
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.redirect, "manual");
    assert.equal(Object.keys(call.headers).every((key) => key === "Origin"), true);
  }
  assert.equal(calls[1].headers.Origin, undefined);
  assert.equal(calls[2].headers.Origin, "https://stream-origin-probe.invalid");
  assert.notEqual(calls[3].url, signedManifest);
  assert.equal(receiptLeaks(JSON.stringify(result)), false);
  assert.equal((await probeAllowedOrigins(`https://videodelivery.net/${uid}/manifest/video.m3u8`, fetchImpl)).reason, "NO_SIGNED_URL");
  const failing = await probeAllowedOrigins(signedManifest, async () => { throw new Error("offline"); });
  assert.equal(failing.status, "FAIL");
  assert.equal(failing.appOrigin, 0);
});

test("the runner refuses bad bindings and never launches a browser before lineage and alias proofs", async () => {
  const forbidden = { chromium: { launch: () => { throw new Error("must not launch"); } }, webkit: { launch: () => { throw new Error("must not launch"); } } };
  const missing = await runStreamPlaybackBrowser({ ...env, JOB_SECRET: "" }, { playwright: forbidden });
  assert.equal(missing.reason, "INVALID_BINDING");
  const preview = await runStreamPlaybackBrowser({ ...env, CELEBRATEDEAL_BROWSER_SURFACE: "immutable_preview" }, { playwright: forbidden });
  assert.equal(preview.reason, "INVALID_BINDING");
  const lineage = await runStreamPlaybackBrowser(env, { playwright: forbidden, verifyLineage: async () => false, verifyAlias: async () => true });
  assert.equal(lineage.reason, "LINEAGE_NOT_VERIFIED");
  assert.equal(lineage.steps.find((entry) => entry.step === "BINDING").status, "FAIL");
  const alias = await runStreamPlaybackBrowser(env, { playwright: forbidden, verifyLineage: async () => true, verifyAlias: async () => false });
  assert.equal(alias.reason, "ALIAS_NOT_VERIFIED");
  assert.equal(alias.lineage, "VERIFIED");
  for (const receipt of [missing, preview, lineage, alias]) {
    assert.equal(receipt.result, "BLOCKED");
    assert.equal(receiptLeaks(JSON.stringify(receipt)), false);
    assert.equal(JSON.stringify(receipt).includes(env.JOB_SECRET), false);
  }
});

test("a launch failure is reported as a fixed category with no session left behind", async () => {
  const broken = { chromium: { launch: async () => { throw new Error("Executable doesn't exist at /opt/google/chrome"); } } };
  const receipt = await runStreamPlaybackBrowser(env, { playwright: broken, verifyLineage: async () => true, verifyAlias: async () => true });
  assert.equal(receipt.result, "BLOCKED");
  assert.equal(receipt.failureStep, "OWNER_SESSION");
  assert.equal(receipt.failureCategory, "OTHER");
  assert.equal(receipt.sideEffects.ownerSessionsIssued, 0);
  assert.equal(receipt.steps.find((entry) => entry.step === "SESSION_CLEANUP").status, "PASS");
  assert.equal(receiptLeaks(JSON.stringify(receipt)), false);
});

test("the committed fixture is the pinned 55-minute synthetic video", async () => {
  const bytes = await readFile(new URL(`./${FIXTURE.videoFile}`, import.meta.url));
  assert.equal(bytes.length, FIXTURE.videoBytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), FIXTURE.videoSha256);
  // The full scenario plays ~30 minutes and hls.js buffers ~10 minutes ahead of a tiny bitrate.
  assert.ok(FIXTURE.videoDurationSeconds >= 50 * 60);
  const note = await readFile(new URL("./fixtures/staging-stream-fifty-five-minutes.md", import.meta.url), "utf8");
  assert.ok(note.includes(FIXTURE.videoSha256));
  assert.ok(note.includes(String(FIXTURE.videoBytes)));
});

test("workflow: protected master only, pinned actions, contract tests and proofs before secrets", async () => {
  const workflow = await readFile(new URL("../.github/workflows/staging-stream-playback-browser.yml", import.meta.url), "utf8");
  assert.match(workflow, /^on:\n {2}workflow_dispatch:/mu);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/mu);
  assert.match(workflow, /permissions:\n {2}contents: read\n {2}deployments: read/u);
  for (const line of workflow.split("\n").filter((entry) => /^\s+(?:- )?uses: /u.test(entry))) {
    assert.match(line, /uses: [\w./-]+@[a-f0-9]{40} # v\d/u, line);
  }
  const jobs = workflow.split(/\n {2}(?=[a-z-]+:\n {4}(?:if|needs|runs-on))/u).slice(1);
  assert.equal(jobs.length, 2);
  for (const job of jobs) {
    assert.match(job, /github\.ref == 'refs\/heads\/master' && github\.ref_protected/u);
    assert.match(job, /environment:\r?\n\s+name: Preview – celebrate-deal-staging\r?\n\s+deployment: false\r?\n/u);
    assert.match(job, /persist-credentials: false/u);
    const firstSecret = job.indexOf("secrets.");
    for (const before of ["npm ci --ignore-scripts", "node --test scripts/staging-stream-playback-browser.test.mjs", "--verify-lineage"]) {
      const index = job.indexOf(before);
      assert.ok(index !== -1 && index < firstSecret, before);
    }
    assert.match(job, /node scripts\/staging-browser-smoke\.mjs --verify-alias/u);
    assert.match(job, /JOB_SECRET: \$\{\{ secrets\.JOB_SECRET \}\}/u);
    assert.doesNotMatch(job, /OPS_SMOKE_SECRET|PAYUNI|CLOUDFLARE_|DATABASE_URL/u);
    assert.match(job, /node scripts\/staging-stream-playback-browser\.mjs/u);
    assert.match(job, /if: \$\{\{ always\(\) \}\}\n\s+uses: actions\/upload-artifact@/u);
  }
  assert.match(jobs[0], /runs-on: ubuntu-latest/u);
  assert.match(jobs[0], /CELEBRATEDEAL_STREAM_VIEWER_BROWSER: chromium/u);
  assert.match(jobs[1], /runs-on: macos-latest/u);
  assert.match(jobs[1], /needs: chromium/u);
  assert.match(jobs[1], /CELEBRATEDEAL_STREAM_VIEWER_BROWSER: webkit/u);
  assert.match(jobs[1], /CELEBRATEDEAL_STREAM_PLAYBACK_SCENARIO: quick/u);
  assert.match(workflow, /concurrency:\n {2}group: staging-stream-playback-browser\n {2}cancel-in-progress: false/u);
});
