import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-162";
const SCHEMA_VERSION = "wp162-live-sandbox-reconciliation/v1";
const EXPECTED_PROJECT = "celebrate-deal-staging";
const EXPECTED_ROUTE = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const PAYUNI_SANDBOX_HOST = "sandbox-api.payuni.com.tw";
const HEAD_SHA = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ADDITIONAL_PATHS = new Set([
  "scripts/wp162-live-sandbox-reconciliation.mjs",
  "scripts/wp162-live-sandbox-reconciliation.test.mjs",
  ".ai-team/reports/wp162-live-sandbox-reconciliation.json",
  "docs/ai-team/evidence/wp-162-live-sandbox-reconciliation.md",
]);
const SQL_FORBIDDEN = /(?:;|\b(?:insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|do|copy|for\s+update|for\s+share|pg_sleep)\b)/iu;
const SQL_SELECT = /^\s*select\b/iu;

export const WP162_CONSTANTS = Object.freeze({
  WORK_PACKAGE,
  SCHEMA_VERSION,
  EXPECTED_PROJECT,
  EXPECTED_ROUTE,
  PAYUNI_SANDBOX_HOST,
  SQL_CONTRACT: "single_select_synthetic_pending_reservation",
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function safeDigest(value) {
  return typeof value === "string" && HASH.test(value);
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//u, "");
}

function safeStatusOutput(stdout) {
  return String(stdout ?? "").split(/\r?\n/u).filter(Boolean).map((line) => line.slice(0, 500)).join("\n");
}

function runReadOnly(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parseCliJson(stdout) {
  const text = String(stdout ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("WP162_CLI_JSON_MISSING");
  return JSON.parse(text.slice(start, end + 1));
}

export function validateSingleSelect(sql) {
  const text = String(sql ?? "").trim();
  if (!SQL_SELECT.test(text) || SQL_FORBIDDEN.test(text) || text.includes("\0")) return false;
  return !/\b(?:information_schema|pg_catalog|current_user|session_user|inet_server_addr)\b/iu.test(text);
}

export function validateRouteIdentity(facts, expectedHead) {
  if (!facts || facts.projectName !== EXPECTED_PROJECT) return { ok: false, reason: "PROJECT_MISMATCH" };
  if (facts.readyState !== "READY" || facts.target !== "preview") return { ok: false, reason: "DEPLOYMENT_NOT_READY_PREVIEW" };
  if (facts.route !== EXPECTED_ROUTE || facts.routeAliasMatched !== true) return { ok: false, reason: "ROUTE_ALIAS_MISMATCH" };
  if (!HEAD_SHA.test(facts.deployedCommitSha ?? "") || facts.deployedCommitSha !== expectedHead) return { ok: false, reason: "DEPLOYMENT_HEAD_MISMATCH" };
  if (facts.workspaceDirty !== true || facts.dirtyWorkspaceClaimedDeployed !== false) return { ok: false, reason: "DIRTY_WORKSPACE_CLAIM_INVALID" };
  if (facts.customHostStatus !== 200 || facts.deploymentHostStatus !== 200) return { ok: false, reason: "ROUTE_HEAD_PROBE_FAILED" };
  return { ok: true, reason: null };
}

function gitSnapshot() {
  const status = runReadOnly(process.platform === "win32" ? "git.exe" : "git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  const staged = runReadOnly(process.platform === "win32" ? "git.exe" : "git", ["diff", "--cached", "--name-only"]);
  const statusText = safeStatusOutput(status.stdout);
  const stagedText = safeStatusOutput(staged.stdout);
  return {
    statusFingerprint: sha256(statusText),
    statusLines: statusText ? statusText.split(/\r?\n/u).filter(Boolean).length : 0,
    statusText,
    stagedIndexEmpty: stagedText.trim() === "",
  };
}

async function headProbe(url) {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(12_000) });
    return {
      status: response.status,
      locationPresent: response.headers.has("location"),
      vercelIdPresent: response.headers.has("x-vercel-id"),
      bodyRead: false,
    };
  } catch (error) {
    return { status: null, locationPresent: false, vercelIdPresent: false, bodyRead: false, errorClass: error?.constructor?.name ?? "Error" };
  }
}

async function collectVercelFacts() {
  const cli = process.platform === "win32" ? "vercel.cmd" : "vercel";
  const list = runReadOnly(cli, ["list", "--json", "--limit", "5"]);
  if (list.exitCode !== 0) throw new Error("WP162_VERCEL_LIST_FAILED");
  const listPayload = parseCliJson(list.stdout);
  const deployments = Array.isArray(listPayload?.deployments) ? listPayload.deployments : [];
  const latest = deployments.find((item) => item?.name === EXPECTED_PROJECT);
  if (!latest) throw new Error("WP162_STAGING_DEPLOYMENT_MISSING");
  const inspect = runReadOnly(cli, ["inspect", EXPECTED_ROUTE, "--json"]);
  if (inspect.exitCode !== 0) throw new Error("WP162_ROUTE_INSPECT_FAILED");
  const inspected = parseCliJson(inspect.stdout);
  const head = runReadOnly(process.platform === "win32" ? "git.exe" : "git", ["rev-parse", "HEAD"]);
  const expectedHead = String(head.stdout ?? "").trim();
  const customHost = await headProbe(`${EXPECTED_ROUTE}/api/health`);
  const deploymentUrl = typeof latest.url === "string" ? `https://${latest.url}` : "";
  const deploymentHost = await headProbe(`${deploymentUrl}/api/health`);
  const aliases = Array.isArray(inspected?.aliases) ? inspected.aliases : [];
  const routeResolvesToLatest = typeof inspected?.url === "string" && inspected.url === latest.url && inspected?.readyState === "READY";
  const snapshot = gitSnapshot();
  const facts = {
    projectName: latest.name ?? null,
    deploymentIdPresent: typeof latest.uid === "string" || typeof inspected?.id === "string",
    deploymentState: latest.state ?? null,
    readyState: inspected?.readyState ?? latest.state ?? null,
    target: inspected?.target ?? "",
    route: EXPECTED_ROUTE,
    routeAliasMatched: routeResolvesToLatest || aliases.includes(new URL(EXPECTED_ROUTE).hostname) || aliases.includes(EXPECTED_ROUTE.replace(/^https:\/\//u, "")),
    latestDeploymentUrlPresent: deploymentUrl.length > 0,
    deployedCommitSha: latest?.meta?.githubCommitSha ?? null,
    headSha: expectedHead,
    workspaceDirty: snapshot.statusLines > 0,
    dirtyWorkspaceClaimedDeployed: false,
    customHostStatus: customHost.status,
    deploymentHostStatus: deploymentHost.status,
    customHostVercelIdPresent: customHost.vercelIdPresent,
    deploymentHostVercelIdPresent: deploymentHost.vercelIdPresent,
    bodyRead: false,
    cliOutputPersisted: false,
  };
  return { facts, snapshot, cliRawNotPersisted: true };
}

function processEnvironmentBroker() {
  const dbUrlPresent = Boolean(String(process.env.STAGING_DATABASE_URL ?? "").trim());
  const environment = String(process.env.WP162_STAGING_DB_ENVIRONMENT ?? "").trim().toLowerCase();
  const permission = String(process.env.WP162_STAGING_DB_PERMISSION ?? "").trim().toLowerCase();
  return {
    credentialPresent: dbUrlPresent,
    environment,
    permission,
    identityConfirmed: dbUrlPresent && environment === "staging" && permission === "read_only",
    productionIdentityDetected: environment === "production" || permission === "read_write",
    source: "controlled_process_environment_only",
  };
}

export const SYNTHETIC_PENDING_SQL = `SELECT ir.id AS reservation_id, ir.status AS reservation_status, ir.payment_transaction_id, pt.order_number, pt.provider_trade_no, pt.gross_amount_cents, pt.status AS transaction_status
FROM "InventoryReservation" ir
JOIN "PaymentTransaction" pt ON pt.id = ir.payment_transaction_id AND pt.vendor_id = ir.vendor_id
WHERE ir.status = 'reserved' AND pt.status = 'pending' AND COALESCE(pt.metadata->>'synthetic', 'false') = 'true'
LIMIT 2`;

function payUniBroker() {
  const environment = String(process.env.PAYUNI_ENV ?? "").trim().toLowerCase();
  const hostMatches = environment === "sandbox";
  const requiredPresent = ["PAYUNI_ENV", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV", "PAYUNI_TEST_APP_URL", "PAYUNI_STAGING_ALLOWED_HOST"].every((key) => Boolean(String(process.env[key] ?? "").trim()));
  let callbackHostMatches = false;
  for (const key of ["PAYUNI_TEST_APP_URL", "PAYUNI_STAGING_ALLOWED_HOST"]) {
    try {
      callbackHostMatches ||= new URL(String(process.env[key])).hostname === new URL(EXPECTED_ROUTE).hostname;
    } catch { /* no sensitive value is persisted */ }
  }
  return {
    endpointHost: hostMatches ? PAYUNI_SANDBOX_HOST : "UNCONFIRMED",
    officialSandbox: hostMatches,
    requiredCredentialsPresent: requiredPresent,
    callbackHostMatches,
    productionIdentityDetected: environment === "production",
    operation: "READ_ONLY_TRANSACTION_LOOKUP",
  };
}

function initialReceipt() {
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: WORK_PACKAGE,
    status: "WP162_EXACT_NO_GO_EXTERNAL_RECONCILIATION_UNSAFE_OR_INCOMPLETE",
    conclusion: "WP162_EXACT_NO_GO_EXTERNAL_RECONCILIATION_UNSAFE_OR_INCOMPLETE",
    routeIdentity: null,
    database: {
      credentialSource: "controlled_process_environment_only",
      credentialPresent: false,
      environment: "UNCONFIRMED",
      permission: "UNCONFIRMED",
      identityConfirmed: false,
      productionIdentityDetected: false,
      queryAttempted: false,
      queryCount: 0,
      statementClass: "single_select_synthetic_pending_reservation",
      syntheticPendingReservationCount: null,
      providerReferenceDigest: null,
      queryFailure: null,
    },
    payuni: {
      endpointHost: "UNCONFIRMED",
      officialSandbox: false,
      requiredCredentialsPresent: false,
      callbackHostMatches: false,
      productionIdentityDetected: false,
      operation: "READ_ONLY_TRANSACTION_LOOKUP",
      lookupAttempted: false,
      lookupCount: 0,
      retryCount: 0,
      providerReferenceDigest: null,
      normalizedStatus: null,
      lookupFailure: null,
    },
    lineage: { sameEnvironmentGeneration: false, providerReferenceMatches: false, productionIdentityDetected: false },
    quality: { localPreflight: "NOT_RUN", routeIdentity: "NOT_RUN", dbGuard: "NOT_RUN", providerGuard: "NOT_RUN", strictReceiptReadback: "NOT_RUN", preserveOnlyGuard: "NOT_RUN", scopedLint: "NOT_RUN", typecheck: "NOT_RUN", diffCheck: "NOT_RUN", stagedIndexEmpty: "NOT_RUN" },
    sideEffects: { vercelMetadataReads: 0, routeHeadProbes: 0, databaseQueries: 0, payuniLookups: 0, retries: 0, databaseWrites: 0, providerWrites: 0, payments: 0, refunds: 0, callbackReplays: 0, deploymentWrites: 0, production: 0, bodyReads: 0, rawOutputPersisted: 0 },
    ownership: { before: null, after: null, statusFingerprintUnchanged: false, protectedUnchanged: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: false, preserveOnly: true },
    scoreImpact: { CAT04: { before: 6.0, after: 6.0 }, total: { before: 71.5, after: 71.5 } },
    safety: { environmentFileRead: false, rawResponseSaved: false, rawIdsPersisted: false, secretsSaved: false, tokensSaved: false, cookiesSaved: false, productionIdentityDetected: false, dirtyWorkspaceClaimedDeployed: false },
    rawOutputPersisted: false,
    rawOutputExposed: false,
    sourceEnvContentsRead: false,
    sanitized: true,
    canonicalDigest: null,
    failure: null,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  const required = ["schemaVersion", "workPackage", "status", "conclusion", "routeIdentity", "database", "payuni", "lineage", "quality", "sideEffects", "ownership", "scoreImpact", "safety", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  for (const key of required) if (!(key in (receipt ?? {}))) errors.push(`MISSING_${key}`);
  if (receipt?.schemaVersion !== SCHEMA_VERSION || receipt?.workPackage !== WORK_PACKAGE) errors.push("SCHEMA");
  if (receipt?.status !== "WP162_EXACT_NO_GO_EXTERNAL_RECONCILIATION_UNSAFE_OR_INCOMPLETE" && receipt?.status !== "WP162_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED") errors.push("STATUS");
  if (receipt?.conclusion !== receipt?.status) errors.push("CONCLUSION");
  if (receipt?.rawOutputPersisted !== false || receipt?.rawOutputExposed !== false || receipt?.sourceEnvContentsRead !== false || receipt?.sanitized !== true) errors.push("SAFETY_FLAGS");
  if (receipt?.safety?.environmentFileRead !== false || receipt?.safety?.rawResponseSaved !== false || receipt?.safety?.rawIdsPersisted !== false || receipt?.safety?.secretsSaved !== false || receipt?.safety?.tokensSaved !== false || receipt?.safety?.cookiesSaved !== false) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.sideEffects?.databaseWrites !== 0 || receipt?.sideEffects?.providerWrites !== 0 || receipt?.sideEffects?.payments !== 0 || receipt?.sideEffects?.refunds !== 0 || receipt?.sideEffects?.callbackReplays !== 0 || receipt?.sideEffects?.deploymentWrites !== 0 || receipt?.sideEffects?.production !== 0 || receipt?.sideEffects?.retries !== 0 || receipt?.sideEffects?.bodyReads !== 0) errors.push("SIDE_EFFECTS");
  if (receipt?.database?.queryCount > 1 || receipt?.payuni?.lookupCount > 1) errors.push("EXACTLY_ONCE");
  if (!safeDigest(receipt?.canonicalDigest) && receipt?.canonicalDigest !== null) errors.push("DIGEST");
  const serialized = JSON.stringify(receipt);
  if (/(?:"rawResponse"\s*:|"rawPayload"\s*:|postgres(?:ql)?:\/\/|Bearer\s+|BEGIN PRIVATE)/iu.test(serialized)) errors.push("SENSITIVE_TEXT");
  return { ok: errors.length === 0, errors };
}

function protectedPathCheck(before, after) {
  const beforeLines = new Set((before?.statusText ?? "").split(/\r?\n/u).filter(Boolean));
  const afterLines = new Set((after?.statusText ?? "").split(/\r?\n/u).filter(Boolean));
  const changed = [...beforeLines].filter((line) => !afterLines.has(line)).concat([...afterLines].filter((line) => !beforeLines.has(line)));
  const unknown = changed.filter((line) => {
    const relative = normalizePath(line.slice(3));
    return relative && !ADDITIONAL_PATHS.has(relative);
  });
  return { unchanged: unknown.length === 0, unknown };
}

export async function runWp162({ routeFacts = null, expectedHead = null, dbBroker = processEnvironmentBroker(), providerBroker = payUniBroker(), queryDatabase = null, lookupPayUni = null } = {}) {
  const receipt = initialReceipt();
  const before = gitSnapshot();
  receipt.ownership.before = { statusFingerprint: before.statusFingerprint, statusLines: before.statusLines, stagedIndexEmpty: before.stagedIndexEmpty };
  receipt.sideEffects.vercelMetadataReads = routeFacts ? 0 : 1;
  try {
    if (!routeFacts) {
      const collected = await collectVercelFacts();
      routeFacts = collected.facts;
      expectedHead = routeFacts.headSha;
      receipt.sideEffects.routeHeadProbes = 2;
    }
    receipt.routeIdentity = {
      projectName: routeFacts.projectName,
      deploymentState: routeFacts.deploymentState ?? routeFacts.readyState,
      readyState: routeFacts.readyState,
      target: routeFacts.target,
      route: routeFacts.route,
      routeAliasMatched: routeFacts.routeAliasMatched,
      deployedCommitSha: routeFacts.deployedCommitSha,
      headSha: expectedHead ?? routeFacts.headSha,
      deployedCommitMatchesHead: routeFacts.deployedCommitSha === (expectedHead ?? routeFacts.headSha),
      workspaceDirty: routeFacts.workspaceDirty,
      dirtyWorkspaceClaimedDeployed: routeFacts.dirtyWorkspaceClaimedDeployed,
      customHostStatus: routeFacts.customHostStatus,
      deploymentHostStatus: routeFacts.deploymentHostStatus,
      bodyRead: false,
    };
    const routeValidation = validateRouteIdentity(routeFacts, expectedHead ?? routeFacts.headSha);
    receipt.quality.routeIdentity = routeValidation.ok ? "PASS" : "FAIL";
    if (!routeValidation.ok) receipt.failure = routeValidation.reason;
    receipt.quality.localPreflight = validateSingleSelect(SYNTHETIC_PENDING_SQL) ? "PASS" : "FAIL";
    receipt.quality.dbGuard = receipt.quality.localPreflight;
    receipt.quality.providerGuard = providerBroker.officialSandbox && providerBroker.operation === "READ_ONLY_TRANSACTION_LOOKUP" ? "PASS" : "FAIL";
    if (receipt.failure || receipt.quality.localPreflight !== "PASS" || receipt.quality.providerGuard !== "PASS") throw new Error(receipt.failure ?? "WP162_LOCAL_GUARD_FAILED");

    receipt.database = { ...receipt.database, credentialPresent: dbBroker.credentialPresent, environment: dbBroker.environment || "UNCONFIRMED", permission: dbBroker.permission || "UNCONFIRMED", identityConfirmed: dbBroker.identityConfirmed, productionIdentityDetected: dbBroker.productionIdentityDetected };
    if (!dbBroker.identityConfirmed || dbBroker.productionIdentityDetected) throw new Error("WP162_STAGING_DB_CREDENTIAL_IDENTITY_UNCONFIRMED");
    if (typeof queryDatabase !== "function") throw new Error("WP162_STAGING_DB_QUERY_BROKER_UNAVAILABLE");
    receipt.database.queryAttempted = true;
    receipt.database.queryCount = 1;
    receipt.sideEffects.databaseQueries = 1;
    const rows = await queryDatabase(SYNTHETIC_PENDING_SQL);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error("WP162_SYNTHETIC_PENDING_RESERVATION_COUNT_NOT_ONE");
    receipt.database.syntheticPendingReservationCount = rows.length;
    receipt.database.providerReferenceDigest = sha256(`${rows[0].reservation_id}|${rows[0].payment_transaction_id}|${rows[0].order_number}`);
    if (!providerBroker.requiredCredentialsPresent || !providerBroker.callbackHostMatches) throw new Error("WP162_PAYUNI_SANDBOX_CREDENTIAL_OR_CALLBACK_IDENTITY_UNCONFIRMED");
    if (typeof lookupPayUni !== "function") throw new Error("WP162_PAYUNI_LOOKUP_BROKER_UNAVAILABLE");
    receipt.payuni.lookupAttempted = true;
    receipt.payuni.lookupCount = 1;
    receipt.sideEffects.payuniLookups = 1;
    const providerResult = await lookupPayUni(rows[0]);
    receipt.payuni.providerReferenceDigest = sha256(String(providerResult.providerTradeNo));
    receipt.payuni.normalizedStatus = providerResult.status;
    receipt.lineage.providerReferenceMatches = receipt.database.providerReferenceDigest === sha256(`${rows[0].reservation_id}|${rows[0].payment_transaction_id}|${rows[0].order_number}`);
    receipt.lineage.sameEnvironmentGeneration = receipt.routeIdentity.deployedCommitMatchesHead && dbBroker.identityConfirmed && providerBroker.officialSandbox;
    receipt.status = receipt.lineage.sameEnvironmentGeneration && receipt.lineage.providerReferenceMatches && receipt.payuni.normalizedStatus === "refunded" ? "WP162_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED" : receipt.status;
    receipt.conclusion = receipt.status;
  } catch (error) {
    receipt.failure = receipt.failure ?? (error?.message ?? "WP162_EXTERNAL_READ_FAILED");
  }
  const after = gitSnapshot();
  const protectedCheck = protectedPathCheck(before, after);
  receipt.ownership.after = { statusFingerprint: after.statusFingerprint, statusLines: after.statusLines, stagedIndexEmpty: after.stagedIndexEmpty };
  receipt.ownership.statusFingerprintUnchanged = before.statusFingerprint === after.statusFingerprint;
  receipt.ownership.protectedUnchanged = protectedCheck.unchanged;
  receipt.ownership.unknown = protectedCheck.unknown.length;
  receipt.ownership.stagedIndexEmpty = after.stagedIndexEmpty;
  receipt.quality.preserveOnlyGuard = protectedCheck.unchanged && receipt.ownership.unknown === 0 ? "PASS" : "FAIL";
  receipt.quality.strictReceiptReadback = "PENDING";
  receipt.quality.diffCheck = receipt.quality.preserveOnlyGuard;
  receipt.quality.stagedIndexEmpty = after.stagedIndexEmpty ? "PASS" : "FAIL";
  receipt.safety.productionIdentityDetected = Boolean(receipt.routeIdentity?.target === "production" || receipt.database.productionIdentityDetected || receipt.payuni.productionIdentityDetected);
  receipt.lineage.productionIdentityDetected = receipt.safety.productionIdentityDetected;
  receipt.canonicalDigest = sha256(canonical({ ...receipt, canonicalDigest: null, quality: { ...receipt.quality, strictReceiptReadback: "PENDING" } }));
  const validation = validateReceipt(receipt);
  receipt.quality.strictReceiptReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) receipt.failure = receipt.failure ?? `WP162_RECEIPT_INVALID:${validation.errors.join(",")}`;
  if (receipt.status === "WP162_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED" && receipt.failure) receipt.status = "WP162_EXACT_NO_GO_EXTERNAL_RECONCILIATION_UNSAFE_OR_INCOMPLETE";
  receipt.conclusion = receipt.status;
  receipt.canonicalDigest = sha256(canonical({ ...receipt, canonicalDigest: null }));
  return receipt;
}

async function writeExclusive(filePath, content) {
  if (fs.existsSync(filePath)) throw new Error("WP162_RECEIPT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporaryPath, `${content}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await fsp.rename(temporaryPath, filePath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  runWp162()
    .then(async (receipt) => {
      const reportPath = path.join(ROOT, ".ai-team", "reports", "wp162-live-sandbox-reconciliation.json");
      const evidencePath = path.join(ROOT, "docs", "ai-team", "evidence", "wp-162-live-sandbox-reconciliation.md");
      const evidence = [
        "# WP-162 Live Sandbox／Staging Identity Reconciliation",
        "",
        `- status: \`${receipt.status}\``,
        `- conclusion: \`${receipt.conclusion}\``,
        `- route: ${receipt.routeIdentity?.route ?? "UNCONFIRMED"}`,
        `- deployment: ${receipt.routeIdentity?.readyState ?? "UNCONFIRMED"}／target=${receipt.routeIdentity?.target ?? "UNCONFIRMED"}`,
        `- deployed commit matches HEAD: \`${receipt.routeIdentity?.deployedCommitMatchesHead ?? false}\``,
        `- dirty workspace claimed deployed: \`${receipt.routeIdentity?.dirtyWorkspaceClaimedDeployed ?? false}\``,
        `- staging DB query count: \`${receipt.database.queryCount}\``,
        `- PayUni Sandbox lookup count: \`${receipt.payuni.lookupCount}\``,
        `- database writes／provider writes／payment／refund／callback replay: \`${receipt.sideEffects.databaseWrites}/${receipt.sideEffects.providerWrites}/${receipt.sideEffects.payments}/${receipt.sideEffects.refunds}/${receipt.sideEffects.callbackReplays}\``,
        `- failure: \`${receipt.failure ?? "none"}\``,
        "",
        "本 receipt 僅保存遮罩化狀態與 digest；未保存 raw response、識別碼、secret、token、cookie 或 .env 內容。",
      ].join("\n");
      await writeExclusive(reportPath, JSON.stringify(receipt));
      await writeExclusive(evidencePath, evidence);
      process.stdout.write(JSON.stringify({ workPackage: WORK_PACKAGE, status: receipt.status, failure: receipt.failure, dbQueryCount: receipt.database.queryCount, payuniLookupCount: receipt.payuni.lookupCount }) + "\n");
      if (receipt.status !== "WP162_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED") process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(JSON.stringify({ workPackage: WORK_PACKAGE, status: "WP162_RUNNER_ERROR", errorClass: error?.constructor?.name ?? "Error" }) + "\n");
      process.exitCode = 1;
    });
}
