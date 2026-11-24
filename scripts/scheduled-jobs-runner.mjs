#!/usr/bin/env node
// Calls one CelebrateDeal background job on the fixed staging alias with
// JOB_SECRET. Used by .github/workflows/scheduled-jobs.yml (F-042 / B09-01).
//
// Output contract: one line with the job name, HTTP status, a fixed outcome
// word and, when a job reports them, two non-negative attention counts; jobs
// that declare `reportCounters` (payment-reconcile) also print those summary
// counts and a fixed `skipped` word, which never change the outcome. Response
// bodies, headers, URLs with credentials and error messages are never printed,
// so the Actions log can serve as invocation evidence without leaking customer
// or provider data.
import { pathToFileURL } from "node:url";

export const STAGING_ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
export const REQUEST_TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 256 * 1024;
/** Top-level response counters that mean "a human must look" (PR #447 review M2). */
export const ATTENTION_COUNTERS = Object.freeze(["exhausted", "inventoryUnavailable"]);
/**
 * Informational payment-reconcile counters (PaymentReconcileSummary): printed so an
 * operator can see whether a lost-callback payment was examined, applied or held.
 * They never change the outcome word.
 */
export const PAYMENT_RECONCILE_REPORT_COUNTERS = Object.freeze([
  "candidates", "examined", "paid", "failed", "alreadySettled", "inProgress", "handedToRetry",
  "pending", "notFound", "expired", "queryErrors", "manualReview", "closed", "errors",
]);

/**
 * cadence:
 * - "frequent": every GitHub Actions `*\/5` firing (best effort; GitHub may delay or drop runs).
 * - "daily": only the daily firing (financial and fiscal jobs).
 * optInVariable: repository/environment variable that must be "true" for scheduled calls.
 */
export const SCHEDULED_JOBS = Object.freeze([
  Object.freeze({ name: "email-deliveries", path: "/api/jobs/email-deliveries", cadence: "frequent" }),
  Object.freeze({ name: "line-notifications", path: "/api/cron/line-notifications", cadence: "frequent" }),
  Object.freeze({ name: "webhook-retry", path: "/api/jobs/webhook-retry", cadence: "frequent" }),
  // A-2 05: asks PayUni about payments whose callback never arrived (same cadence as webhook-retry).
  // A4-05: its summary counts (never an order or trade number) show whether a payment was examined.
  Object.freeze({ name: "payment-reconcile", path: "/api/jobs/payment-reconcile", cadence: "frequent", reportCounters: PAYMENT_RECONCILE_REPORT_COUNTERS, reportSkipped: Object.freeze(["disabled", "provider_unavailable"]) }),
  // A4-04: asks Cloudflare Stream about uploads whose ready webhook never arrived
  // (the account's single webhook URL may point at another environment).
  Object.freeze({ name: "stream-ready-sync", path: "/api/jobs/stream-ready-sync", cadence: "frequent" }),
  Object.freeze({ name: "live-media", path: "/api/cron/live-media", cadence: "frequent", optInVariable: "SCHEDULED_JOBS_ENABLE_LIVE_MEDIA" }),
  // Issues monthly invoices (and marks due ones overdue); billing is hidden during the beta,
  // so it never runs on a schedule unless the owner opts in (PR #447 review M1).
  Object.freeze({ name: "billing-cycle", path: "/api/jobs/billing-cycle", cadence: "daily", optInVariable: "SCHEDULED_JOBS_ENABLE_BILLING_CYCLE" }),
  Object.freeze({ name: "electronic-invoices", path: "/api/jobs/electronic-invoices", cadence: "daily" }),
  // F-070: retention sweep (webhook raw payloads, analytics events, audit IPs). Off until
  // the owner fixes the retention windows on legal advice.
  Object.freeze({ name: "data-retention", path: "/api/cron/data-retention", cadence: "daily", optInVariable: "SCHEDULED_JOBS_ENABLE_DATA_RETENTION" }),
]);

/** Endpoints under /api/cron and /api/jobs that are deliberately not scheduled. */
export const UNSCHEDULED_ENDPOINTS = Object.freeze([
  Object.freeze({ path: "/api/cron/line-notifications/runtime-binding", reason: "staging validation probe, not a job" }),
  Object.freeze({ path: "/api/jobs/payuni-live-probe", reason: "one-time live probe with its own dedicated secret" }),
  Object.freeze({ path: "/api/jobs/tracking-deliveries", reason: "per-vendor batch that requires a vendorId body and is disabled by default" }),
]);

