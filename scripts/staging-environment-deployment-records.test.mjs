import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// Every successful Actions job that records a deployment in the staging environment makes GitHub
// mark the Vercel record for the same environment `inactive`, which used to break the lineage gate
// (secure-staging-runner verifyDeployment) for every later runner until the next Vercel deploy.
// Only Vercel deploys to this environment; Actions jobs use it for its secrets and branch policy.
const STAGING_ENVIRONMENT = "Preview – celebrate-deal-staging";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDirectory = path.join(root, ".github", "workflows");

function workflowJobs() {
  return fs.readdirSync(workflowsDirectory)
    .filter((name) => /\.ya?ml$/u.test(name))
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(workflowsDirectory, name), "utf8");
      const workflow = yaml.load(source);
      return Object.entries(workflow?.jobs ?? {}).map(([id, job]) => ({ name, id, job }));
    });
}

const environmentName = (environment) => (typeof environment === "string" ? environment : environment?.name);

test("no Actions job records a deployment in the staging Preview environment", () => {
  const stagingJobs = workflowJobs().filter(({ job }) => typeof environmentName(job?.environment) === "string"
    && environmentName(job.environment).toLowerCase().includes("celebrate-deal-staging"));
  // GitHub matches environment names case-insensitively, so the scan does too.
  // 33 jobs across 32 workflows on 2026-11-25; a drop to zero would mean the scan itself broke.
  assert.ok(stagingJobs.length >= 33, `found ${stagingJobs.length} staging jobs`);
  for (const { name, id, job } of stagingJobs) {
    assert.deepEqual(job.environment, { name: STAGING_ENVIRONMENT, deployment: false }, `${name}#${id}`);
  }
});

test("no job names its environment in a form the scan above could miss", () => {
  for (const { name, id, job } of workflowJobs()) {
    if (job?.environment === undefined) continue;
    const environment = job.environment;
    // An expression could resolve to the staging environment and record deployments unseen.
    assert.ok(typeof environment === "string" || (typeof environment === "object" && environment !== null), `${name}#${id}`);
    assert.doesNotMatch(String(environmentName(environment)), /\$\{\{/u, `${name}#${id}`);
    if (typeof environment === "object") assert.doesNotMatch(String(environment.deployment), /\$\{\{/u, `${name}#${id}`);
  }
});
