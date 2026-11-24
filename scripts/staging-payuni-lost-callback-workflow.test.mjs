import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const workflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/staging-payuni-lost-callback.yml", import.meta.url), "utf8"));
const job = workflow.jobs.drill;
const pay = job.steps.find((step) => step.id === "pay");
const proof = job.steps.find((step) => step.name === "Read-only proof of the posting state");
const contracts = job.steps.find((step) => step.id === "contracts");
const download = job.steps.find((step) => step.name === "Download the pay receipt of the given run");
const payReceipt = job.steps.find((step) => step.id === "pay_receipt");
const secretSteps = new Set([pay, proof]);
const index = (step) => job.steps.indexOf(step);

test("the drill runs only from protected master in the staging Preview environment with read-only permissions", () => {
  assert.match(job.if, /github\.ref == 'refs\/heads\/master' && github\.ref_protected/u);
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
  assert.deepEqual(workflow.permissions, { contents: "read", deployments: "read", actions: "read" });
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.phase.options, ["pay", "verify"]);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
});

test("secrets reach only the payment and proof steps, after install, contract tests and lineage", () => {
  for (const step of job.steps.filter((candidate) => !secretSteps.has(candidate))) {
    assert.equal(/secrets\./u.test(JSON.stringify(step)), false, step.name ?? step.run ?? step.uses);
  }
  const chromium = job.steps.find((step) => step.run === "npx playwright install --with-deps chromium");
  const lineage = job.steps.find((step) => step.name === "Verify immutable deployment lineage before secrets");
  assert.match(contracts.run, /payuni-lost-callback-drill\.test\.mjs/u);
  for (const before of [contracts, chromium, lineage]) assert.ok(index(before) < index(pay));
  assert.ok(index(pay) < index(proof));
  assert.equal(lineage.run, "node scripts/mvp-payuni-sandbox-e2e.mjs --verify-lineage");
  assert.equal(pay.if, "${{ inputs.phase == 'pay' }}");
  assert.equal(lineage.if, "${{ inputs.phase == 'pay' }}");
});

test("the payment step is Sandbox-only with both IP families restricted to the fixed hosts", () => {
  assert.equal(pay.env.PAYUNI_ENV, "sandbox");
  // The payment step needs no GitHub access: the alias is attested without the API.
  assert.equal("GITHUB_TOKEN" in pay.env, false);
  assert.equal(JSON.stringify(pay).includes("github.token"), false);
  assert.equal(Object.keys(pay.env).some((name) => /PRODUCTION|DATABASE_URL|FINANCE|REFUND/u.test(name)), false);
  const script = pay.run;
  const invocation = script.indexOf("node scripts/payuni-lost-callback-drill.mjs");
  assert.ok(invocation > 0);
  for (const command of ["sudo iptables -F OUTPUT", "sudo iptables -P OUTPUT DROP", "sudo ip6tables -F OUTPUT", "sudo ip6tables -P OUTPUT DROP"]) {
    assert.ok(script.indexOf(command) >= 0 && script.indexOf(command) < invocation, command);
  }
  assert.match(script, /trap restore_network EXIT/u);
  const hosts = [...script.matchAll(/\["([a-z0-9.-]+)", "443"\]/gu)].map((match) => match[1]);
  assert.deepEqual(hosts, ["celebrate-deal-staging.carry-digital-nomad.in.net", "sandbox-api.payuni.com.tw", "sandbox-vendor.payuni.com.tw"]);
  assert.equal(/\bnpx\b|\bnpm\b|inputs\./u.test(script), false);
});

