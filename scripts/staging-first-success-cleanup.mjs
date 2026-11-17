import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validateBrowserSmokeBinding, verifyStagingAliasBinding } from "./staging-browser-smoke.mjs";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";
import { ALIAS } from "./staging-first-success.mjs";

/**
 * R-10: cleanup of the synthetic merchants the O-13 first-success runner leaves on fixed staging.
 *
 * Same bindings as the runner (exact Preview lineage, then the alias proof) before JOB_SECRET is
 * sent, then one POST to the staging-only ops route. The mode is always explicit: `deactivate` suspends runner vendors
 * so the email and LINE jobs stop sending for them; `delete` removes vendors this cleanup
 * deactivated at least 7 days earlier. The route picks the vendors itself (runner owner mailbox +
 * workspace slug of the same run id); this script sends no id, Email or name.
 *
 * The receipt keeps fixed keys only: mode, result, counts and 8-hex run id prefixes.
 */
export const MODES = Object.freeze(["deactivate", "delete"]);
const ORIGIN = `https://${ALIAS}`;
const RESULTS = new Set(["COMPLETED", "PARTIAL"]);
const SKIP_KEYS = ["financialRecords", "unexpectedMembership", "notRunnerVendor", "notEligible"];
const AFFECTED_KEYS = ["lives", "registrations", "projects", "queuedEmailDeliveries", "ownerUsers"];
const PREFIX = /^[a-f0-9]{8}$/u;
const MAX_PREFIXES = 25;

/** `--mode=<mode>` or CELEBRATEDEAL_CLEANUP_MODE=<mode>; there is no default, so a missing or unknown mode is null. */
export function parseMode(argv = [], env = {}) {
  const flag = argv.find((value) => value.startsWith("--mode="));
  const value = flag ? flag.slice("--mode=".length) : env.CELEBRATEDEAL_CLEANUP_MODE;
  return MODES.includes(value) ? value : null;
}

export function createCleanupReceipt(sourceSha, mode) {
  return {
    schemaVersion: "celebratedeal-staging-first-success-cleanup-run/v1",
    sourceSha: /^[a-f0-9]{40}$/u.test(sourceSha ?? "") ? sourceSha : null,
    mode: MODES.includes(mode) ? mode : "INVALID",
    result: "BLOCKED", reason: "INVALID_BINDING",
    lineage: "NOT_VERIFIED", aliasBinding: "NOT_VERIFIED", httpStatus: null,
    retentionDays: null,
    examined: 0, deactivated: 0, deleted: 0, alreadyDeactivated: 0, retained: 0, failed: 0, truncated: false,
    skipped: Object.fromEntries(SKIP_KEYS.map((key) => [key, 0])),
    affected: Object.fromEntries(AFFECTED_KEYS.map((key) => [key, 0])),
    runIdPrefixes: { processed: [], skipped: [], failed: [] },
  };
}

/** Keep only fixed keys, bounded integers and 8-hex prefixes from the route answer. */
export function sanitizeCleanupResponse(body, mode) {
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 && value < 1_000_000 ? value : 0);
  const prefixes = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && PREFIX.test(entry)).slice(0, MAX_PREFIXES) : []);
  return {
    modeMatches: body?.mode === mode,
    result: typeof body?.result === "string" && RESULTS.has(body.result) ? body.result : "OTHER",
    retentionDays: count(body?.retentionDays),
    examined: count(body?.examined),
    deactivated: count(body?.deactivated),
    deleted: count(body?.deleted),
    alreadyDeactivated: count(body?.alreadyDeactivated),
    retained: count(body?.retained),
    failed: count(body?.failed),
    truncated: body?.truncated === true,
    skipped: Object.fromEntries(SKIP_KEYS.map((key) => [key, count(body?.skipped?.[key])])),
    affected: Object.fromEntries(AFFECTED_KEYS.map((key) => [key, count(body?.affected?.[key])])),
    runIdPrefixes: {
      processed: prefixes(body?.runIdPrefixes?.processed),
      skipped: prefixes(body?.runIdPrefixes?.skipped),
      failed: prefixes(body?.runIdPrefixes?.failed),
    },
  };
}

export async function runStagingFirstSuccessCleanup(env = process.env, dependencies = {}) {
  // An explicitly passed (possibly invalid = null) mode is used as is; it is never re-read from env.
  const mode = Object.hasOwn(dependencies, "mode") ? dependencies.mode : parseMode([], env);
  const result = createCleanupReceipt(env.CELEBRATEDEAL_SOURCE_SHA, mode);
  if (!mode) { result.reason = "INVALID_MODE"; return result; }
  if (!validateBrowserSmokeBinding(env)) return result;
  const verifyLineage = dependencies.verifyLineage ?? verifyMvpPayUniLineage;
  const verifyAlias = dependencies.verifyAlias ?? verifyStagingAliasBinding;
  const fetchImpl = dependencies.fetch ?? fetch;
  try {
    if (!await verifyLineage(env)) { result.reason = "LINEAGE_NOT_VERIFIED"; return result; }
    result.lineage = "VERIFIED";
    if (!await verifyAlias(env)) { result.reason = "ALIAS_NOT_VERIFIED"; return result; }
    result.aliasBinding = "VERIFIED";
  } catch { result.reason = "BINDING_CHECK_FAILED"; return result; }

  let response;
  try {
    response = await fetchImpl(`${ORIGIN}/api/admin/ops/first-success/cleanup`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.JOB_SECRET}`,
        "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA,
        "x-celebratedeal-first-success-cleanup-mode": mode,
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(240_000),
    });
  } catch { result.reason = "REQUEST_FAILED"; return result; }
  result.httpStatus = Number.isSafeInteger(response.status) ? response.status : null;
  if (response.status !== 200) { result.reason = `HTTP_${response.status === 401 || response.status === 404 || response.status === 503 ? response.status : "OTHER"}`; return result; }
  let body;
  try { body = await response.json(); } catch { result.reason = "INVALID_RESPONSE"; return result; }
  const clean = sanitizeCleanupResponse(body, mode);
  const { modeMatches, result: routeResult, ...counts } = clean;
  Object.assign(result, counts);
  if (!modeMatches || routeResult === "OTHER") { result.reason = "INVALID_RESPONSE"; return result; }
  if (routeResult === "PARTIAL") { result.result = "PARTIAL"; result.reason = "VENDOR_FAILURES"; return result; }
  result.result = "COMPLETED";
  result.reason = "NONE";
  return result;
}

/** One grep-able line with fixed keys and integers only. */
export function formatCleanupSummary(receipt) {
  const skipped = Object.values(receipt.skipped).reduce((total, value) => total + value, 0);
  return `mode=${receipt.mode} result=${receipt.result} reason=${receipt.reason} examined=${receipt.examined} deactivated=${receipt.deactivated} deleted=${receipt.deleted} already=${receipt.alreadyDeactivated} retained=${receipt.retained} skipped=${skipped} failed=${receipt.failed} truncated=${receipt.truncated}`;
}

async function main() {
  const mode = parseMode(process.argv.slice(2), process.env);
  const result = await runStagingFirstSuccessCleanup(process.env, { mode });
  if (process.env.RUNNER_TEMP) await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-first-success-cleanup-${result.mode}.json`, `${JSON.stringify(result)}\n`, { mode: 0o600 });
  process.stdout.write(`staging_first_success_cleanup ${formatCleanupSummary(result)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.result === "COMPLETED" ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