export const SCHEDULE_FREQUENT = "*/5 * * * *";
export const SCHEDULE_DAILY = "22 17 * * *";

export function findScheduledJob(name) {
  return SCHEDULED_JOBS.find((job) => job.name === name) ?? null;
}

export function jobUrl(job) {
  return new URL(job.path, `https://${STAGING_ALIAS}`).toString();
}

export function classifyStatus(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401 || status === 403) return "unauthorized";
  if (status >= 300 && status < 400) return "redirected";
  if (status === 404 || status === 405) return "route_missing";
  if (status === 503) return "job_reported_failure";
  return "unexpected_status";
}

/**
 * Extracts only the attention counters from a JSON body. Every other field is
 * discarded; non-integer or negative values are ignored.
 */
export function attentionCounts(bodyText) {
  const counts = {};
  if (typeof bodyText !== "string" || bodyText.length === 0 || bodyText.length > MAX_BODY_BYTES) return counts;
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { return counts; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return counts;
  for (const key of ATTENTION_COUNTERS) {
    const value = parsed[key];
    if (Number.isSafeInteger(value) && value >= 0) counts[key] = value;
  }
  return counts;
}

/**
 * A job's informational report: its declared non-negative integer counters and,
 * when the value is one of the job's fixed words, `skipped`. Everything else is
 * discarded.
 */
export function reportFields(bodyText, job) {
  const report = {};
  if (!job?.reportCounters && !job?.reportSkipped) return report;
  if (typeof bodyText !== "string" || bodyText.length === 0 || bodyText.length > MAX_BODY_BYTES) return report;
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { return report; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return report;
  if (job.reportSkipped?.includes(parsed.skipped)) report.skipped = parsed.skipped;
  for (const key of job.reportCounters ?? []) {
    const value = parsed[key];
    if (Number.isSafeInteger(value) && value >= 0) report[key] = value;
  }
  return report;
}

/**
 * @returns {Promise<{ name: string, status: number, outcome: string, counts?: Record<string, number>, report?: Record<string, number | string> }>}
 * status 0 means no HTTP response was received.
 */
export async function runScheduledJob(name, env = process.env, fetchImpl = globalThis.fetch) {
  const job = findScheduledJob(name);
  if (!job) return { name: "unknown", status: 0, outcome: "unknown_job" };
  const secret = typeof env.JOB_SECRET === "string" ? env.JOB_SECRET.trim() : "";
  if (!secret) return { name: job.name, status: 0, outcome: "missing_secret" };

  let response;
  try {
    response = await fetchImpl(jobUrl(job), {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Cache-Control": "no-store" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && typeof error === "object" && (error.name === "TimeoutError" || error.name === "AbortError");
    return { name: job.name, status: 0, outcome: timedOut ? "timeout" : "network_error" };
  }

  const outcome = classifyStatus(response.status);
  if (outcome !== "ok") {
    // Release the connection without reading or logging the job body.
    try { await response.body?.cancel(); } catch { /* body already consumed or closed */ }
    return { name: job.name, status: response.status, outcome };
  }
  let bodyText = "";
  try { bodyText = await response.text(); } catch { /* counts stay empty */ }
  const counts = attentionCounts(bodyText);
  const needsAttention = ATTENTION_COUNTERS.some((key) => (counts[key] ?? 0) > 0);
  const result = { name: job.name, status: response.status, outcome: needsAttention ? "needs_attention" : "ok", counts };
  if (job.reportCounters || job.reportSkipped) result.report = reportFields(bodyText, job);
  return result;
}

export function formatResult(result) {
  const counts = ATTENTION_COUNTERS
    .filter((key) => Number.isSafeInteger(result.counts?.[key]))
    .map((key) => ` ${key}=${result.counts[key]}`)
    .join("");
  const job = findScheduledJob(result.name);
  const skipped = job?.reportSkipped?.includes(result.report?.skipped) ? ` skipped=${result.report.skipped}` : "";
  const report = (job?.reportCounters ?? [])
    .filter((key) => Number.isSafeInteger(result.report?.[key]) && result.report[key] >= 0)
    .map((key) => ` ${key}=${result.report[key]}`)
    .join("");
  return `scheduled-job name=${result.name} http=${result.status} outcome=${result.outcome}${counts}${skipped}${report}`;
}

async function main(argv) {
  const name = argv[2] ?? "";
  const result = await runScheduledJob(name);
  console.log(formatResult(result));
  process.exitCode = result.outcome === "ok" ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv);
}
