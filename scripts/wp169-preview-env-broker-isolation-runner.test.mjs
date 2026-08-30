import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildBrokerArgs, inspectTempBoundary, parseBrokerOutput, TARGET_KEYS, validateReceipt } from "./wp169-preview-env-broker-isolation-runner.mjs";

const safeChild = `WP169_CHILD_RESULT:${JSON.stringify({ schema: "wp169-presence-child/v1", cwdIsExpected: true, presence: Object.fromEntries(TARGET_KEYS.map((key) => [key, true])) })}`;

test("builds exact absolute Preview broker argv", () => {
  const args = buildBrokerArgs("C:\\node.exe", "C:\\runner.mjs", "C:\\temp\\wp169");
  assert.deepEqual(args.slice(0, 7), ["env", "run", "-e", "preview", "--project", "celebrate-deal-staging", "--"]);
  assert.throws(() => buildBrokerArgs("node", "C:\\runner.mjs", "C:\\temp"));
});

test("accepts exactly one Boolean-only child result", () => {
  const parsed = parseBrokerOutput(`${safeChild}\n`, "", 0);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.childResultCount, 1);
});

test("rejects autoload, target assignment, duplicate child and nonzero exit", () => {
  assert.equal(parseBrokerOutput(safeChild, "Loaded env from C:\\x\\.env.local", 0).ok, false);
  assert.equal(parseBrokerOutput(`${safeChild}\nSTAGING_DATABASE_URL=value`, "", 0).ok, false);
  assert.equal(parseBrokerOutput(`${safeChild}\n${safeChild}`, "", 0).ok, false);
  assert.equal(parseBrokerOutput(safeChild, "", 1).ok, false);
});

test("rejects non-Boolean and missing presence keys", () => {
  const bad = `WP169_CHILD_RESULT:${JSON.stringify({ schema: "wp169-presence-child/v1", cwdIsExpected: true, presence: { STAGING_DATABASE_URL: "yes" } })}`;
  assert.equal(parseBrokerOutput(bad, "", 0).ok, false);
});

test("detects an ancestor env path without reading its contents", async () => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), "wp169-test-"));
  const child = path.join(parent, "child");
  await fsp.mkdir(child);
  await fsp.writeFile(path.join(parent, ".env.fixture"), "synthetic", "utf8");
  try {
    const boundary = await inspectTempBoundary(child);
    assert.equal(boundary.ok, false);
    assert.equal(boundary.envPathCount >= 1, true);
  } finally {
    await fsp.rm(parent, { recursive: true, force: true });
  }
});

test("success receipt requires zero side effects and complete isolation", () => {
  const receipt = {
    schemaVersion: "wp169-preview-env-broker-isolation/v1",
    status: "PREVIEW_ENV_BROKER_ISOLATION_PASS",
    temp: { outsideWorkspace: true, envPathCount: 0, cleanupPass: true },
    broker: { attempts: 1, retries: 0, exitCode: 0, autoloadDetected: false, childResultCount: 1, childValid: true },
    sideEffects: { databaseConnections: 0, databaseTransactions: 0, databaseSelects: 0, payuniQueries: 0, providerOperations: 0, deployments: 0, environmentMutations: 0, dnsMutations: 0, production: 0 },
    safety: { environmentValuesRead: false, environmentValuesPersisted: false, rawOutputPersisted: false, environmentEnumerated: false },
  };
  assert.equal(validateReceipt(receipt).ok, true);
  receipt.sideEffects.databaseConnections = 1;
  assert.equal(validateReceipt(receipt).ok, false);
});
