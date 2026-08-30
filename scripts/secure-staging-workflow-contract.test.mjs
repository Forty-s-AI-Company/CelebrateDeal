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

test("workflow exposes only the fixed WP2 task and pinned actions", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  assert.match(source, /options:\s*\n\s*- wp2-readonly-restore/u);
  assert.match(source, /npm run secure:staging:wp2/u);
  assert.match(source, /id: execute-wp2\s*\n\s*continue-on-error: true/u);
  assert.match(source, /if: \$\{\{ steps\.execute-wp2\.outcome != 'success' \}\}\s*\n\s*run: exit 2/u);
  assert.ok(source.indexOf("Validate sanitized receipt") < source.indexOf("Enforce fixed WP2 task success"));
  assert.ok(source.indexOf("Upload sanitized receipt only") < source.indexOf("Enforce fixed WP2 task success"));
  assert.doesNotMatch(source, /payuni|vercel\s+env\s+(?:pull|run)|toJSON\(secrets\)|secrets:\s*inherit/iu);
  const actionUses = [...source.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map((match) => match[1]);
  assert.equal(actionUses.length, 3);
  assert.equal(actionUses.every((value) => /@[a-f0-9]{40}$/u.test(value)), true);
});

test("secret-aware step preloads tools and installs fixed-host egress", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const runner = fs.readFileSync(path.join(root, "scripts", "secure-staging-runner.mjs"), "utf8");
  assert.match(source, /docker pull postgres:17-alpine/u);
  assert.match(source, /iptables -P OUTPUT DROP/u);
  assert.match(source, /api\.github\.com/u);
  assert.match(source, /getent ahostsv4/u);
  assert.match(source, /iptables-restore/u);
  assert.match(runner, /"--network", "host"/u);
  assert.match(runner, /\/etc\/hosts:\/etc\/hosts:ro/u);
  assert.match(runner, /"--network", "none"/u);
  assert.doesNotMatch(source, /curl\s+\$|wget\s+\$|Invoke-Expression|\beval\b/iu);
});
