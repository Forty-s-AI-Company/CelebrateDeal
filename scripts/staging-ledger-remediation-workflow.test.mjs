import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/staging-ledger-remediation.yml", import.meta.url), "utf8"));
const script = fs.readFileSync(new URL("./staging-ledger-remediation.ts", import.meta.url), "utf8");
const job = workflow.jobs.remediate;

test("remediation workflow is manual, protected-master only and least privilege", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.jobs), ["remediate"]);
  assert.equal(job.if, "${{ github.ref == 'refs/heads/master' && github.ref_protected }}");
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(job.permissions, undefined);
  assert.deepEqual(workflow.concurrency, { group: "fixed-staging-migration-apply", "cancel-in-progress": false });
});

test("mode is a choice defaulting to read-only inspect; free-text inputs reach the script only as env", () => {
  const { mode, fix_id: fixId, confirm } = workflow.on.workflow_dispatch.inputs;
  assert.equal(mode.type, "choice");
  assert.deepEqual(mode.options, ["inspect", "resolve-rolled-back", "apply-fix"]);
  assert.equal(mode.default, "inspect");
  assert.equal(fixId.type, "string");
  assert.equal(confirm.type, "string");
  for (const step of job.steps) assert.equal(/inputs\./u.test(step.run ?? ""), false, "inputs must not be interpolated into run");
  assert.match(script, /export const MODES = \["inspect", "resolve-rolled-back", "apply-fix"\] as const;/u);
  assert.match(script, /export const RESOLVE_CONFIRMATION = "resolve-20261103090200";/u);
  assert.match(script, /export const VALIDATE_MIGRATION = "20261103090200_ledger_integrity_constraints_validate";/u);
});

test("only STAGING_DATABASE_URL is used, by the remediation step, after tooling is installed", () => {
  const secretSteps = job.steps.filter((step) => /secrets\./u.test(JSON.stringify(step)));
  assert.equal(secretSteps.length, 1);
  const [step] = secretSteps;
  assert.equal(step.run, "node --import tsx scripts/staging-ledger-remediation.ts");
  assert.deepEqual([...JSON.stringify(step).matchAll(/secrets\.(\w+)/gu)].map((m) => m[1]), ["STAGING_DATABASE_URL"]);
  assert.deepEqual(Object.keys(step.env).sort(), ["LEDGER_REMEDIATION_CONFIRM", "LEDGER_REMEDIATION_FIX_ID", "LEDGER_REMEDIATION_MODE", "STAGING_DATABASE_URL"]);
  const index = job.steps.indexOf(step);
  assert.equal(index, job.steps.length - 1);
  assert.ok(job.steps.findIndex((s) => /npm ci --ignore-scripts/u.test(s.run ?? "")) < index);
  assert.ok(job.steps.findIndex((s) => /node --test .*staging-ledger-remediation-workflow\.test\.mjs/u.test(s.run ?? "")) < index);
});

test("actions are pinned to full commit SHAs and checkout keeps no credentials", () => {
  const uses = job.steps.filter((step) => step.uses);
  assert.ok(uses.length >= 2);
  for (const step of uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[0-9a-f]{40}$/u);
  const checkout = uses.find((step) => step.uses.startsWith("actions/checkout@"));
  assert.equal(checkout.with["persist-credentials"], false);
});

test("the script writes the job summary and never echoes the raw URL", () => {
  assert.match(script, /GITHUB_STEP_SUMMARY/u);
  assert.match(script, /maskCommands\(target\)/u);
  assert.equal(/console\.(?:log|error)\([^)]*(?:STAGING_DATABASE_URL|migrationUrl|clientUrl)/u.test(script), false);
});
