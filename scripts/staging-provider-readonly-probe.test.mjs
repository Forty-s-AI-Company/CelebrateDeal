import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runStagingProviderProbe } from "./staging-provider-readonly-probe.mjs";

const env = {
  CELEBRATEDEAL_SOURCE_SHA: "a".repeat(40),
  CELEBRATEDEAL_DEPLOYMENT_HOST: "celebrate-deal-staging-preview.vercel.app",
  JOB_SECRET: "synthetic-job-secret",
};
const configured = {
  r2: { configured: { accountId: true, accessKeyId: true, secretAccessKey: true, bucket: true, publicBaseUrl: true }, resourceDigest: "must not be retained" },
  stream: { configured: { accountId: true, token: true, webhookSecret: true }, resourceDigest: "must not be retained" },
};

test("protected workflow checks Preview lineage before injecting JOB_SECRET", () => {
  const workflow = readFileSync(new URL("../.github/workflows/staging-provider-readonly-probe.yml", import.meta.url), "utf8");
  assert.match(workflow, /github\.ref_protected/u);
  assert.ok(workflow.indexOf("Verify exact Preview lineage before secret injection") < workflow.indexOf("Probe deployed Preview providers read only"));
  assert.match(workflow, /JOB_SECRET: \$\{\{ secrets\.JOB_SECRET \}\}/u);
});

test("actual Preview response is reduced to bounded reachability without scope PASS", async () => {
  let requested;
  const fetchImpl = async (url, options) => {
    requested = { url, options };
    return { status: 200, headers: new Headers(), json: async () => ({
      evidence: "provider_read_only_probe", providerProbe: "completed", nonProductionScope: "unverified",
      probe: { r2: "ok", stream: "ok" }, ...configured,
    }) };
  };
  const receipt = await runStagingProviderProbe(env, fetchImpl);
  assert.equal(receipt.status, "REACHABLE_SCOPE_UNVERIFIED");
  assert.equal(receipt.nonProductionScope, "unverified");
  assert.deepEqual(receipt.r2Configured, configured.r2.configured);
  assert.deepEqual(receipt.streamConfigured, configured.stream.configured);
  assert.equal(JSON.stringify(receipt).includes("resourceDigest"), false);
  assert.equal(JSON.stringify(receipt).includes(env.JOB_SECRET), false);
  assert.equal(requested.url, `https://${env.CELEBRATEDEAL_DEPLOYMENT_HOST}/api/admin/ops/provider-runtime?probe=read-only`);
  assert.equal(requested.options.method, "GET");
  assert.equal(requested.options.redirect, "manual");
});

test("missing binding, mismatched response, and provider denial cannot pass", async () => {
  let calls = 0;
  const response = (body) => ({ status: 200, headers: new Headers(), json: async () => body });
  const fetchImpl = async () => { calls += 1; return response({ evidence: "provider_read_only_probe",
    providerProbe: "completed", nonProductionScope: "unverified", probe: { r2: "ok", stream: "forbidden" }, ...configured }); };
  assert.equal((await runStagingProviderProbe({ ...env, JOB_SECRET: "" }, fetchImpl)).status, "BLOCKED");
  assert.equal(calls, 0);
  assert.equal((await runStagingProviderProbe(env, fetchImpl)).reason, "PROVIDER_NOT_REACHABLE");
  assert.equal((await runStagingProviderProbe(env, async () => response({ evidence: "provider_read_only_probe",
    providerProbe: "completed", nonProductionScope: "verified", probe: { r2: "ok", stream: "ok" }, ...configured }))).reason, "RESPONSE_REJECTED");
  assert.equal((await runStagingProviderProbe(env, async () => response({ evidence: "provider_read_only_probe",
    providerProbe: "completed", nonProductionScope: "unverified", probe: { r2: "ok", stream: "ok" },
    ...configured, r2: { configured: { ...configured.r2.configured, secretAccessKey: "unknown" } } }))).reason, "RESPONSE_REJECTED");
});

test("blocked R2 probe preserves only fixed presence booleans", async () => {
  const body = { evidence: "provider_read_only_probe", providerProbe: "completed", nonProductionScope: "unverified",
    probe: { r2: "not_configured", stream: "ok" }, ...configured,
    r2: { configured: { ...configured.r2.configured, secretAccessKey: false }, resourceDigest: "private-digest" } };
  const receipt = await runStagingProviderProbe(env, async () => ({
    status: 200, headers: new Headers(), json: async () => body,
  }));
  assert.equal(receipt.status, "BLOCKED");
  assert.equal(receipt.r2Configured.secretAccessKey, false);
  assert.equal(JSON.stringify(receipt).includes("private-digest"), false);
});
