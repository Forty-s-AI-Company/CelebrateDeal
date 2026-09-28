import test from "node:test";
import assert from "node:assert/strict";
import { runStagingStreamResourceSmoke, validNewStreamUpload } from "./staging-stream-resource-smoke.mjs";

const uid = "a".repeat(32);
const uploadURL = `https://upload.videodelivery.net/${uid}`;
const env = { CELEBRATEDEAL_SOURCE_SHA: "b".repeat(40), CELEBRATEDEAL_DEPLOYMENT_HOST: "staging-fixture.vercel.app",
  GITHUB_TOKEN: "synthetic-github", VERCEL_TOKEN: "synthetic-vercel", JOB_SECRET: "synthetic-job-secret-only" };
const created = { ok: true, helper: "admin_ops_cloudflare_direct_upload", videoId: "synthetic_video_1",
  upload: { uid, uploadURL }, playbackUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8` };
function harness(overrides = {}) {
  const calls = [];
  const dependencies = {
    verifyLineage: async () => true, verifyAlias: async () => true, sleep: async () => {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return Response.json(created);
      if (calls.length === 2) return new Response("");
      if (calls.length === 3) return Response.json({ ok: true, video: { readyToStream: true, durationSec: 1 } });
      return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nvideo.m3u8");
    }, ...overrides,
  };
  return { calls, dependencies };
}

test("new upload URL rejects UID mismatch, host spoofing, credentials, query, redirects and encoded paths", () => {
  assert.equal(validNewStreamUpload(uploadURL, uid), true);
  for (const url of [uploadURL.replace(uid, "c".repeat(32)), `${uploadURL}?x=1`, `${uploadURL}#x`,
    uploadURL.replace("https:", "http:"), uploadURL.replace(".net/", ".net.attacker.test/"),
    uploadURL.replace("https://", "https://user:pass@"), uploadURL.replace(`/${uid}`, `/%61${uid.slice(1)}`)]) {
    assert.equal(validNewStreamUpload(url, uid), false);
  }
});

test("successful bounded journey never claims account isolation and never transmits owner auth externally", async () => {
  const { calls, dependencies } = harness();
  const receipt = await runStagingStreamResourceSmoke(env, dependencies);
  assert.equal(receipt.resourceJourney, "PASS");
  assert.equal(receipt.nonProductionScope, "UNVERIFIED");
  assert.equal(receipt.accountCredentialIsolation, "UNVERIFIED");
  assert.equal(receipt.result, "RESOURCE_JOURNEY_PASS_SCOPE_UNVERIFIED");
  assert.equal(calls.length, 4);
  const request = JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(request).sort(), ["maxDurationSeconds", "title"]);
  assert.match(request.title, /^Staging Synthetic Stream [a-f0-9-]{36}$/u);
  assert.equal(request.maxDurationSeconds, 2);
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[3].options.headers, undefined);
  assert.equal(calls[1].options.body.get("file").size, 1854);
  assert.match(calls[2].url, /videoId=synthetic_video_1$/u);
  for (const call of calls) assert.equal(call.options.redirect, "manual");
  const serialized = JSON.stringify(receipt);
  for (const secret of [env.JOB_SECRET, uid, uploadURL, created.videoId]) assert.equal(serialized.includes(secret), false);
});

test("binding failures prevent all writes", async () => {
  for (const dependenciesOverride of [{ verifyLineage: async () => false }, { verifyAlias: async () => false }]) {
    const { calls, dependencies } = harness(dependenciesOverride);
    assert.equal((await runStagingStreamResourceSmoke(env, dependencies)).result, "BLOCKED");
    assert.equal(calls.length, 0);
  }
  const { calls, dependencies } = harness();
  await runStagingStreamResourceSmoke({ ...env, CELEBRATEDEAL_BROWSER_SURFACE: "immutable_preview" }, dependencies);
  assert.equal(calls.length, 0);
});

