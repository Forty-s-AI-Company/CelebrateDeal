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
const localActions = { [setupUses]: setupAction, [playwrightUses]: playwrightAction };

/** A job's steps with every local composite action replaced by its own steps. */
function expandedSteps(job) {
  return job.steps.flatMap((step) => {
    if (!step.uses?.startsWith("./")) return [step];
    const action = localActions[step.uses];
    assert.ok(action, `unknown local action ${step.uses}`);
    return action.runs.steps;
  });
}

// Frozen run/env/shell of every run step in the gate jobs and the shared
// local actions (the `quality` aggregator is checked separately). A change
// to any gate command must update this snapshot deliberately in review.
const expectedRunSteps = {
  "Import fixed Preview source for staging contract tests": {
    run: "set -euo pipefail\ngit fetch --no-tags origin refs/pull/277/head:refs/remotes/origin/verified-wp2-source\ntest \"$(git rev-parse refs/remotes/origin/verified-wp2-source)\" = '9193326824b8b6bf774bdfa28e4783a1a1b8f304'\n",
    env: null,
    shell: "bash",
  },
  "Start disposable PostgreSQL": {
    run: "set -euo pipefail\npulled=\"\"\nfor attempt in 1 2 3; do\n  for source in \"public.ecr.aws/docker/library/postgres@${PG_DIGEST}\" \"docker.io/library/postgres@${PG_DIGEST}\"; do\n    if docker pull --quiet \"$source\"; then pulled=\"$source\"; break 2; fi\n  done\n  sleep $((attempt * 15))\ndone\ntest -n \"$pulled\"\ndocker tag \"$pulled\" postgres:16-alpine\ndocker run --detach --name ci-postgres --publish 5432:5432 \\\n  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=celebratedeal_ci \\\n  postgres:16-alpine\n# The image's init server listens only on the Unix socket, so a TCP\n# check waits for the real server.\nfor _ in $(seq 1 60); do\n  if docker exec ci-postgres pg_isready --host 127.0.0.1 --username postgres --dbname celebratedeal_ci >/dev/null 2>&1; then exit 0; fi\n  sleep 2\ndone\ndocker logs ci-postgres | tail -n 30\nexit 1\n",
    env: {"PG_DIGEST":"sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551"},
    shell: "bash",
  },
  "Install dependencies": {
    run: "npm ci",
    env: null,
    shell: "bash",
  },
  "Generate Prisma client": {
    run: "npm run db:generate",
    env: null,
    shell: "bash",
  },
  "Apply database migrations": {
    run: "npm run db:migrate:deploy",
    env: null,
    shell: "bash",
  },
  "Production dependency audit": {
    run: "npm audit --omit=dev --audit-level=high",
    env: null,
    shell: null,
  },
  "Repository secret and archive scan": {
    run: "npm run secret:scan",
    env: null,
    shell: null,
  },
  "Migration name order": {
    run: "set -euo pipefail\necho \"migration-order base ref: ${MIGRATION_ORDER_BASE_REF}\"\nif [ \"$GITHUB_EVENT_NAME\" = merge_group ]; then\n  echo \"merge_group base_sha=${MERGE_GROUP_BASE_SHA} HEAD^1=$(git rev-parse HEAD^1)\"\n  if ! [[ \"$MIGRATION_ORDER_BASE_REF\" =~ ^[0-9a-f]{40}$ && \"$MIGRATION_ORDER_BASE_REF\" = \"$MERGE_GROUP_BASE_SHA\" ]]; then\n    echo \"migration-order: merge_group base_sha is missing or malformed.\" >&2\n    exit 1\n  fi\nfi\nnode scripts/migration-order-check.mjs\nif [ \"$GITHUB_EVENT_NAME\" = push ] && [ \"$MIGRATION_ORDER_BASE_REF\" != 'HEAD^1' ]; then\n  MIGRATION_ORDER_BASE_REF='HEAD^1' node scripts/migration-order-check.mjs\nfi\n",
    env: {"MIGRATION_ORDER_BASE_REF":"${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha || (github.event_name == 'push' && github.ref == 'refs/heads/master') && (github.event.before != '0000000000000000000000000000000000000000' && github.event.before || 'HEAD^1') || 'origin/master' }}","MERGE_GROUP_BASE_SHA":"${{ github.event.merge_group.base_sha }}"},
    shell: "bash",
  },
  "Prisma schema drift against migrations": {
    run: "set -euo pipefail\nshadow_base_url=\"${DATABASE_URL%\\?schema=public}\"\npsql \"$shadow_base_url\" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE celebratedeal_shadow_ci'\nPRISMA_DRIFT_SHADOW_DATABASE_URL=\"${shadow_base_url%/*}/celebratedeal_shadow_ci?schema=public\" node scripts/prisma-drift-check.mjs\n",
    env: null,
    shell: "bash",
  },
  "Lint": {
    run: "npm run lint",
    env: null,
    shell: null,
  },
  "Typecheck": {
    run: "npm run typecheck",
    env: null,
    shell: null,
  },
  "PayUni deployment environment binding contract": {
    run: "npx vitest run src/lib/env.test.ts",
    env: null,
    shell: null,
  },
  "Strict production index access": {
    run: "npm run typecheck:strict-index",
    env: null,
    shell: null,
  },
  "Release readiness contract": {
    run: "npm run test:release-readiness",
    env: null,
    shell: null,
  },
  "Readiness truth reconciliation": {
    run: "node scripts/readiness-truth-reconciliation.mjs",
    env: null,
    shell: null,
  },
  "Staging migration evidence contract": {
    run: "npx vitest run scripts/staging-migration-evidence.test.mjs",
    env: null,
    shell: null,
  },
  "Staging migration receipt validation contract": {
    run: "node --test scripts/validate-staging-migration-evidence.test.mjs",
    env: null,
    shell: null,
  },
  "Staging release evidence aggregation contract": {
    run: "node --test scripts/staging-release-evidence.test.mjs",
    env: null,
    shell: null,
  },
  "Staging release evidence receipt validation contract": {
    run: "node --test scripts/validate-staging-release-evidence.test.mjs",
    env: null,
    shell: null,
  },
  "Human owner acceptance evidence contract": {
    run: "node --test scripts/validate-human-owner-acceptance-evidence.test.mjs",
    env: null,
    shell: null,
  },
  "Release evidence bundle contract": {
    run: "node --test scripts/validate-release-evidence-bundle.test.mjs",
    env: null,
    shell: null,
  },
  "Current release handoff evidence consistency": {
    run: "node --test scripts/current-release-gate-handoff.test.mjs",
    env: null,
    shell: null,
  },
  "External smoke output safety contract": {
    run: "npx vitest run scripts/external-smoke-safety.test.ts",
    env: null,
    shell: null,
  },
  "External provider evidence contract": {
    run: "node --test scripts/external-provider-evidence.test.mjs scripts/validate-external-provider-evidence.test.mjs",
    env: null,
    shell: null,
  },
  "Bounded staging Stream resource contract": {
    run: "node --test scripts/staging-stream-resource-smoke.test.mjs",
    env: null,
    shell: null,
  },
  "Backup tooling static checks": {
    run: "pwsh -NoProfile -File ops/backup/tests/Test-BackupTooling.ps1",
    env: null,
    shell: "pwsh",
  },
  "LINE integration contract": {
    run: "npm run test:line",
    env: null,
    shell: null,
  },
  "Node TAP contract tests": {
    run: "npm run test:contracts",
    env: null,
    shell: null,
  },
  "Build": {
    run: "npm run build",
    env: null,
    shell: null,
  },
  "Controlled production preflight and build": {
    run: "node scripts/build/controlled-production-build.mjs",
    env: null,
    shell: null,
  },
  "Preflight": {
    run: "NODE_ENV=production npm run preflight",
    env: null,
    shell: null,
  },
  "Unit tests and coverage thresholds": {
    run: "npm run test:coverage",
    env: null,
    shell: null,
  },
  "Affiliate portal database boundaries": {
    run: "npx vitest run --config vitest.affiliate-portal-db.config.ts",
    env: {"COURSE_LEARNING_DISPOSABLE":"verified-loopback"},
    shell: null,
  },
  "Native course database boundaries": {
    run: "npx vitest run --config vitest.course-learning-db.config.ts",
    env: {"COURSE_LEARNING_DISPOSABLE":"verified-loopback"},
    shell: null,
  },
  "Course community database boundaries": {
    run: "npx vitest run --config vitest.course-community-db.config.ts",
    env: {"COURSE_LEARNING_DISPOSABLE":"verified-loopback"},
    shell: null,
  },
  "PostgreSQL concurrency tests": {
    run: "base_url=\"${DATABASE_URL%\\?schema=public}\"\nwp17_base_url=\"${base_url%/*}/celebratedeal_wp17_ci\"\nwp18_base_url=\"${base_url%/*}/celebratedeal_wp18_ci\"\nwp17_url=\"${wp17_base_url}?schema=wp17_ci\"\nwp18_url=\"${wp18_base_url}?schema=wp18_ci\"\npsql \"$base_url\" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE celebratedeal_wp17_ci'\npsql \"$base_url\" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE celebratedeal_wp18_ci'\npsql \"$wp17_base_url\" -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA wp17_ci'\npsql \"$wp18_base_url\" -v ON_ERROR_STOP=1 -c 'CREATE SCHEMA wp18_ci'\npsql \"$wp17_base_url\" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA wp17_ci'\npsql \"$wp18_base_url\" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA wp18_ci'\nDATABASE_URL=\"$wp17_url\" DIRECT_URL=\"$wp17_url\" npm run db:migrate:deploy\nDATABASE_URL=\"$wp18_url\" DIRECT_URL=\"$wp18_url\" npm run db:migrate:deploy\n# A broken disposable connection must fail the gate rather than\n# leave the entire required CI workflow running indefinitely. This\n# is a hard timeout around the unchanged full suite, not a retry,\n# exclusion, or relaxed assertion.\nWP17_COVERAGE_DATABASE_URL=\"$wp17_url\" WP17_COVERAGE_DIRECT_URL=\"$wp17_url\" WP17_COVERAGE_DISPOSABLE_SCHEMA=\"wp17_ci\" WP18_COVERAGE_DATABASE_URL=\"$wp18_url\" WP18_COVERAGE_DIRECT_URL=\"$wp18_url\" WP18_COVERAGE_DISPOSABLE_SCHEMA=\"wp18_ci\" timeout --preserve-status 10m npm run test:db:concurrency\n",
    env: null,
    shell: "bash",
  },
  "Learner notification database boundaries": {
    run: "node --import tsx scripts/learner-notification-disposable-qa.mjs",
    env: null,
    shell: null,
  },
  "Q1 original refund proof database isolation": {
    run: "node scripts/q1-original-refund-proof-disposable-qa.mjs",
    env: null,
    shell: null,
  },
  "Q1 original refund reservation database isolation": {
    run: "node scripts/q1-original-refund-target-disposable-qa.mjs",
    env: null,
    shell: null,
  },
  "Resolve Playwright version": {
    run: "echo \"version=$(node -p \"require('./node_modules/playwright-core/package.json').version\")\" >> \"$GITHUB_OUTPUT\"",
    env: null,
    shell: "bash",
  },
  "Install Playwright browser": {
    run: "npx playwright install --with-deps chromium",
    env: null,
    shell: "bash",
  },
  "Release browser gates": {
    run: "npm run e2e -- --fail-on-flaky-tests",
    env: {"NEXT_PUBLIC_APP_URL":"http://127.0.0.1:31023"},
    shell: null,
  },
  "Tracking authoritative events database and browser gate": {
    run: "node scripts/tracking-settings-disposable-qa.mjs --browser",
    env: null,
    shell: null,
  },
  "Referral sharing database and browser gate": {
    run: "node scripts/affiliate-portal-browser-qa.mjs --browser",
    env: null,
    shell: null,
  },
  "Funnel development harness browser gate": {
    run: "node scripts/funnel-elements-browser-qa.mjs",
    env: null,
    shell: null,
  },
  "Subscription recovery database and browser gate": {
    run: "node scripts/subscription-recovery-disposable-qa.mjs --browser",
    env: null,
    shell: null,
  },
};

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

