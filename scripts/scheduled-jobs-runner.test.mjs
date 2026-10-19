import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  REQUEST_TIMEOUT_MS,
  SCHEDULED_JOBS,
  SCHEDULE_DAILY,
  SCHEDULE_FREQUENT,
  STAGING_ALIAS,
  UNSCHEDULED_ENDPOINTS,
  classifyStatus,
  formatResult,
  jobUrl,
  runScheduledJob,
} from "./scheduled-jobs-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github", "workflows", "scheduled-jobs.yml");
const secret = "scheduled-jobs-test-secret-value";

function fakeResponse(status) {
  let cancelled = false;
  let read = false;
  return {
    status,
    body: { cancel: async () => { cancelled = true; } },
    json: async () => { read = true; return {}; },
    text: async () => { read = true; return ""; },
    get cancelled() { return cancelled; },
    get read() { return read; },
  };
}

test("calls only the fixed staging alias with POST, JOB_SECRET and no redirect following", async () => {
  const calls = [];
  const response = fakeResponse(200);
  const result = await runScheduledJob("webhook-retry", { JOB_SECRET: ` ${secret} ` }, async (url, init) => {
    calls.push({ url, init });
    return response;
  });
  assert.deepEqual(result, { name: "webhook-retry", status: 200, outcome: "ok" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://${STAGING_ALIAS}/api/jobs/webhook-retry`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
  assert.equal(calls[0].init.redirect, "manual");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(response.cancelled, true);
  assert.equal(response.read, false);
  assert.equal(REQUEST_TIMEOUT_MS, 120_000);
});

test("never sends a request without JOB_SECRET or for an unknown job", async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; return fakeResponse(200); };
  assert.deepEqual(await runScheduledJob("email-deliveries", {}, fetchImpl), { name: "email-deliveries", status: 0, outcome: "missing_secret" });
  assert.deepEqual(await runScheduledJob("email-deliveries", { JOB_SECRET: "   " }, fetchImpl), { name: "email-deliveries", status: 0, outcome: "missing_secret" });
  assert.deepEqual(await runScheduledJob("payuni-live-probe", { JOB_SECRET: secret }, fetchImpl), { name: "unknown", status: 0, outcome: "unknown_job" });
  assert.deepEqual(await runScheduledJob("../admin", { JOB_SECRET: secret }, fetchImpl), { name: "unknown", status: 0, outcome: "unknown_job" });
  assert.equal(called, 0);
});

test("classifies failures with fixed words and never echoes secrets or error text", async () => {
  assert.equal(classifyStatus(202), "ok");
  assert.equal(classifyStatus(307), "redirected");
  assert.equal(classifyStatus(401), "unauthorized");
  assert.equal(classifyStatus(405), "route_missing");
  assert.equal(classifyStatus(503), "job_reported_failure");
  assert.equal(classifyStatus(500), "unexpected_status");

  const networkFailure = await runScheduledJob("billing-cycle", { JOB_SECRET: secret }, async () => {
    throw new Error(`connect failed with ${secret}`);
  });
  assert.deepEqual(networkFailure, { name: "billing-cycle", status: 0, outcome: "network_error" });
  const timeoutError = new Error("timed out");
  timeoutError.name = "TimeoutError";
  const timeout = await runScheduledJob("billing-cycle", { JOB_SECRET: secret }, async () => { throw timeoutError; });
  assert.equal(timeout.outcome, "timeout");

  const line = formatResult(await runScheduledJob("email-deliveries", { JOB_SECRET: secret }, async () => fakeResponse(503)));
  assert.equal(line, "scheduled-job name=email-deliveries http=503 outcome=job_reported_failure");
  assert.doesNotMatch(line, new RegExp(secret, "u"));
});

test("every /api/cron and /api/jobs route is either scheduled or explicitly excluded", () => {
  const routeFiles = [];
  for (const base of ["cron", "jobs"]) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") routeFiles.push(full);
      }
    };
    walk(path.join(root, "src", "app", "api", base));
  }
  const routePaths = routeFiles
    .map((file) => `/${path.relative(path.join(root, "src", "app"), path.dirname(file)).split(path.sep).join("/")}`)
    .sort();
  const declared = [...SCHEDULED_JOBS.map((job) => job.path), ...UNSCHEDULED_ENDPOINTS.map((entry) => entry.path)].sort();
  assert.deepEqual(routePaths, declared);
});

