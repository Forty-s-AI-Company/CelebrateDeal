import assert from "node:assert/strict";
import test from "node:test";

import { WP176, classifyLineage, initialReceipt, inspectCliSource, runWp176, sha256, validateReceipt } from "./wp176-preview-sensitive-env-lineage-diagnostic.mjs";

const wp173 = {
  terminalStatus: "WP173_PREVIEW_PAYUNI_ENV_REDEPLOY_ALIAS_VERIFIED",
  previewBinding: { variableName: "PAYUNI_ENV", target: "preview", type: "sensitive", bindingCountAfter: 1, valueRead: false },
};

const wp174 = {
  broker: { childValid: true, parentTargetKeyPresenceCount: 0, autoloadDetected: false, targetAssignmentDetected: false },
  primaryOutcome: {
    failure: "PAYUNI_NOT_SANDBOX",
    database: { connectionAttempts: 0, applicationSelects: 0 },
    payuni: { queryAttempts: 0 },
  },
};

const cliSource = `
  const records = await pullEnvRecords(client, link.project.id, "vercel-cli:env:run");
  const env = { ...records.env, ...localEnv, ...process.env };
  const row = { value: env.type === "plain" ? env.value : void 0 };
`;
const cliPackage = JSON.stringify({ version: "58.4.4" });

test("confirms the complete sensitive-env lineage without external observation", async () => {
  const receipt = await runWp176({ wp173, wp174, cliSource, cliPackage });
  assert.equal(receipt.status, WP176.confirmed);
  assert.equal(receipt.observation.attempts, 0);
  assert.equal(receipt.lineage.rootCause, "PAYUNI_ENV_SENSITIVE_TYPE_INCOMPATIBLE_WITH_LOCAL_ENV_RUN");
  assert.deepEqual(validateReceipt(receipt), { ok: true, errors: [] });
});

test("fails closed when the current accepted binding is not sensitive", async () => {
  const receipt = await runWp176({ wp173: { ...wp173, previewBinding: { ...wp173.previewBinding, type: "plain" } }, wp174, cliSource, cliPackage });
  assert.equal(receipt.status, WP176.noGo);
  assert.equal(receipt.scoreImpact.applied, false);
});

test("fails closed when the runtime mismatch evidence is incomplete", async () => {
  const receipt = await runWp176({ wp173, wp174: { ...wp174, primaryOutcome: { ...wp174.primaryOutcome, failure: "OTHER" } }, cliSource, cliPackage });
  assert.equal(receipt.status, WP176.noGo);
});

test("pins CLI version, pull path, overlay order, and unsafe JSON-list behavior", () => {
  const result = inspectCliSource(cliSource, cliPackage);
  assert.equal(result.ok, true);
  assert.match(result.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(inspectCliSource(cliSource, JSON.stringify({ version: "59.0.0" })).ok, false);
  assert.equal(inspectCliSource("const records = {};", cliPackage).ok, false);
});

test("classification requires official rule and every accepted evidence link", () => {
  const cli = inspectCliSource(cliSource, cliPackage);
  const positive = classifyLineage({ wp173, wp174, cli, officialRule: { sensitiveValuesUnreadable: true, decryptionAvailableDuringBuild: true, localEnvRunIsBuild: false } });
  assert.equal(positive.confirmed, true);
  const negative = classifyLineage({ wp173, wp174, cli, officialRule: { sensitiveValuesUnreadable: true, decryptionAvailableDuringBuild: false, localEnvRunIsBuild: false } });
  assert.equal(negative.confirmed, false);
});

test("receipt validator rejects observation, side-effect, score, and readiness drift", () => {
  const base = initialReceipt();
  base.canonicalDigest = sha256("fixture");
  for (const mutate of [
    (x) => { x.observation.attempts = 1; x.observation.executed = true; },
    (x) => { x.sideEffects.databaseOperations = 1; },
    (x) => { x.scoreImpact.CAT04.after = 7.5; },
    (x) => { x.gateImpact.SANDBOX_READY = true; },
  ]) {
    const candidate = structuredClone(base);
    mutate(candidate);
    assert.equal(validateReceipt(candidate).ok, false);
  }
});

test("receipt validator rejects sensitive-looking persisted fields", () => {
  const receipt = initialReceipt();
  receipt.canonicalDigest = sha256("fixture");
  receipt.evidence.value = "should-never-persist";
  assert.equal(validateReceipt(receipt).ok, false);
});
