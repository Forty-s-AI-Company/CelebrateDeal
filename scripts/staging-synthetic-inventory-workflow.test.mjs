import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/staging-synthetic-inventory.yml", import.meta.url), "utf8"));
const job = workflow.jobs.inventory;

test("inventory workflow is manual, protected-master only and least privilege", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.match(job.if, /github.ref == 'refs\/heads\/master' && github.ref_protected/u);
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
  assert.deepEqual(workflow.permissions, { contents: "read" });
});

test("only STAGING_DATABASE_URL is used, and only by the read-only script step", () => {
  const secretSteps = job.steps.filter((step) => /secrets\./u.test(JSON.stringify(step)));
  assert.equal(secretSteps.length, 1);
  assert.match(secretSteps[0].run, /staging-synthetic-inventory\.ts/u);
  assert.deepEqual([...JSON.stringify(secretSteps[0]).matchAll(/secrets\.(\w+)/gu)].map((m) => m[1]), ["STAGING_DATABASE_URL"]);
  assert.equal(/npm |npx /u.test(secretSteps[0].run), false);
  assert.ok(job.steps.findIndex((s) => /npm ci/u.test(s.run ?? "")) < job.steps.indexOf(secretSteps[0]));
});

test("actions are pinned to SHAs and the artifact is kept 14 days", () => {
  for (const step of job.steps.filter((s) => s.uses)) assert.match(step.uses, /@[0-9a-f]{40}$/u);
  const upload = job.steps.find((s) => /upload-artifact/u.test(s.uses ?? ""));
  assert.equal(upload.with["retention-days"], 14);
  assert.equal(job.steps.some((s) => /GITHUB_STEP_SUMMARY/u.test(s.run ?? "")), true);
});