test("each scheduled route exposes GET for Vercel Cron and POST for the job runner on one shared handler", () => {
  for (const job of SCHEDULED_JOBS) {
    const source = fs.readFileSync(path.join(root, "src", "app", job.path, "route.ts"), "utf8");
    const getBlock = source.match(/export async function GET\(request: Request\) \{([\s\S]*?)\n\}/u);
    const postBlock = source.match(/export async function POST\(request: Request\) \{([\s\S]*?)\n\}/u);
    assert.ok(getBlock, `${job.name} GET`);
    assert.ok(postBlock, `${job.name} POST`);
    assert.match(getBlock[1], /requireCronSecret\(request\)/u, `${job.name} GET uses CRON_SECRET`);
    assert.doesNotMatch(getBlock[1], /requireJobSecret/u, `${job.name} GET must not accept JOB_SECRET`);
    assert.match(postBlock[1], /requireJobSecret\(request\)/u, `${job.name} POST uses JOB_SECRET`);
    assert.doesNotMatch(postBlock[1], /requireCronSecret/u, `${job.name} POST must not accept CRON_SECRET`);
    const handlerCall = (block) => [...block.matchAll(/return (\w+)\(\);/gu)]
      .map((match) => match[1])
      .filter((name) => name !== "unauthorizedJson");
    const [getCall] = handlerCall(getBlock[1]);
    const [postCall] = handlerCall(postBlock[1]);
    assert.ok(getCall && getCall === postCall, `${job.name} GET and POST share one handler`);
  }
});

test("workflow is valid YAML, protected-branch only, and calls every scheduled job in its own step", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  assert.deepEqual(workflow.on.schedule, [{ cron: SCHEDULE_FREQUENT }, { cron: SCHEDULE_DAILY }]);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.job.options, ["all", ...SCHEDULED_JOBS.map((job) => job.name)]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.concurrency, { group: "scheduled-jobs-staging", "cancel-in-progress": false });

  const job = workflow.jobs["staging-jobs"];
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
  assert.match(job.if, /github\.ref == 'refs\/heads\/master'/u);
  assert.match(job.if, /github\.ref_protected/u);
  assert.match(job.if, /vars\.SCHEDULED_JOBS_PAUSED != 'true'/u);

  const steps = job.steps;
  for (const scheduled of SCHEDULED_JOBS) {
    const step = steps.find((candidate) => candidate.id === scheduled.name);
    assert.ok(step, scheduled.name);
    assert.equal(step["continue-on-error"], true);
    assert.deepEqual(step.env, { JOB_SECRET: "${{ secrets.JOB_SECRET }}" });
    assert.equal(step.run, `node scripts/scheduled-jobs-runner.mjs ${scheduled.name}`);
    const cadence = scheduled.cadence === "daily" ? SCHEDULE_DAILY : SCHEDULE_FREQUENT;
    assert.ok(step.if.includes(`github.event.schedule == '${cadence}'`), `${scheduled.name} cadence`);
    assert.ok(step.if.includes(`inputs.job == '${scheduled.name}'`), `${scheduled.name} dispatch`);
    if (scheduled.optInVariable) assert.ok(step.if.includes(`vars.${scheduled.optInVariable} == 'true'`), `${scheduled.name} opt-in`);
  }

  const enforce = steps.at(-1);
  assert.match(enforce.if, /always\(\)/u);
  for (const scheduled of SCHEDULED_JOBS) assert.ok(enforce.if.includes(`steps.${scheduled.name}.outcome == 'failure'`));
  assert.match(enforce.run, /exit 1/u);

  // The only secret is JOB_SECRET, and the runner never prints bodies.
  const secretRefs = [...source.matchAll(/secrets\.([A-Z0-9_]+)/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(secretRefs)], ["JOB_SECRET"]);
  assert.doesNotMatch(source, /pull_request_target|secrets:\s*inherit|toJSON\(secrets\)|curl\s/iu);
  const actionUses = [...source.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map((match) => match[1]);
  assert.ok(actionUses.length > 0);
  assert.equal(actionUses.every((value) => /@[a-f0-9]{40}$/u.test(value)), true);
});

test("job URLs stay on the fixed alias", () => {
  for (const job of SCHEDULED_JOBS) {
    const url = new URL(jobUrl(job));
    assert.equal(url.protocol, "https:");
    assert.equal(url.host, STAGING_ALIAS);
    assert.equal(url.pathname, job.path);
  }
});
