import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ALIAS, FIXTURE, ORIGIN, STEPS, STREAM_PATTERN_LIMIT,
  assessPlaybackProgress, classifyRequestFailure, classifyVideoLock, describePageError, isBenignPageError, postLockCoverage, redactStreamPath, streamTokenSubject, streamRequestOrigin, tallyStreamRequest, assessRecovery, assessReplayTokenExp, classifyPlayerPath, classifyRequest,
  classifyStoredThumbnail, classifyStreamUrl, createReceipt, decodeStreamTokenClaims, finalVerdict,
  formatReceiptLines, receiptLeaks, redactStreamUrl, renewalDelaySeconds, replayDeadline,
  replayDeadlineMinutes, routeCategory, safariCoverage, setStep, skippedStepsFor, taipeiDateTimeLocal,
  describeErrorSample, formatRenewalErrorsLine, streamSegmentIdentity, summarizeStreamErrors,
  validUploadUrl, withCorruptedSignature, assessNewTokenUse, createTokenAttribution, playlistReferences, shouldRefuseInRecovery,
} from "./staging-stream-playback-browser-core.mjs";
import { describeFailure, probeAllowedOrigins, RECOVERY_CASES, runStreamPlaybackBrowser, safeReceiptText } from "./staging-stream-playback-browser.mjs";

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
  tallyStreamRequest(list, { phase: "VIEWER_START", url: seg(2), resourceType: "xhr" }, "aborted");
  tallyStreamRequest(list, { phase: "RENEWAL", url: seg(3), resourceType: "xhr" }, "failed");
  tallyStreamRequest(list, { phase: "RENEWAL", url: seg(4), resourceType: "xhr" }, "injected");
  assert.equal(tallyStreamRequest(list, { phase: "VIEWER_START", url: `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg`, resourceType: "image" }, "request"), null);
  assert.deepEqual(list, [
    { phase: "VIEWER_START", origin: "PROVIDER", form: "UID", kind: "SEGMENT", resourceType: "xhr", pattern: "videodelivery:/<uid>/video/<n>/seg_<n>.ts", requests: 2, ok: 1, failed: 0, aborted: 1, injected: 0 },
    { phase: "RENEWAL", origin: "PROVIDER", form: "UID", kind: "SEGMENT", resourceType: "xhr", pattern: "videodelivery:/<uid>/video/<n>/seg_<n>.ts", requests: 0, ok: 0, failed: 1, aborted: 0, injected: 1 },
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

test("a cancelled request is an abort, not a delivery failure; anything else stays a failure", () => {
  for (const text of ["net::ERR_ABORTED", "cancelled", "Load request cancelled", "NS_BINDING_ABORTED"]) {
    assert.equal(classifyRequestFailure(text), "ABORTED", text);
  }
  for (const text of ["net::ERR_CONNECTION_RESET", "net::ERR_FAILED", "net::ERR_TIMED_OUT", "Could not connect to the server.", "", null, undefined]) {
    assert.equal(classifyRequestFailure(text), "FAILED", String(text));
  }
});

test("page errors are reduced to redacted fields; only an interrupted play() is benign", () => {
  const token = classifyStreamUrl(signedManifest).token;
  const leaky = describePageError({
    name: "TypeError",
    message: `Cannot read properties of undefined (reading 'x') at ${signedManifest} for owner@example.com id ${uid} Bearer abc ${token}`,
    stack: `TypeError: boom\n    at f (https://${ALIAS}/_next/static/chunks/app/live/page-0a1b2c3d4e5f6071.js?dpl=dpl_x:1:2345)\n    at g (https://${ALIAS}/x.js:9:9)`,
  });
  assert.equal(leaky.name, "TypeError");
  assert.equal(leaky.category, "OTHER");
  assert.equal(leaky.frame, "page-0a1b2c3d4e5f6071.js:1:2345");
  assert.equal(receiptLeaks(JSON.stringify(leaky)), false);
  for (const secret of [uid, token, "owner@example.com", ALIAS, "abc"]) assert.equal(leaky.message.includes(secret), false, secret);
  assert.ok(leaky.message.length <= 160);

  // WebKit reports an unhandled rejection as text with the error name inside it.
  const webkitPlay = describePageError({ message: "Unhandled Promise Rejection: AbortError: The play() request was interrupted by a call to pause().", stack: "" });
  assert.deepEqual(webkitPlay, { name: "AbortError", message: "The play() request was interrupted by a call to pause().", frame: "NONE", category: "MEDIA_PLAY_INTERRUPTED", unhandledRejection: true });
  assert.equal(isBenignPageError(webkitPlay), true);
  // A generic abort (an aborted fetch rejects the same way in WebKit) is not filtered.
  const genericAbort = describePageError({ message: "Unhandled Promise Rejection: AbortError: The operation was aborted.", stack: "" });
  assert.equal(genericAbort.category, "ABORT");
  assert.equal(isBenignPageError(genericAbort), false);
  assert.equal(describePageError({ name: "TypeError", message: "Load failed" }).category, "NETWORK");
  assert.equal(isBenignPageError(describePageError({ name: "TypeError", message: "x is not a function" })), false);
  assert.equal(describePageError("plain string").name, "Error");
  assert.equal(describePageError({ name: "<script>", message: "x" }).name, "Error");
});

test("run 45561006960 leak: URL query values never survive, in any URL form, and the guard catches them", () => {
  const p = Buffer.from(JSON.stringify({ typ: "JWT", videoID: uid, ownerID: 12345678, exp: 1800000000 })).toString("base64url");
  // Exactly how Playwright hands WebKit's "https://…" report over: name "https", message from "/host".
  const segment = describePageError({ name: "https", message: `/videodelivery.net/${uid}/video/64/seg_161.mp4?p=${p}&s=c2lnbmF0dXJl`, stack: "" });
  assert.equal(segment.name, "Error");
  assert.equal(segment.message, "<url:stream/<uid>/video/<n>/seg_<n>.mp4?keys=p,s>");
  const poll = describePageError({ name: "https", message: `/${ALIAS}/api/live-updates?vendorId=wp4_synthetic_vendor_v1&liveId=cm0abcdefghijklmnop&include=chat,interaction`, stack: "" });
  assert.equal(poll.message, "<url:app/api/live-updates?keys=include,liveId,vendorId>");
  const forms = [
    `see https://${ALIAS}/api/x?token=abc&b=2 now`,
    `relative /api/live-updates?vendorId=v1&liveId=l1 failed`,
    `//videodelivery.net/${uid}/video/1/seg_1.mp4?p=${p}`,
    `videodelivery.net/${uid}/video/1/seg_1.mp4?p=${p}`,
    `bare ${p} value`,
  ];
  for (const message of forms) {
    const described = describePageError({ name: "TypeError", message, stack: "" });
    for (const secret of [p, "eyJ", "vendorId=", "liveId=", "token=abc", "v1", uid, ALIAS]) {
      assert.equal(described.message.includes(secret), false, `${message} -> ${described.message} contains ${secret}`);
    }
    assert.equal(receiptLeaks(JSON.stringify(described)), false, described.message);
  }
  // The guard itself catches what the old sanitizer let through.
  for (const leaked of [
    `"message":"/videodelivery.net/<hex>/video/64/seg_161.mp4?p=${p.slice(0, 40)}"`,
    `"message":"/${ALIAS}/api/live-updates?vendorId=x&liveId=y"`,
    `"p":"${p}"`,
    "?keys=a,b=1",
  ]) assert.equal(receiptLeaks(leaked), true, leaked);
  // The receipt's own vocabulary is not a false positive.
  for (const clean of ["PLAYWRIGHT_WEBKIT_USED_HLS_JS_NATIVE_PATH_NOT_EXERCISED", "videodelivery:/<uid>/video/<n>/seg_<n>.mp4?keys=p,s:17(ok:16,failed:0)", "a".repeat(40)]) {
    assert.equal(receiptLeaks(clean), false, clean);
  }
});

test("a bare load URL report is benign only in the WebKit viewer during the runner's own navigation", () => {
  const segment = { name: "https", message: `/videodelivery.net/${uid}/video/64/seg_161.mp4?p=x&s=y`, stack: "x\n    at send (https://h/_next/static/immutable/chunks/3cwmmhv6f5k9b.js:29:124403)" };
  const poll = { name: "https", message: `/${ALIAS}/api/live-updates?vendorId=a&liveId=b`, stack: "" };
  const during = { viewerBrowser: "webkit", actor: "viewer", duringNavigation: true };
  const suffix = " due to access control checks.";
  const segmentAcc = { ...segment, message: segment.message + suffix };
  const pollAcc = { ...poll, message: poll.message + suffix };
  for (const error of [segment, poll, segmentAcc, pollAcc]) {
    const described = describePageError(error, during);
    assert.equal(described.category, "WEBKIT_LOAD_CANCELLED_BY_RUNNER_NAVIGATION");
    assert.equal(isBenignPageError(described), true);
    for (const context of [
      { ...during, duringNavigation: false }, { ...during, viewerBrowser: "chromium" }, { ...during, actor: "owner" }, {},
    ]) {
      const other = describePageError(error, context);
      assert.equal(other.category, "LOAD_URL_REPORT", JSON.stringify(context));
      assert.equal(isBenignPageError(other), false);
    }
  }
  assert.equal(describePageError(segment, during).frame, "3cwmmhv6f5k9b.js:29:124403");
  // Anything that is not exactly one player-load or poll URL stays a real page error.
  for (const message of [
    `/${ALIAS}/api/live-admission`,
    `/videodelivery.net/${uid}/thumbnails/thumbnail.jpg`,
    `/videodelivery.net/${uid}/video/1/seg_1.mp4 and then a TypeError`,
    "/example.com/api/live-updates",
    `/${ALIAS}/api/live-admission due to access control checks.`,
    `/videodelivery.net/${uid}/video/1/seg_1.mp4 due to access control checks. TypeError`,
    `/videodelivery.net/${uid}/video/1/seg_1.mp4 blocked due to access control checks.`,
  ]) {
    const described = describePageError({ name: "https", message, stack: "" }, during);
    assert.equal(isBenignPageError(described), false, message);
  }
  assert.equal(isBenignPageError(describePageError({ name: "TypeError", message: "x is not a function" }, during)), false);
});

test("post-lock playback is claimed only for a locked video that played through the renewal", () => {
  const receipt = createReceipt(env);
  assert.deepEqual(postLockCoverage(receipt), { postLockPlayback: "NOT_COVERED", postLockReason: "VIDEO_LOCK_STATE_NOT_OBSERVED" });
  receipt.origin = { videoLock: "UNLOCKED" };
  receipt.renewal = { status: "PASS" };
  assert.deepEqual(postLockCoverage(receipt), { postLockPlayback: "NOT_COVERED", postLockReason: "OBSERVED_BEFORE_LOCK_REQUIRE_SIGNED_URLS_FALSE" });
  receipt.origin = { videoLock: "LOCKED" };
  assert.deepEqual(postLockCoverage(receipt), { postLockPlayback: "PASS", postLockReason: "LOCKED_VIDEO_PLAYED_PAST_FIRST_TOKEN_EXP" });
  receipt.renewal = { status: "FAIL" };
  assert.equal(postLockCoverage(receipt).postLockPlayback, "NOT_COVERED");
  assert.equal(classifyVideoLock(200), "UNLOCKED");
  assert.equal(classifyVideoLock(401), "LOCKED");
  assert.equal(classifyVideoLock(403), "LOCKED");
  assert.equal(classifyVideoLock(0), "UNKNOWN");
  assert.equal(classifyVideoLock(null), "UNKNOWN");
  assert.equal(streamTokenSubject(classifyStreamUrl(signedManifest).token), uid);
  assert.equal(streamTokenSubject("a.b"), null);
});

test("a genuine provider delivery failure blocks the verdict even when every step passed", () => {
  const receipt = createReceipt(env);
  for (const step of STEPS) setStep(receipt, step, "PASS", 1);
  receipt.viewer.providerRequestFailures = 1;
  assert.deepEqual(finalVerdict(receipt), { result: "BLOCKED", reason: "PROVIDER_STREAM_REQUESTS_FAILED" });
  receipt.viewer.providerRequestFailures = 0;
  receipt.benignPageErrors = 3;
  assert.deepEqual(finalVerdict(receipt), { result: "PASS", reason: "NONE" });
  receipt.pageErrors = 1;
  assert.deepEqual(finalVerdict(receipt), { result: "BLOCKED", reason: "PAGE_ERRORS" });
});

test("receipt lines are single-line key=value records with fixed vocabulary", () => {
  const receipt = createReceipt(env);
  receipt.recovery.push({ mode: "token_expiry", state: "playing", status: "FAIL", reasons: ["NOT_RESUMED", "NOT_ADVANCING"] });
  receipt.origin = { status: "PASS", appOrigin: 200, noOrigin: 200, foreignOrigin: 403, invalidToken: 401, invalidTokenCorsReadable: false };
  tallyStreamRequest(receipt.viewer.streamRequestPatterns, { phase: "VIEWER_START", url: `https://videodelivery.net/${uid}/video/240/seg_12.ts?p=secret`, resourceType: "xhr" }, "request");
  receipt.pageErrors = 1;
  receipt.benignPageErrors = 1;
  receipt.pageErrorDetails.push({ actor: "viewer", phase: "RECOVERY", benign: true, ...describePageError({ name: "AbortError", message: "The play() request was interrupted by a new load request.", stack: "" }) });
  const lines = formatReceiptLines(receipt).split("\n");
  assert.equal(lines.length, 11);
  assert.ok(lines.includes("stream_playback_renewal_errors=NOT_RUN"));
  assert.ok(lines.some((line) => line.startsWith("stream_playback_requests=app_uid:0 provider_uid:0 provider_failures:0 VIEWER_START/PROVIDER/UID/SEGMENT/xhr:videodelivery:/<uid>/video/<n>/seg_<n>.ts?keys=p:1(ok:0,failed:0,aborted:0,injected:0)")));
  assert.ok(lines.includes("stream_playback_errors=page:1 benign:1 viewer/RECOVERY/MEDIA_PLAY_INTERRUPTED/AbortError@NONE(benign)"));
  assert.equal(receiptLeaks(lines.join("\n")), false);
  for (const line of lines) assert.match(line, /^stream_playback_[a-z]+(?:_[a-z]+)*=\S/u);
  assert.ok(lines.some((line) => line.includes("token_expiry/playing:FAIL(NOT_RESUMED+NOT_ADVANCING)")));
  assert.ok(lines.some((line) => line === "stream_playback_origin=status:PASS app:200 none:200 foreign:403 invalid_token:401 invalid_token_cors_readable:false unsigned_uid:null video_lock:UNKNOWN"));
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
    if (url === `https://videodelivery.net/${uid}/manifest/video.m3u8`) return new Response("#EXTM3U", { status: 200 });
    if (url !== signedManifest) return new Response("", { status: 401, headers: { "access-control-allow-origin": "*" } });
    if (origin === ORIGIN) return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nx.m3u8", { status: 200 });
    if (origin) return new Response("", { status: 403 });
    return new Response("#EXTM3U", { status: 200 });
  };
  const result = await probeAllowedOrigins(signedManifest, fetchImpl);
  assert.deepEqual(result, { status: "PASS", appOrigin: 200, noOrigin: 200, foreignOrigin: 403, invalidToken: 401, invalidTokenCorsReadable: true, appManifest: true, unsignedUidManifest: 200, videoLock: "UNLOCKED" });
  assert.equal(calls.length, 5);
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

test("segment identity ignores the uid/token segment and the query", () => {
  const a = streamSegmentIdentity(`https://videodelivery.net/${uid}/video/240/seg_12.mp4?p=abc&s=def`);
  const b = streamSegmentIdentity(`${customer}/${token({ nbf, exp: nbf })}/video/240/seg_12.mp4`);
  assert.equal(a, "video/240/seg_12.mp4");
  assert.equal(a, b);
  assert.equal(streamSegmentIdentity("https://example.com/x/y"), null);
});

test("error samples keep status, media type and a redacted 80-character body; unreadable bodies are marked", () => {
  const body = `{"error":"denied ${uid} ${signedManifest} eyJhbGciOiJSUzI1NiJ9abc ${"A".repeat(40)} ok"} ${"x".repeat(200)}`;
  const sample = describeErrorSample({ status: 401, contentType: "Application/JSON; charset=utf-8", body });
  assert.equal(sample.status, 401);
  assert.equal(sample.contentType, "application/json");
  assert.ok(sample.body.length <= 80);
  for (const secret of [uid, "eyJ", "A".repeat(20), "cloudflarestream", token({ nbf, exp: nbf })]) assert.equal(sample.body.includes(secret), false, secret);
  assert.equal(receiptLeaks(JSON.stringify(sample)), false);
  assert.deepEqual(describeErrorSample({ status: 403, contentType: null, body: null }), { status: 403, contentType: "NONE", body: "UNAVAILABLE" });
  assert.equal(describeErrorSample({ status: 500, body: "" }).body, "EMPTY");
});

test("stream error diagnostics bucket by status, shape, exp offset, retry and playlist reload", () => {
  const since = 1_000_000;
  const at = (seconds) => since + seconds * 1_000;
  const seg = (name) => `video/240/${name}.mp4`;
  const entry = (seconds, status, identity, extra = {}) => ({
    atMs: at(seconds), status, kind: "SEGMENT", form: "UID", origin: "PROVIDER", identity, injected: false, ...extra,
  });
  const entries = [
    entry(-5, 401, seg("old")), // before the window: ignored
    entry(10, 200, seg("a")),
    entry(1790, 200, "video/240/stream.m3u8", { kind: "PLAYLIST" }),
    entry(1795, 401, seg("a")), // before exp (1800), retried ok below
    entry(1805, 401, seg("b")), // 0-60 s after exp, never ok
    entry(1810, 200, "video/240/stream.m3u8", { kind: "PLAYLIST", form: "TOKEN" }), // reload between
    entry(1820, 200, seg("a")),
    entry(1900, 403, seg("c")), // later than 60 s after exp, never ok
    entry(1901, 403, seg("d"), { injected: true }), // injected by the runner: excluded
  ];
  const samples = Array.from({ length: 4 }, (_, index) => ({ status: 401, contentType: "application/json", body: `denied ${index}` }));
  const result = summarizeStreamErrors(entries, { sinceMs: since, initialExpMs: at(1800), renewalMs: at(1680), samples });
  assert.equal(result.total, 3);
  assert.equal(result.injectedExcluded, 1);
  assert.deepEqual(result.byStatus, { 401: 2, 403: 1 });
  assert.deepEqual(result.byShape, { "PROVIDER/UID/SEGMENT": 3 });
  assert.equal(result.initialExpOffsetSeconds, 1800);
  assert.equal(result.renewalOffsetSeconds, 1680);
  assert.equal(result.firstErrorOffsetSeconds, 1795);
  assert.equal(result.lastErrorOffsetSeconds, 1900);
  assert.deepEqual([result.beforeInitialExp, result.afterInitialExp0To60, result.afterInitialExpLater, result.expUnknown], [1, 1, 1, 0]);
  assert.equal(result.retriedOk, 1);
  assert.equal(result.neverOk, 2);
  // First error is segment a; its first later 200 is at 1820, and a playlist loaded at 1810 in between.
  assert.equal(result.playlistReloadsBetween, 1);
  assert.equal(result.lastPlaylistBeforeFirstErrorOffsetSeconds, 1790);
  assert.equal(result.samples.length, 3);
});

test("stream error diagnostics stay valid with no errors, no exp and many statuses", () => {
  const empty = summarizeStreamErrors([], { sinceMs: 0 });
  assert.equal(empty.total, 0);
  assert.equal(empty.firstErrorOffsetSeconds, null);
  assert.equal(empty.playlistReloadsBetween, null);
  const many = Array.from({ length: 12 }, (_, index) => ({
    atMs: 10 + index, status: 400 + index, kind: "SEGMENT", form: "UID", origin: "PROVIDER", identity: null, injected: false,
  }));
  const result = summarizeStreamErrors(many, { sinceMs: 0 });
  assert.equal(Object.keys(result.byStatus).length, 9);
  assert.equal(result.byStatus.OTHER, 4);
  assert.equal(result.expUnknown, 12);
  assert.equal(result.neverOk, 12);
});

test("the renewal errors line is one grep-able key=value line and leaks nothing", () => {
  assert.equal(formatRenewalErrorsLine(undefined), "stream_playback_renewal_errors=NOT_RUN");
  const diagnostics = summarizeStreamErrors([
    { atMs: 1_100_000, status: 401, kind: "SEGMENT", form: "UID", origin: "PROVIDER", identity: "video/1/seg_1.mp4", injected: false },
    { atMs: 1_105_000, status: 200, kind: "SEGMENT", form: "UID", origin: "PROVIDER", identity: "video/1/seg_1.mp4", injected: false },
  ], {
    sinceMs: 1_000_000, initialExpMs: 1_090_000, renewalMs: 1_080_000,
    samples: [describeErrorSample({ status: 401, contentType: "application/json", body: `{"msg":"expired ${uid}"}` })],
  });
  const receipt = createReceipt(env);
  receipt.renewal = { status: "FAIL", errorDiagnostics: diagnostics };
  const line = formatReceiptLines(receipt).split("\n").find((item) => item.startsWith("stream_playback_renewal_errors="));
  assert.ok(line);
  assert.match(line, /^stream_playback_renewal_errors=total:1 injected_excluded:0 status:401:1 shapes:PROVIDER\/UID\/SEGMENT:1 initial_exp_s:90 renewal_s:80 first_s:100 last_s:100 before_exp:0 after_exp_0_60:1 after_exp_later:0 exp_unknown:0 retried_ok:1 never_ok:0 playlist_reloads_between:0 last_playlist_before_first_s:null sample_1=401\|application\/json\|/u);
  assert.equal(line.includes(uid), false);
  assert.equal(receiptLeaks(JSON.stringify(receipt)), false);
});

const firstPlaybackToken = token({ nbf, exp: nbf + 30 + 1800 });
const renewedPlaybackToken = token({ nbf: nbf + 1680, exp: nbf + 30 + 3480 });
const tokenPlaylist = (value) => `https://videodelivery.net/${value}/manifest/stream_t0a1b2c3d4e5f6a7b8c9d0.m3u8`;
const signedSegment = (n, p) => `https://videodelivery.net/${uid}/video/720/seg_${n}.mp4?p=${p}&s=sig`;
const mediaPlaylistFor = (p) => [
  "#EXTM3U", `#EXT-X-MAP:URI="/${uid}/video/720/init.mp4?p=${p}&s=sig"`,
  "#EXTINF:6.0,", `/${uid}/video/720/seg_1.mp4?p=${p}&s=sig`, "#EXTINF:6.0,", `/${uid}/video/720/seg_2.mp4?p=${p}&s=sig`, "#EXT-X-ENDLIST",
].join("\n");

test("uid-form URIs are attributed to the token their playlist was fetched with", () => {
  assert.deepEqual(playlistReferences(mediaPlaylistFor("A"), tokenPlaylist(firstPlaybackToken)), [
    `https://videodelivery.net/${uid}/video/720/init.mp4?p=A&s=sig`, signedSegment(1, "A"), signedSegment(2, "A"),
  ]);
  const attribution = createTokenAttribution();
  attribution.recordPlaylist(tokenPlaylist(firstPlaybackToken), mediaPlaylistFor("A"), 0);
  attribution.recordPlaylist(tokenPlaylist(renewedPlaybackToken), mediaPlaylistFor("B"), 1);
  assert.equal(attribution.tokenOf(signedSegment(1, "A")), 0);
  assert.equal(attribution.tokenOf(signedSegment(2, "B")), 1);
  // Same segment with a signature no recorded playlist listed: unknown.
  assert.equal(attribution.tokenOf(signedSegment(1, "C")), -1);
  // A token-form URL keeps its own token; token-form references are never attributed.
  assert.equal(attribution.tokenOf(tokenPlaylist(renewedPlaybackToken), 1), 1);
  attribution.recordPlaylist(tokenPlaylist(firstPlaybackToken), `#EXTM3U\n${tokenPlaylist(renewedPlaybackToken)}\n`, 0);
  assert.equal(attribution.tokenOf(tokenPlaylist(renewedPlaybackToken)), -1);
  // An unattributed playlist (token -1) records nothing.
  attribution.recordPlaylist(tokenPlaylist(firstPlaybackToken), mediaPlaylistFor("D"), -1);
  assert.equal(attribution.tokenOf(signedSegment(1, "D")), -1);
});

test("renewal must load a renewed-token playlist and re-signed segments before the first exp, and nothing of the first token after it", () => {
  const entry = (atMs, tokenIndex, kind, form, status = 200, injected = false) => ({ atMs, status, kind, form, token: tokenIndex, injected });
  const options = { firstIndex: 0, renewedIndex: 1, renewedAtMs: 1_680_000, initialExpMs: 1_800_000 };

  assert.deepEqual(assessNewTokenUse([
    entry(1_000_000, 0, "SEGMENT", "UID"),
    entry(1_680_500, 1, "PLAYLIST", "TOKEN"),
    entry(1_690_000, 1, "SEGMENT", "UID"),
    entry(1_850_000, 1, "SEGMENT", "UID"),
  ], options), {
    newTokenStreamRequests: 2, newTokenPlaylistRequests: 1, newTokenSegmentRequests: 1, firstTokenRequestsAfterExp: 0, reasons: [],
  });

  // Run 45713686375: the renewed token was fetched but never used; the old signatures failed after exp.
  assert.deepEqual(assessNewTokenUse([
    entry(1_000_000, 0, "SEGMENT", "UID"),
    entry(1_790_000, 0, "SEGMENT", "UID"),
    entry(1_800_600, 0, "SEGMENT", "UID", 401),
  ], options).reasons, [
    "NEW_TOKEN_PLAYLIST_NOT_LOADED_BEFORE_FIRST_EXP", "NEW_TOKEN_SEGMENTS_NOT_LOADED_BEFORE_FIRST_EXP", "FIRST_TOKEN_USED_AFTER_EXP",
  ]);

  // Before the lock Cloudflare still answers 200: a first-token request after exp fails the check anyway.
  assert.deepEqual(assessNewTokenUse([
    entry(1_680_500, 1, "PLAYLIST", "TOKEN"), entry(1_690_000, 1, "SEGMENT", "UID"), entry(1_810_000, 0, "SEGMENT", "UID"),
  ], options).reasons, ["FIRST_TOKEN_USED_AFTER_EXP"]);

  // Only inside the window, only 2xx, never the runner's own answers.
  assert.deepEqual(assessNewTokenUse([
    entry(1_679_000, 1, "PLAYLIST", "TOKEN"), entry(1_800_000, 1, "SEGMENT", "UID"),
    entry(1_700_000, 1, "SEGMENT", "UID", 403), entry(1_700_000, 1, "PLAYLIST", "TOKEN", 200, true),
    entry(1_810_000, 0, "SEGMENT", "UID", 401, true),
  ], options).reasons, ["NEW_TOKEN_PLAYLIST_NOT_LOADED_BEFORE_FIRST_EXP", "NEW_TOKEN_SEGMENTS_NOT_LOADED_BEFORE_FIRST_EXP"]);
});

test("recovery covers Cloudflare's persistent 401 next to the lifted 403 cases", () => {
  assert.deepEqual(RECOVERY_CASES.map((item) => `${item.mode}/${item.state}/${item.httpStatus ?? 403}/${item.persistent === true}`), [
    "token_expiry/playing/403/false", "token_expiry/paused/403/false",
    "token_expiry_401/playing/401/true", "token_expiry_401/paused/401/true",
    "blanket_block/playing/403/false", "blanket_block/paused/403/false",
  ]);
  const decide = (value, owner, mode = "token_expiry_401", persistent = true) => {
    const parsed = classifyStreamUrl(value);
    return shouldRefuseInRecovery({
      mode, persistent, parsed, providerUid: parsed?.form === "UID", owner, blockedToken: firstPlaybackToken, blockedIndex: 0,
    });
  };
  // Persistent 401: the expired token and what was signed for it are refused, renewed ones pass.
  assert.equal(decide(tokenPlaylist(firstPlaybackToken), 0), true);
  assert.equal(decide(signedSegment(1, "A"), 0), true);
  assert.equal(decide(signedSegment(1, "unlisted"), -1), true);
  assert.equal(decide(tokenPlaylist(renewedPlaybackToken), 1), false);
  assert.equal(decide(signedSegment(1, "B"), 1), false);
  assert.equal(decide(`https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg`, -1), false);
  // The lifted 403 keeps its worst case: every provider uid-form URI while active.
  assert.equal(decide(signedSegment(1, "B"), 1, "token_expiry", false), true);
  assert.equal(decide(tokenPlaylist(renewedPlaybackToken), 1, "token_expiry", false), false);
  assert.equal(decide(tokenPlaylist(renewedPlaybackToken), 1, "blanket_block", false), true);
});

test("the renewal line reports the renewed token's use and leaks nothing", () => {
  const receipt = createReceipt(env);
  receipt.renewal = {
    status: "PASS", observedAfterSeconds: 1679, expectedAfterSeconds: 1679, newTokenStreamRequests: 9, newTokenPlaylistRequests: 1,
    newTokenSegmentRequests: 8, firstTokenRequestsAfterExp: 0, renewedExpEqualsDeadline: true, progress: { maxStallSeconds: 0 },
  };
  const line = formatReceiptLines(receipt).split("\n").find((item) => item.startsWith("stream_playback_renewal="));
  assert.equal(line, "stream_playback_renewal=status:PASS after_s:1679 expected_s:1679 new_token_requests:9 new_token_playlists:1 new_token_segments:8 first_token_after_exp:0 renewed_exp_equals_deadline:true max_stall_s:0");
  assert.equal(receiptLeaks(JSON.stringify(receipt)), false);
});
