import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github", "workflows", "secure-staging-validation.yml");

test("master cannot trigger an automatic Vercel deployment", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.equal(config.git?.deploymentEnabled?.master, false);
});

test("secure staging workflow is valid YAML and protected-default-branch only", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  const job = workflow.jobs["trusted-runner"];
  assert.match(String(job.if), /refs\/heads\/master/u);
  assert.match(String(job.if), /github\.ref_protected/u);
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
  assert.deepEqual(workflow.permissions, { contents: "read", deployments: "read" });
});

test("workflow exposes only the fixed WP2 and WP4 tasks with pinned actions", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.task.options, [
    "wp2-readonly-restore",
    "wp4-payuni-sandbox-reconciliation",
  ]);
  assert.match(source, /npm run secure:staging:wp2/u);
  assert.match(source, /npm run secure:staging:wp4/u);
  assert.match(source, /id: execute-wp2\s*\n\s*continue-on-error: true/u);
  assert.match(source, /id: execute-wp4\s*\n\s*continue-on-error: true/u);
  assert.match(source, /steps\.execute-wp2\.outcome != 'success'/u);
  assert.match(source, /steps\.execute-wp4\.outcome != 'success'/u);
  assert.ok(source.indexOf("Validate sanitized WP2 receipt") < source.indexOf("Enforce fixed WP2 task success"));
  assert.ok(source.indexOf("Validate sanitized WP4 receipt") < source.indexOf("Enforce fixed WP4 task success"));
  assert.ok(source.indexOf("Upload sanitized receipt only") < source.indexOf("Enforce fixed WP2 task success"));
  assert.doesNotMatch(source, /vercel\s+env\s+(?:pull|run)|toJSON\(secrets\)|secrets:\s*inherit|workflow_call|pull_request_target/iu);
  assert.doesNotMatch(source, /PAYUNI_(?:API|BASE|PRODUCTION)_URL|(?<!sandbox-)api\.payuni\.com\.tw/iu);
  const actionUses = [...source.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map((match) => match[1]);
  assert.equal(actionUses.length, 3);
  assert.equal(actionUses.every((value) => /@[a-f0-9]{40}$/u.test(value)), true);
});

test("secret-aware step preloads tools and installs fixed-host egress", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const runner = fs.readFileSync(path.join(root, "scripts", "secure-staging-runner.mjs"), "utf8");
  const wp4Runner = fs.readFileSync(path.join(root, "scripts", "secure-staging-wp4-payuni.mjs"), "utf8");
  assert.match(source, /docker pull postgres:17-alpine/u);
  assert.match(source, /npx playwright install --with-deps chromium/u);
  assert.equal((source.match(/iptables -P OUTPUT DROP/gu) ?? []).length, 2);
  assert.match(source, /api\.github\.com/u);
  assert.equal((source.match(/sandbox-api\.payuni\.com\.tw/gu) ?? []).length, 1);
  assert.match(source, /getent ahostsv4/u);
  assert.match(source, /iptables-restore/u);
  assert.match(runner, /"--network", "host"/u);
  assert.match(runner, /\/etc\/hosts:\/etc\/hosts:ro/u);
  assert.match(runner, /"--network", "none"/u);
  assert.match(wp4Runner, /function childEnvironment/u);
  assert.match(wp4Runner, /spawnSyncImpl\(process\.execPath/u);
  assert.doesNotMatch(wp4Runner, /Object\.(?:keys|entries)\(process\.env\)/u);
  assert.doesNotMatch(source, /curl\s+\$|wget\s+\$|Invoke-Expression|\beval\b/iu);
});

test("required PostgreSQL concurrency gate fails closed instead of hanging indefinitely", () => {
  const source = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(
    source,
    /timeout --preserve-status 10m npm run test:db:concurrency/u,
  );
  assert.doesNotMatch(source, /test:db:concurrency[^\n]*(?:--exclude|--skip|--passWithNoTests)/u);
});

test("WP4 is protected-master only, Sandbox fixed-host only, and cannot execute arbitrary commands", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  const steps = workflow.jobs["trusted-runner"].steps;
  const dispatchPreflight = steps.find((step) => step.name === "Validate fixed WP4 dispatch identity before secret injection");
  const wp4 = steps.find((step) => step.id === "execute-wp4");
  assert.match(String(dispatchPreflight.if), /inputs\.task == 'wp4-payuni-sandbox-reconciliation'/u);
  assert.deepEqual(Object.keys(dispatchPreflight.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA"]);
  assert.equal(dispatchPreflight.env.CELEBRATEDEAL_SOURCE_SHA, "${{ inputs.source_sha }}");
  assert.equal(dispatchPreflight.env.CELEBRATEDEAL_DEPLOYMENT_HOST, "${{ inputs.deployment_host }}");
  assert.match(dispatchPreflight.run, /const safeSha = \/\^\[a-f0-9\]\{40\}\$\/u;/u);
  assert.doesNotMatch(dispatchPreflight.run, /secrets\.|\$\{\{\s*inputs\./u);
  assert.ok(source.indexOf(dispatchPreflight.name) < source.indexOf("Execute fixed WP4 PayUni Sandbox task with bounded egress"));
  assert.match(String(wp4.if), /inputs\.task == 'wp4-payuni-sandbox-reconciliation'/u);
  assert.deepEqual(Object.keys(wp4.env).sort(), [
    "CELEBRATEDEAL_DEPLOYMENT_HOST",
    "CELEBRATEDEAL_SOURCE_SHA",
    "GITHUB_TOKEN",
    "JOB_SECRET",
    "PAYUNI_SANDBOX_ONETIME_CARD_NO",
    "PAYUNI_TEST_CVV",
    "PAYUNI_TEST_EXPIRY",
  ]);
  assert.equal(wp4.env.JOB_SECRET, "${{ secrets.JOB_SECRET }}");
  assert.equal(wp4.env.PAYUNI_SANDBOX_ONETIME_CARD_NO, "${{ secrets.PAYUNI_SANDBOX_ONETIME_CARD_NO }}");
  assert.equal(wp4.run.includes("sandbox-api.payuni.com.tw"), true);
  assert.doesNotMatch(JSON.stringify(wp4.env), /STAGING_DATABASE_URL|PAYUNI_(?:MERCHANT|HASH)/u);
  assert.equal(wp4.run.includes("npm run secure:staging:wp4"), true);
  assert.doesNotMatch(wp4.run, /\$\{\{\s*inputs\.(?:command|script|args)/u);
});
