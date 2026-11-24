// CelebrateDeal 背景工作觸發器（Cloudflare Worker）。
// 呼叫的 job 與 scripts/scheduled-jobs-runner.mjs 的預設啟用項目一致。
// 日誌只輸出 job 名稱、HTTP 狀態與耗時；不輸出標頭、回應內容或密鑰。

export const CRON_FREQUENT = "*/5 * * * *";
export const CRON_DAILY = "22 17 * * *";
export const REQUEST_TIMEOUT_MS = 120_000;

// 不要加入 live-media、billing-cycle、data-retention（封測期間不啟用，見文件 §2）。
export const FREQUENT_JOBS = Object.freeze([
  Object.freeze({ name: "email-deliveries", path: "/api/jobs/email-deliveries" }),
  Object.freeze({ name: "line-notifications", path: "/api/cron/line-notifications" }),
  Object.freeze({ name: "webhook-retry", path: "/api/jobs/webhook-retry" }),
  Object.freeze({ name: "payment-reconcile", path: "/api/jobs/payment-reconcile" }),
  Object.freeze({ name: "stream-ready-sync", path: "/api/jobs/stream-ready-sync" }),
]);
export const DAILY_JOBS = Object.freeze([
  Object.freeze({ name: "electronic-invoices", path: "/api/jobs/electronic-invoices" }),
]);

export function jobsForCron(cron) {
  if (cron === CRON_FREQUENT) return FREQUENT_JOBS;
  if (cron === CRON_DAILY) return DAILY_JOBS;
  return [];
}

export function classifyStatus(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "unauthorized";
  if (status >= 300 && status < 400) return "redirected";
  if (status === 404 || status === 405) return "route_missing";
  if (status === 503) return "job_reported_failure";
  return "unexpected_status";
}

export async function callJob(env, job, deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;
  const now = deps.now ?? Date.now;
  const started = now();
  let status = 0;
  let outcome;
  try {
    const response = await fetchImpl(new URL(job.path, env.TARGET_ORIGIN).toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${env.JOB_SECRET}`, "Cache-Control": "no-store" },
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = response.status;
    outcome = classifyStatus(status);
    // 釋放連線，不讀取也不記錄回應內容（可能含付款事件資訊）。
    try {
      await response.body?.cancel();
    } catch {
      // 已讀完或已關閉
    }
  } catch (error) {
    const timedOut = error && typeof error === "object" && (error.name === "TimeoutError" || error.name === "AbortError");
    outcome = timedOut ? "timeout" : "network_error";
  }
  const line = `scheduled-job name=${job.name} http=${status} outcome=${outcome} ms=${now() - started}`;
  (outcome === "ok" ? log : logError)(line);
  return { name: job.name, status, outcome };
}

export async function runScheduled(cron, env, deps = {}) {
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;
  if (String(env.SCHEDULED_JOBS_PAUSED).trim().toLowerCase() === "true") {
    log("scheduled-job outcome=paused");
    return [];
  }
  if (!env.JOB_SECRET || !env.TARGET_ORIGIN) {
    logError("scheduled-job outcome=missing_configuration");
    return [];
  }
  const results = [];
  // 依序呼叫，避免同時佔用同一個資料庫連線池。
  for (const job of jobsForCron(cron)) results.push(await callJob(env, job, deps));
  return results;
}

const worker = {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event.cron, env));
  },
};

export default worker;