test("the proof step's exact workflow command loads the proof and its drill imports, then refuses a missing configuration", () => {
  // 2026-11-24 run 45340752525: the command failed to load (top-level await in tsx's CommonJS
  // output) and the drill's proof never ran. Run the workflow's own command line with no CI, database
  // or PayUni environment: only a clean CONFIGURATION_REJECTED (exit 3) proves the module graph loaded.
  const [command, ...args] = proof.run.split(" ");
  assert.equal(command, "node");
  const env = {};
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  const result = spawnSync(process.execPath, args, {
    cwd: fileURLToPath(new URL("..", import.meta.url)), env, encoding: "utf8", timeout: 120_000, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.doesNotMatch(result.stderr, /Top-level await|ERR_REQUIRE_ASYNC_MODULE|TransformError|ERR_MODULE_NOT_FOUND/u);
  assert.equal(result.stdout, "payuni_lost_callback_proof=BLOCKED; reason=CONFIGURATION_REJECTED\n", result.stderr);
  assert.equal(result.status, 3);
});

test("the proof step is read-only staging DB plus Sandbox query, and receipts are the only artifacts", () => {
  assert.equal(proof.run, "node --import tsx scripts/payuni-lost-callback-proof.ts");
  assert.equal(proof.env.DATABASE_URL, "${{ secrets.STAGING_DATABASE_URL }}");
  assert.equal(proof.env.PAYUNI_ENV, "sandbox");
  assert.equal(proof.env.LOST_CALLBACK_PHASE, "${{ inputs.phase }}");
  assert.equal(Object.keys(proof.env).some((name) => /JOB_SECRET|CARD|CVV|EXPIRY|FINANCE/u.test(name)), false);
  const upload = job.steps.at(-1);
  assert.match(upload.if, /always\(\)/u);
  assert.deepEqual(upload.with.path.trim().split("\n"), [
    "${{ runner.temp }}/payuni-lost-callback/pay.json",
    "${{ runner.temp }}/payuni-lost-callback/pay-proof.json",
    "${{ runner.temp }}/payuni-lost-callback/verify-proof.json",
  ]);
  assert.equal(/\*|\.log/u.test(upload.with.path), false);
  const enforce = job.steps.find((step) => step.name === "Enforce the pay phase result");
  assert.ok(index(proof) < index(enforce) && index(enforce) < index(upload));
});

test("the proof runs only after passing contracts and, per phase, a real pay attempt or a verified pay receipt", () => {
  assert.equal(contracts.name, "Validate drill contracts before secrets");
  assert.equal(proof.if, "${{ !cancelled() && steps.contracts.outcome == 'success' && ((inputs.phase == 'verify' && steps.pay_receipt.outcome == 'success') || (inputs.phase == 'pay' && steps.pay.outcome != 'skipped')) }}");
});

test("verify requires the given pay run's PAID_CALLBACK_WITHHELD receipt for the same SHA before any secret", () => {
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs.pay_run_id).sort(), ["default", "description", "required", "type"]);
  assert.equal(download.if, "${{ inputs.phase == 'verify' }}");
  assert.match(download.uses, /^actions\/download-artifact@[0-9a-f]{40}$/u);
  assert.deepEqual(download.with, {
    name: "payuni-lost-callback-pay-${{ inputs.source_sha }}",
    "run-id": "${{ inputs.pay_run_id }}",
    "github-token": "${{ github.token }}",
    path: "${{ runner.temp }}/payuni-lost-callback-pay-input",
  });
  assert.equal(payReceipt.if, "${{ inputs.phase == 'verify' }}");
  assert.equal(payReceipt.run, "node scripts/payuni-lost-callback-drill.mjs --verify-pay-run");
  assert.deepEqual(payReceipt.env, {
    GITHUB_TOKEN: "${{ github.token }}",
    CELEBRATEDEAL_SOURCE_SHA: "${{ inputs.source_sha }}",
    PAY_RUN_ID: "${{ inputs.pay_run_id }}",
  });
  assert.ok(index(contracts) < index(download) && index(download) < index(payReceipt) && index(payReceipt) < index(proof));
  // The pay phase uploads exactly the artifact name that verify downloads.
  assert.equal(job.steps.at(-1).with.name, "payuni-lost-callback-${{ inputs.phase }}-${{ inputs.source_sha }}");
});
