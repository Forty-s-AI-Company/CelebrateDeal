import test from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_ENV_NAMES,
  buildChildEnvironment,
  buildPreviewDeployArgs,
  buildReceipt,
} from "./fin08ab-preview-source-lineage-deploy.mjs";

test("Preview deploy args cannot promote, mutate env, or mutate aliases", () => {
  const args = buildPreviewDeployArgs();
  assert.deepEqual(args, ["deploy", "--yes", "--skip-domain", "--no-color"]);
  assert.equal(args.includes("--prod"), false);
  assert.equal(args.some((arg) => arg.startsWith("--env")), false);
  assert.equal(args.includes("promote"), false);
});

test("child environment is an explicit system allowlist", () => {
  const env = buildChildEnvironment({ PATH: "p", USERPROFILE: "u", DATABASE_URL: "secret", VERCEL_TOKEN: "token" });
  assert.deepEqual(Object.keys(env).sort(), ["CI", "PATH", "USERPROFILE"]);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.VERCEL_TOKEN, undefined);
  assert.deepEqual(SAFE_ENV_NAMES.includes("DATABASE_URL"), false);
});

test("receipt never persists URL, deployment id, output, or side effects", () => {
  const receipt = buildReceipt({ status: 0 }, { cliPresent: true, projectLinked: true });
  assert.equal(receipt.status, "FIN08AB_PREVIEW_DEPLOY_PASS");
  assert.equal(receipt.stdoutPersisted, false);
  assert.equal(receipt.stderrPersisted, false);
  assert.equal(receipt.urlPersisted, false);
  assert.equal(receipt.deploymentIdPersisted, false);
  assert.equal(receipt.production, false);
  assert.equal(receipt.environmentMutation, false);
  assert.equal(receipt.aliasMutation, false);
  assert.equal(receipt.databaseOperations, 0);
  assert.equal(receipt.payuniOperations, 0);
});
