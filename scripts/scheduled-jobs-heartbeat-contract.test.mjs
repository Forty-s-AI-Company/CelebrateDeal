import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { SCHEDULED_JOBS } from "./scheduled-jobs-runner.mjs";

// B-1: the GitHub `*/5` schedule fires only every few hours, so a long-running
// heartbeat workflow provides the real 5-minute cadence. These assertions keep the
// heartbeat and scheduled-jobs.yml from drifting apart.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const heartbeatSource = read(".github/workflows/scheduled-jobs-heartbeat.yml");
const scheduledSource = read(".github/workflows/scheduled-jobs.yml");
const heartbeat = yaml.load(heartbeatSource);
const scheduled = yaml.load(scheduledSource);
const loopScript = read("scripts/scheduled-jobs-heartbeat.sh");
const ensureScript = read("scripts/scheduled-jobs-ensure-heartbeat.sh");

const loopStep = heartbeat.jobs.heartbeat.steps.find((step) => step.id === "loop");
const SIX_HOURS = 6 * 60 * 60;

function heartbeatJobList() {
  // The expression lists the base jobs and, behind the opt-in variable, live-media.
  const names = [...loopStep.env.HEARTBEAT_JOBS.matchAll(/'([a-z0-9 -]+)'/gu)]
    .map((match) => match[1])
    .filter((value) => value !== "true")
    .map((value) => value.split(" "));
  assert.equal(names.length, 2, "base list and live-media list");
  return { withOptIn: names[0], base: names[1] };
}

test("heartbeat is dispatch-only, protected-branch only and honours the pause variable", () => {
  assert.deepEqual(Object.keys(heartbeat.on), ["workflow_dispatch"]);
  const job = heartbeat.jobs.heartbeat;
  assert.match(job.if, /github\.ref == 'refs\/heads\/master'/u);
  assert.match(job.if, /github\.ref_protected/u);
  assert.match(job.if, /vars\.SCHEDULED_JOBS_PAUSED != 'true'/u);
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
});

test("only one heartbeat runs at a time and a newcomer never cancels the live loop", () => {
  assert.deepEqual(heartbeat.concurrency, { group: "scheduled-jobs-heartbeat", "cancel-in-progress": false });
});

test("the loop fits under the 6h job limit and ticks every 5 minutes", () => {
  const duration = Number(loopStep.env.HEARTBEAT_DURATION_SECONDS);
  const interval = Number(loopStep.env.HEARTBEAT_INTERVAL_SECONDS);
  assert.equal(interval, 300);
  assert.ok(duration > 5 * 60 * 60 && duration < SIX_HOURS, `duration ${duration}s`);
  assert.ok(heartbeat.jobs.heartbeat["timeout-minutes"] * 60 < SIX_HOURS);
  assert.ok(heartbeat.jobs.heartbeat["timeout-minutes"] * 60 > duration, "timeout must exceed the loop");
  // Script defaults must agree with the workflow so a manual run behaves the same.
  assert.match(loopScript, /HEARTBEAT_DURATION_SECONDS:-20400/u);
  assert.match(loopScript, /HEARTBEAT_INTERVAL_SECONDS:-300/u);
  assert.ok(20400 < SIX_HOURS);
});

test("the heartbeat calls exactly the frequent jobs of scheduled-jobs.yml and never a daily job", () => {
  const frequent = SCHEDULED_JOBS.filter((job) => job.cadence === "frequent");
  const fromRunner = frequent.filter((job) => !job.optInVariable).map((job) => job.name);
  const fromRunnerOptIn = frequent.map((job) => job.name);
  const { base, withOptIn } = heartbeatJobList();
  assert.deepEqual(base, fromRunner);
  assert.deepEqual(withOptIn, fromRunnerOptIn);

  // Same set as the steps scheduled-jobs.yml runs on its `*/5` firing.
  const steps = scheduled.jobs["staging-jobs"].steps;
  const workflowFrequent = steps
    .filter((step) => typeof step.if === "string" && step.if.includes("github.event.schedule == '*/5 * * * *'"))
    .map((step) => step.id);
  assert.deepEqual(workflowFrequent, fromRunnerOptIn);

  for (const job of SCHEDULED_JOBS.filter((candidate) => candidate.cadence === "daily")) {
    assert.ok(!withOptIn.includes(job.name), `${job.name} must stay on the daily schedule only`);
  }
  // Opt-in jobs follow the same repository variable as scheduled-jobs.yml.
  for (const job of frequent.filter((candidate) => candidate.optInVariable)) {
    assert.ok(loopStep.env.HEARTBEAT_JOBS.includes(`vars.${job.optInVariable} == 'true'`));
  }
});