test("every run step keeps its frozen command, env and shell", () => {
  const seen = new Set();
  for (const [id, job] of gateJobs) {
    for (const step of expandedSteps(job)) {
      if (step.run === undefined) continue;
      const expected = expectedRunSteps[step.name];
      assert.ok(expected, `${id}: unexpected run step ${step.name}`);
      assert.deepEqual({ run: step.run, env: step.env ?? null, shell: step.shell ?? null }, expected, `${id}: ${step.name}`);
      seen.add(step.name);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(expectedRunSteps).sort());
  for (const name of requiredGateSteps) assert.ok(name in expectedRunSteps, name);
});

test("no gate job or step can be skipped or allowed to fail; only quality uses if: always()", () => {
  for (const [id, job] of gateJobs) {
    assert.equal(job.if, undefined, id);
    assert.equal(job["continue-on-error"], undefined, id);
    for (const step of [...job.steps, ...expandedSteps(job)]) {
      assert.equal(step.if, undefined, `${id}: ${step.name}`);
      assert.equal(step["continue-on-error"], undefined, `${id}: ${step.name}`);
    }
  }
  const quality = workflow.jobs.quality;
  assert.equal(quality.if, "always()");
  assert.equal(quality["continue-on-error"], undefined);
  for (const step of quality.steps) {
    assert.equal(step.if, undefined, step.name);
    assert.equal(step["continue-on-error"], undefined, step.name);
  }
});

test("quality is the only job that reports the required check name in any workflow", () => {
  const workflowsDirectory = path.join(root, ".github", "workflows");
  const claims = [];
  for (const file of fs.readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/u.test(name)).sort()) {
    const document = yaml.load(fs.readFileSync(path.join(workflowsDirectory, file), "utf8"));
    for (const [id, job] of Object.entries(document?.jobs ?? {})) {
      // A job without `name` reports its id as the check name.
      if (String(job.name ?? id).trim().toLowerCase() === "quality") claims.push(`${file}:${id}`);
    }
  }
  assert.deepEqual(claims, ["ci.yml:quality"]);
});

