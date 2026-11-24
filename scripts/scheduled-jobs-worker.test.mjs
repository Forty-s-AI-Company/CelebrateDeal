// 契約測試：Cloudflare Worker 的 cron 與 job 對應必須與 runner 一致，且日誌不含密鑰。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SCHEDULE_DAILY,
  SCHEDULE_FREQUENT,
  SCHEDULED_JOBS,
  STAGING_ALIAS,
} from "./scheduled-jobs-runner.mjs";
import {
  CRON_DAILY,
  CRON_FREQUENT,
  DAILY_JOBS,
  FREQUENT_JOBS,
  callJob,
  jobsForCron,
  runScheduled,
} from "../ops/cloudflare/scheduled-jobs-worker/src/index.js";

const SECRET = "test-secret-value-1234";
const env = { JOB_SECRET: SECRET, TARGET_ORIGIN: `https://${STAGING_ALIAS}`, SCHEDULED_JOBS_PAUSED: "false" };

test("cron 表達式與 runner 相同", () => {
  assert.equal(CRON_FREQUENT, SCHEDULE_FREQUENT);
  assert.equal(CRON_DAILY, SCHEDULE_DAILY);
  const toml = readFileSync(new URL("../ops/cloudflare/scheduled-jobs-worker/wrangler.toml", import.meta.url), "utf8");
  assert.ok(toml.includes(`crons = ["${CRON_FREQUENT}", "${CRON_DAILY}"]`));
  assert.ok(toml.includes(STAGING_ALIAS));
  assert.doesNotMatch(toml, /JOB_SECRET\s*=/);
});

test("job 清單等於 runner 中預設啟用（無 optInVariable）的 job", () => {
  const defaults = (cadence) =>
    SCHEDULED_JOBS.filter((job) => job.cadence === cadence && !job.optInVariable).map((job) => `${job.name} ${job.path}`);
  const worker = (jobs) => jobs.map((job) => `${job.name} ${job.path}`);
  assert.deepEqual(worker(FREQUENT_JOBS), defaults("frequent"));
  assert.deepEqual(worker(DAILY_JOBS), defaults("daily"));
  assert.deepEqual(jobsForCron("unknown"), []);
});

test("以 POST 呼叫並帶 Bearer、不跟隨轉址；日誌不含密鑰", async () => {
  const lines = [];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(`{"leak":"${SECRET}"}`, { status: 200 });
  };
  const deps = { fetch: fetchImpl, log: (l) => lines.push(l), logError: (l) => lines.push(l) };
  const results = await runScheduled(CRON_FREQUENT, env, deps);
  assert.equal(results.length, 5);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
  assert.ok(calls[0].init.signal);
  assert.match(lines[0], /^scheduled-job name=email-deliveries http=200 outcome=ok ms=\d+$/);
  assert.ok(lines.every((line) => !line.includes(SECRET) && !line.includes("leak")));
});

test("3xx、401、網路錯誤與逾時都判為失敗且不洩漏", async () => {
  const lines = [];
  const deps = (fetchImpl) => ({ fetch: fetchImpl, log: (l) => lines.push(l), logError: (l) => lines.push(l) });
  const job = FREQUENT_JOBS[0];
  assert.equal((await callJob(env, job, deps(async () => new Response(null, { status: 302 })))).outcome, "redirected");
  assert.equal((await callJob(env, job, deps(async () => new Response(null, { status: 401 })))).outcome, "unauthorized");
  assert.equal(
    (await callJob(env, job, deps(async () => { throw new Error(`boom ${SECRET}`); }))).outcome,
    "network_error",
  );
  const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
  assert.equal((await callJob(env, job, deps(async () => { throw timeout; }))).outcome, "timeout");
  assert.ok(lines.every((line) => !line.includes(SECRET)));
});

test("暫停或缺少設定時不發出任何請求", async () => {
  let called = 0;
  const deps = {
    fetch: async () => {
      called += 1;
      return new Response(null, { status: 200 });
    },
    log: () => {},
    logError: () => {},
  };
  assert.deepEqual(await runScheduled(CRON_FREQUENT, { ...env, SCHEDULED_JOBS_PAUSED: "true" }, deps), []);
  assert.deepEqual(await runScheduled(CRON_FREQUENT, { ...env, JOB_SECRET: "" }, deps), []);
  assert.equal(called, 0);
});
