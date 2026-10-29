import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (...segments) => yaml.load(fs.readFileSync(path.join(root, ...segments), "utf8"));
const workflow = load(".github", "workflows", "ci.yml");
const setupAction = load(".github", "actions", "ci-setup", "action.yml");
const playwrightAction = load(".github", "actions", "playwright-chromium", "action.yml");

const setupUses = "./.github/actions/ci-setup";
const playwrightUses = "./.github/actions/playwright-chromium";
const gateJobs = Object.entries(workflow.jobs).filter(([id]) => id !== "quality");

// Every gate the former single `quality` job ran. Each must still run exactly
// once in the parallel workflow; removing one has to change this list.
const requiredGateSteps = [
  "Production dependency audit",
  "Repository secret and archive scan",
  "Migration name order",
  "Prisma schema drift against migrations",
  "Lint",
  "Typecheck",
  "Affiliate portal database boundaries",
  "Native course database boundaries",
  "Course community database boundaries",
  "PayUni deployment environment binding contract",
  "Strict production index access",
  "Release readiness contract",
  "Readiness truth reconciliation",
  "Staging migration evidence contract",
  "Staging migration receipt validation contract",
  "Staging release evidence aggregation contract",
  "Staging release evidence receipt validation contract",
  "Human owner acceptance evidence contract",
  "Release evidence bundle contract",
  "Current release handoff evidence consistency",
  "External smoke output safety contract",
  "External provider evidence contract",
  "Bounded staging Stream resource contract",
  "Backup tooling static checks",
  "Unit tests and coverage thresholds",
  "LINE integration contract",
  "Node TAP contract tests",
  "PostgreSQL concurrency tests",
  "Learner notification database boundaries",
  "Tracking authoritative events database and browser gate",
  "Q1 original refund proof database isolation",
  "Q1 original refund reservation database isolation",
  "Referral sharing database and browser gate",
  "Funnel development harness browser gate",
  "Subscription recovery database and browser gate",
  "Release browser gates",
  "Build",
  "Controlled production preflight and build",
  "Preflight",
];
const browserGateSteps = [
  "Tracking authoritative events database and browser gate",
  "Referral sharing database and browser gate",
  "Funnel development harness browser gate",
  "Subscription recovery database and browser gate",
  "Release browser gates",
];

test("CI runs for master pushes, pull requests and the merge queue", () => {
  assert.deepEqual(workflow.on.push.branches, ["master"]);
  assert.ok("pull_request" in workflow.on);
  assert.deepEqual(workflow.on.merge_group.types, ["checks_requested"]);
});

test("only pull request runs cancel superseded runs; master and queue entries keep per-SHA groups", () => {
  assert.equal(workflow.concurrency["cancel-in-progress"], "${{ github.event_name == 'pull_request' }}");
  assert.match(workflow.concurrency.group, /github\.ref == 'refs\/heads\/master'/u);
  assert.match(workflow.concurrency.group, /github\.event_name == 'merge_group'/u);
  assert.match(workflow.concurrency.group, /format\('-\{0\}', github\.sha\)/u);
});

test("required `quality` check aggregates every parallel job and fails unless all succeeded", () => {
  const quality = workflow.jobs.quality;
  assert.equal(quality.name, "quality");
  assert.equal(quality.if, "always()");
  assert.deepEqual([...quality.needs].sort(), gateJobs.map(([id]) => id).sort());
  assert.ok(gateJobs.length >= 2);
  const [check] = quality.steps;
  assert.equal(quality.steps.length, 1);
  assert.equal(check.env.NEEDS_JSON, "${{ toJSON(needs) }}");
  assert.match(check.run, /set -euo pipefail/u);
  assert.ok(check.run.includes(`jq -e 'length == ${gateJobs.length} and all(.[]; .result == "success")'`));
  // No other job may claim the required check name.
  for (const [, job] of gateJobs) assert.notEqual(job.name, "quality");
});

test("every gate runs exactly once, on a free hosted runner, after the shared setup", () => {
  const seen = new Map();
  for (const [id, job] of gateJobs) {
    assert.equal(job["runs-on"], "ubuntu-latest", id);
    assert.ok(job["timeout-minutes"] <= 60, id);
    const steps = job.steps;
    const setupIndex = steps.findIndex((step) => step.uses === setupUses);
    assert.equal(steps.filter((step) => step.uses === setupUses).length, 1, id);
    assert.equal(steps[0].name, "Checkout", id);
    assert.equal(steps[0].with["fetch-depth"], 0, id);
    steps.forEach((step, index) => {
      if (!requiredGateSteps.includes(step.name)) return;
      assert.ok(index > setupIndex, `${id}: ${step.name}`);
      seen.set(step.name, (seen.get(step.name) ?? 0) + 1);
      if (browserGateSteps.includes(step.name)) {
        const playwrightIndex = steps.findIndex((candidate) => candidate.uses === playwrightUses);
        assert.ok(playwrightIndex > setupIndex && playwrightIndex < index, `${id}: ${step.name}`);
      }
    });
  }
  for (const name of requiredGateSteps) assert.equal(seen.get(name), 1, name);
});

test("ordering dependencies stay inside one job", () => {
  const jobOf = (name) => gateJobs.find(([, job]) => job.steps.some((step) => step.name === name));
  const [buildJobId, buildJob] = jobOf("Build");
  assert.equal(jobOf("Controlled production preflight and build")[0], buildJobId);
  assert.equal(jobOf("Preflight")[0], buildJobId);
  const order = (name) => buildJob.steps.findIndex((step) => step.name === name);
  assert.ok(order("Build") < order("Controlled production preflight and build"));
  assert.ok(order("Controlled production preflight and build") < order("Preflight"));
});

test("shared setup starts the pinned disposable PostgreSQL and migrates before any gate", () => {
  assert.equal(setupAction.runs.using, "composite");
  const names = setupAction.runs.steps.map((step) => step.name);
  assert.deepEqual(names, [
    "Start disposable PostgreSQL",
    "Setup Node",
    "Install dependencies",
    "Generate Prisma client",
    "Apply database migrations",
  ]);
  const [postgres, node, install, generate, migrate] = setupAction.runs.steps;
  assert.equal(postgres.env.PG_DIGEST, "sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551");
  assert.match(postgres.run, /docker tag "\$pulled" postgres:16-alpine/u);
  assert.match(postgres.run, /--env POSTGRES_DB=celebratedeal_ci/u);
  assert.equal(node.with["node-version"], 22);
  assert.equal(node.with.cache, "npm");
  assert.equal(install.run, "npm ci");
  assert.equal(generate.run, "npm run db:generate");
  assert.equal(migrate.run, "npm run db:migrate:deploy");
  assert.match(workflow.env.DATABASE_URL, /^postgresql:\/\/postgres:postgres@localhost:5432\/celebratedeal_ci\?schema=public$/u);
});

test("Playwright setup keeps the unchanged install command after the cache restore", () => {
  const steps = playwrightAction.runs.steps;
  const cache = steps.findIndex((step) => step.name === "Cache Playwright browsers");
  const install = steps.findIndex((step) => step.name === "Install Playwright browser");
  assert.ok(cache >= 0 && cache < install);
  assert.equal(steps[install].run, "npx playwright install --with-deps chromium");
});
