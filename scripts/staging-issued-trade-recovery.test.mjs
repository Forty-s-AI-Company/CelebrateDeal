import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";
const workflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/staging-issued-trade-recovery.yml", import.meta.url), "utf8"));
const job = workflow.jobs.observation;
const execute = job.steps.find(step => step.name === "Observe failed original Sandbox trade and exact refund cleanup");
test("issued trade observation uses protected staging bindings after all installation and lineage checks", () => {
  assert.match(job.if, /github.ref == 'refs\/heads\/master' && github.ref_protected/u);
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
  assert.deepEqual(workflow.permissions, { contents: "read", deployments: "read" });
  for (const step of job.steps.filter(step => step !== execute)) assert.equal(/secrets\./u.test(JSON.stringify(step)), false);
  assert.equal(execute.env.PAYUNI_ENV, "sandbox");
  assert.equal(execute.env.PAYUNI_SANDBOX_REFUND_ENABLED, "true");
  assert.ok(job.steps.findIndex(step => step.name === "Verify immutable deployment lineage before secrets") < job.steps.indexOf(execute));
  assert.ok(job.steps.findIndex(step => step.run === "npx playwright install --with-deps chromium") < job.steps.indexOf(execute));
});
test("both IP families are restricted throughout secret-aware payment and refund execution", () => {
  const script = execute.run;
  const invocation = script.indexOf("node scripts/payuni-issued-recovery-runner.mjs");
  for (const command of ["sudo iptables -F OUTPUT", "sudo iptables -P OUTPUT DROP", "sudo ip6tables -F OUTPUT", "sudo ip6tables -P OUTPUT DROP"])
    assert.ok(script.indexOf(command) >= 0 && script.indexOf(command) < invocation);
  assert.match(script, /trap restore_network EXIT/u);
  assert.match(script, /deploymentHost, "443"/u);
  assert.match(script, /"sandbox-api.payuni.com.tw", "443"/u);
  assert.equal(/\bnpx\b|\bnpm\b/u.test(script), false);
});
test("artifact upload is limited to the closed sanitized completion file", () => {
  const upload = job.steps.at(-1);
  assert.match(upload.if, /always\(\)/u);
  assert.equal(upload.with.path, "${{ runner.temp }}/issued-recovery/completion.json");
  assert.equal(upload.with["retention-days"], 7);
  assert.equal(/\*|\.log/u.test(upload.with.path), false);
});