test("the workflow token can only read repository contents", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  for (const [id, job] of Object.entries(workflow.jobs)) assert.equal(job.permissions, undefined, id);
});

test("migration order compares a queue entry with its own parent and a master push with the previous tip", () => {
  const step = workflow.jobs.static.steps.find((candidate) => candidate.name === "Migration name order");
  // merge_group must use base_sha, which already holds every earlier queue
  // entry; falling back to origin/master would let two queued PRs with
  // out-of-order migrations both pass.
  assert.equal(
    step.env.MIGRATION_ORDER_BASE_REF,
    "${{ github.event_name == 'merge_group' && github.event.merge_group.base_sha"
      + " || (github.event_name == 'push' && github.ref == 'refs/heads/master')"
      + " && (github.event.before != '0000000000000000000000000000000000000000' && github.event.before || 'HEAD^1')"
      + " || 'origin/master' }}",
  );
  assert.equal(step.env.MERGE_GROUP_BASE_SHA, "${{ github.event.merge_group.base_sha }}");
  assert.ok(step.run.includes('echo "merge_group base_sha=${MERGE_GROUP_BASE_SHA} HEAD^1=$(git rev-parse HEAD^1)"'));
  // A missing or malformed base_sha fails closed instead of reaching the default.
  assert.ok(step.run.includes('[[ "$MIGRATION_ORDER_BASE_REF" =~ ^[0-9a-f]{40}$ && "$MIGRATION_ORDER_BASE_REF" = "$MERGE_GROUP_BASE_SHA" ]]'));
  // A master push is still checked against the newest squash merge's parent.
  assert.ok(step.run.includes("MIGRATION_ORDER_BASE_REF='HEAD^1' node scripts/migration-order-check.mjs"));
});
