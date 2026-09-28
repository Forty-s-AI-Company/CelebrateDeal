import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validateBrowserSmokeBinding, verifyStagingAliasBinding } from "./staging-browser-smoke.mjs";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";

const ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const ENDPOINT = `${ORIGIN}/api/admin/ops/cloudflare/direct-upload`;
const UID = /^[a-f0-9]{32}$/u;
const VIDEO_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const FIXTURE_HASH = "e1a9583558dff635ef945db4c2d1dd03e443bbef651a929a96f8491f9d8beb42";

/** Only accept the new provider UID's upload capability, never an arbitrary host/path. */
export function validNewStreamUpload(value, uid) {
  try {
    const url = new URL(value);
    return UID.test(uid) && url.protocol === "https:" && !url.username && !url.password
      && !url.port && !url.hash && !url.search
      && ["upload.videodelivery.net", "upload.cloudflarestream.com"].includes(url.hostname)
      && url.pathname === `/${uid}`;
  } catch { return false; }
}

/** All provider bodies/capability URLs remain in memory; receipt contains fixed categories only. */
export async function runStagingStreamResourceSmoke(env = process.env, dependencies = {}) {
  const receipt = {
    schemaVersion: "celebratedeal-staging-stream-resource/v1",
    sourceSha: /^[a-f0-9]{40}$/u.test(env.CELEBRATEDEAL_SOURCE_SHA ?? "") ? env.CELEBRATEDEAL_SOURCE_SHA : null,
    result: "BLOCKED", reason: "INVALID_BINDING", lineage: "UNVERIFIED", aliasBinding: "UNVERIFIED",
    resourceJourney: "UNVERIFIED", operationScope: "NEW_RESOURCE_ONLY",
    accountCredentialIsolation: "UNVERIFIED", nonProductionScope: "UNVERIFIED",
    fixtureSha256: FIXTURE_HASH, resourceReceiptDigest: null,
    ready: false, durationWithinFixtureLimit: false, playbackManifest: false,
    sideEffects: { createAttempts: 0, uploadAttempts: 0, statusReads: 0, playbackReads: 0,
      existingResourceReads: 0, replacements: 0, liveInputs: 0, deletes: 0, payments: 0, refunds: 0 },
  };
  if (!validateBrowserSmokeBinding(env) || (env.CELEBRATEDEAL_BROWSER_SURFACE ?? "fixed_alias") !== "fixed_alias") return receipt;
  const fetchImpl = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  let deadline = Infinity;
  const request = (url, options = {}) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("deadline");
    return fetchImpl(url, {
      ...options, redirect: "manual", signal: AbortSignal.timeout(Math.min(15_000, remaining)),
    });
  };
  const authHeaders = { Authorization: `Bearer ${env.JOB_SECRET}`, "Content-Type": "application/json",
    "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA };
  try {
    const fixture = await readFile(new URL("./fixtures/staging-stream-one-second.mp4", import.meta.url));
    if (fixture.length !== 1854 || createHash("sha256").update(fixture).digest("hex") !== FIXTURE_HASH) {
      receipt.reason = "FIXTURE_REJECTED"; return receipt;
    }
    if (!await (dependencies.verifyLineage ?? verifyMvpPayUniLineage)(env)) {
      receipt.reason = "LINEAGE_REJECTED"; return receipt;
    }
    receipt.lineage = "VERIFIED";
    if (!await (dependencies.verifyAlias ?? verifyStagingAliasBinding)(env)) {
      receipt.reason = "ALIAS_REJECTED"; return receipt;
    }
    receipt.aliasBinding = "VERIFIED";
    // Bound the side-effect phase and reserve workflow time for the sanitized receipt.
    deadline = now() + 180_000;
    // Omit vendorId to use Preview's server-owned fixture; never accept an existing videoId.
    const title = `Staging Synthetic Stream ${randomUUID()}`;
    receipt.reason = "CREATE_OUTCOME_UNKNOWN";
    receipt.sideEffects.createAttempts++;
    const created = await request(ENDPOINT, { method: "POST", headers: authHeaders,
      body: JSON.stringify({ title, maxDurationSeconds: 2 }) });
    if (created.status !== 200) { await created.body?.cancel(); receipt.reason = "CREATE_REJECTED"; return receipt; }
    const body = await created.json();
    const uid = body?.upload?.uid;
    if (body?.ok !== true || body.helper !== "admin_ops_cloudflare_direct_upload"
      || !VIDEO_ID.test(body.videoId ?? "") || !validNewStreamUpload(body?.upload?.uploadURL, uid)
      || body.playbackUrl !== `https://videodelivery.net/${uid}/manifest/video.m3u8`) {
      receipt.reason = "CREATE_RESPONSE_REJECTED"; return receipt;
    }
    receipt.resourceReceiptDigest = createHash("sha256").update(`${body.videoId}:${uid}:${title}`).digest("hex");
    const form = new FormData();
    form.set("file", new Blob([fixture], { type: "video/mp4" }), `${title.replaceAll(" ", "-")}.mp4`);
    receipt.reason = "UPLOAD_OUTCOME_UNKNOWN";
    receipt.sideEffects.uploadAttempts++;
    // The owner credential is never sent to Cloudflare's upload host.
    const uploaded = await request(body.upload.uploadURL, { method: "POST", body: form });
    await uploaded.body?.cancel();
    if (!uploaded.ok) { receipt.reason = "UPLOAD_REJECTED"; return receipt; }
    receipt.reason = "READY_NOT_OBSERVED";
    for (let attempt = 0; attempt < 36; attempt++) {
      if (now() >= deadline) { receipt.reason = "RESOURCE_DEADLINE_EXCEEDED"; return receipt; }
      receipt.sideEffects.statusReads++;
      const status = await request(`${ENDPOINT}?videoId=${encodeURIComponent(body.videoId)}`, { headers: authHeaders });
      if (status.status !== 200) { await status.body?.cancel(); receipt.reason = "STATUS_REJECTED"; return receipt; }
      const state = await status.json();
      if (state?.ok !== true) { receipt.reason = "STATUS_REJECTED"; return receipt; }
      if (state.video?.readyToStream === true) {
        receipt.ready = true;
        if (Number.isFinite(state.video.durationSec) && state.video.durationSec > 2) {
          receipt.reason = "DURATION_LIMIT_EXCEEDED"; return receipt;
        }
        receipt.reason = "DURATION_NOT_OBSERVED";
        receipt.durationWithinFixtureLimit = Number.isFinite(state.video.durationSec)
          && state.video.durationSec > 0 && state.video.durationSec <= 2;
        if (receipt.durationWithinFixtureLimit) break;
      }
      await sleep(Math.max(0, Math.min(5000, deadline - now())));
    }
    if (!receipt.ready || !receipt.durationWithinFixtureLimit) return receipt;
    receipt.reason = "PLAYBACK_OUTCOME_UNKNOWN";
    receipt.sideEffects.playbackReads++;
    const playback = await request(body.playbackUrl);
    if (playback.status !== 200) { await playback.body?.cancel(); receipt.reason = "PLAYBACK_REJECTED"; return receipt; }
    const manifest = await playback.text();
    receipt.playbackManifest = manifest.length < 100_000 && manifest.startsWith("#EXTM3U")
      && manifest.includes("#EXT-X-STREAM-INF");
    if (!receipt.playbackManifest) { receipt.reason = "PLAYBACK_REJECTED"; return receipt; }
    receipt.resourceJourney = "PASS";
    // A successful new resource is not evidence that an account-wide token cannot access Production.
    receipt.result = "RESOURCE_JOURNEY_PASS_SCOPE_UNVERIFIED";
    receipt.reason = "ACCOUNT_CREDENTIAL_ISOLATION_UNVERIFIED";
  } catch {
    if (now() >= deadline) receipt.reason = "RESOURCE_DEADLINE_EXCEEDED";
    // Keep the last phase's outcome unknown; never retry create/upload after an ambiguous response.
  }
  return receipt;
}

async function main() {
  const receipt = await runStagingStreamResourceSmoke();
  const text = `${JSON.stringify(receipt)}\n`;
  if (process.env.RUNNER_TEMP) await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-stream-resource.json`, text, { mode: 0o600 });
  process.stdout.write(text);
  process.exitCode = receipt.resourceJourney === "PASS" ? 0 : 2;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