test("both workflows reach the jobs through the shared runner and use the same secret", () => {
  assert.match(loopScript, /scheduled-jobs-runner\.mjs/u);
  assert.doesNotMatch(loopScript + ensureScript + heartbeatSource, /curl\s/iu);
  for (const job of SCHEDULED_JOBS.filter((candidate) => candidate.cadence === "frequent")) {
    const step = scheduled.jobs["staging-jobs"].steps.find((candidate) => candidate.id === job.name);
    assert.equal(step.run, `node scripts/scheduled-jobs-runner.mjs ${job.name}`);
  }
  assert.equal(loopStep.env.JOB_SECRET, "${{ secrets.JOB_SECRET }}");
  assert.deepEqual([...new Set([...heartbeatSource.matchAll(/secrets\.([A-Z0-9_]+)/gu)].map((match) => match[1]))], ["JOB_SECRET"]);
  assert.ok(heartbeat.jobs.heartbeat.steps.some((step) => step.run === "bash scripts/scheduled-jobs-heartbeat.sh"));
  assert.match(heartbeatSource, /scripts\/scheduled-jobs-runner\.mjs/u);
});

test("one failing call is logged and never stops the loop, bad configuration fails fast", () => {
  assert.match(loopScript, /::error::heartbeat tick/u);
  assert.match(loopScript, /failures=\$\(\(failures \+ 1\)\)/u);
  assert.match(loopScript, /if \[ -z "\$\{JOB_SECRET:-\}" \]/u);
  assert.match(loopScript, /if \[ -z "\$\{GH_TOKEN:-\}" \]/u);
  assert.match(loopScript, /gh workflow view scheduled-jobs-heartbeat\.yml/u);
  // No `set -e`: a failed call must not abort the loop.
  assert.doesNotMatch(loopScript, /^\s*set\s+-[a-z]*e/mu);
  // A failed preflight must not respawn itself.
  const ensure = heartbeat.jobs.heartbeat.steps.find((step) => step.name === "Ensure a successor heartbeat");
  assert.match(ensure.if, /steps\.loop\.outputs\.preflight == 'ok'/u);
});

test("the heartbeat queues its successor and scheduled-jobs.yml can start it when none is active", () => {
  assert.match(loopScript, /scheduled-jobs-ensure-heartbeat\.sh/u);
  assert.match(ensureScript, /gh workflow run "\$WORKFLOW" --ref "\$REF"/u);
  assert.match(ensureScript, /WORKFLOW="scheduled-jobs-heartbeat\.yml"/u);
  assert.match(ensureScript, /REF="\$\{HEARTBEAT_REF:-master\}"/u);
  assert.match(ensureScript, /gh run list --workflow/u);

  const starter = scheduled.jobs["heartbeat-starter"];
  assert.ok(starter, "heartbeat-starter job");
  assert.match(starter.if, /github\.event\.schedule == '\*\/5 \* \* \* \*'/u);
  assert.match(starter.if, /vars\.SCHEDULED_JOBS_PAUSED != 'true'/u);
  assert.ok(starter.steps.some((step) => step.run === "bash scripts/scheduled-jobs-ensure-heartbeat.sh"));
  // The direct job calls stay as a backup and manual dispatch is unchanged.
  assert.ok(scheduled.jobs["staging-jobs"]);
  assert.deepEqual(scheduled.on.workflow_dispatch.inputs.job.options, ["all", ...SCHEDULED_JOBS.map((job) => job.name)]);
});

test("permissions are minimal: contents read everywhere, actions write only on the jobs that dispatch", () => {
  assert.deepEqual(heartbeat.permissions, { contents: "read" });
  assert.deepEqual(scheduled.permissions, { contents: "read" });
  assert.deepEqual(heartbeat.jobs.heartbeat.permissions, { contents: "read", actions: "write" });
  assert.deepEqual(starter().permissions, { contents: "read", actions: "write" });
  assert.equal(scheduled.jobs["staging-jobs"].permissions, undefined, "the job that holds JOB_SECRET gets no actions: write");
  assert.doesNotMatch(heartbeatSource + scheduledSource, /pull_request_target|secrets:\s*inherit|toJSON\(secrets\)|write-all/u);
  const uses = [...(heartbeatSource + scheduledSource).matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  assert.equal(uses.every((value) => /@[a-f0-9]{40}$/u.test(value)), true);
});

function starter() {
  return scheduled.jobs["heartbeat-starter"];
}