test("ambiguous creation is never retried and never leaks exception text", async () => {
  let attempts = 0;
  const { dependencies } = harness({ fetch: async () => { attempts++; throw new Error("sensitive-provider-data"); } });
  const receipt = await runStagingStreamResourceSmoke(env, dependencies);
  assert.equal(attempts, 1);
  assert.equal(receipt.reason, "CREATE_OUTCOME_UNKNOWN");
  assert.equal(receipt.sideEffects.uploadAttempts, 0);
  assert.equal(JSON.stringify(receipt).includes("sensitive"), false);
});

test("mismatched upload capability or playback URL prevents upload", async () => {
  for (const value of [{ ...created, playbackUrl: "https://attacker.test/a" },
    { ...created, upload: { uid, uploadURL: "https://upload.videodelivery.net/" + "d".repeat(32) } }]) {
    let calls = 0;
    const { dependencies } = harness({ fetch: async () => { calls++; return Response.json(value); } });
    assert.equal((await runStagingStreamResourceSmoke(env, dependencies)).reason, "CREATE_RESPONSE_REJECTED");
    assert.equal(calls, 1);
  }
});

test("redirect during creation is rejected without forwarding authorization", async () => {
  let calls = 0;
  const { dependencies } = harness({ fetch: async () => { calls++; return new Response(null, { status: 307, headers: { location: "https://attacker.test" } }); } });
  const receipt = await runStagingStreamResourceSmoke(env, dependencies);
  assert.equal(receipt.reason, "CREATE_REJECTED");
  assert.equal(calls, 1);
});

test("ready timeout performs bounded reads of only this new resource", async () => {
  const { calls, dependencies } = harness();
  const original = dependencies.fetch;
  dependencies.fetch = async (url, options) => {
    if (calls.length < 2) return original(url, options);
    calls.push({ url, options });
    return Response.json({ ok: true, video: { readyToStream: false } });
  };
  const receipt = await runStagingStreamResourceSmoke(env, dependencies);
  assert.equal(receipt.reason, "READY_NOT_OBSERVED");
  assert.equal(receipt.sideEffects.createAttempts, 1);
  assert.equal(receipt.sideEffects.uploadAttempts, 1);
  assert.equal(receipt.sideEffects.statusReads, 36);
  assert.equal(receipt.sideEffects.playbackReads, 0);
  for (const call of calls.slice(2)) assert.match(call.url, /videoId=synthetic_video_1$/u);
});

test("ready waits for duration metadata and rejects oversized media", async () => {
  for (const duration of [1, 3]) {
    const { calls, dependencies } = harness();
    const original = dependencies.fetch;
    let reads = 0;
    dependencies.fetch = async (url, options) => {
      if (!url.includes("?videoId=")) return original(url, options);
      calls.push({ url, options });
      return Response.json({ ok: true, video: { readyToStream: true, durationSec: reads++ === 0 ? 0 : duration } });
    };
    const receipt = await runStagingStreamResourceSmoke(env, dependencies);
    assert.equal(receipt.sideEffects.statusReads, 2);
    assert.equal(receipt.ready, true);
    assert.equal(receipt.resourceJourney, duration === 1 ? "PASS" : "UNVERIFIED");
    if (duration === 3) assert.equal(receipt.reason, "DURATION_LIMIT_EXCEEDED");
  }
});

test("slow status reads stop at deadline and retain mutation counts without retry", async () => {
  let time = 0;
  const { calls, dependencies } = harness({ now: () => time, sleep: async (ms) => { time += ms; } });
  const original = dependencies.fetch;
  dependencies.fetch = async (url, options) => {
    if (calls.length < 2) return original(url, options);
    calls.push({ url, options });
    time += 14_000;
    return Response.json({ ok: true, video: { readyToStream: false } });
  };
  const receipt = await runStagingStreamResourceSmoke(env, dependencies);
  assert.equal(receipt.reason, "RESOURCE_DEADLINE_EXCEEDED");
  assert.equal(receipt.sideEffects.createAttempts, 1);
  assert.equal(receipt.sideEffects.uploadAttempts, 1);
  assert.ok(receipt.sideEffects.statusReads < 36);
  assert.equal(receipt.sideEffects.playbackReads, 0);
  assert.ok(time <= 194_000);
});
