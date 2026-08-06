import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-165";
const SCHEMA_VERSION = "wp165-live-sandbox-reconciliation/v1";
const EXPECTED_PROJECT = "celebrate-deal-staging";
const EXPECTED_ROUTE = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_VARIABLE = "STAGING_DATABASE_URL";
const PAYUNI_SANDBOX_HOST = "sandbox-api.payuni.com.tw";
const HEAD_SHA = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ADDITIONAL_PATHS = new Set([
  "scripts/wp165-live-sandbox-reconciliation.mjs",
  "scripts/wp165-live-sandbox-reconciliation.test.mjs",
  ".ai-team/reports/wp165-live-sandbox-reconciliation.json",
  "docs/ai-team/evidence/wp-165-live-sandbox-reconciliation.md",
]);
const SQL_FORBIDDEN = /(?:;|\b(?:insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|call|do|copy|for\s+update|for\s+share|pg_sleep)\b)/iu;
const SQL_SELECT = /^\s*select\b/iu;

export const WP165_CONSTANTS = Object.freeze({
  WORK_PACKAGE,
  SCHEMA_VERSION,
  EXPECTED_PROJECT,
  EXPECTED_ROUTE,
  EXPECTED_VARIABLE,
  PAYUNI_SANDBOX_HOST,
  SQL_CONTRACT: "single_select_synthetic_pending_reservation",
});

export const SYNTHETIC_PENDING_SQL = `SELECT ir.id AS reservation_id, pt.provider_trade_no AS provider_reference, pt.status AS transaction_status
FROM "InventoryReservation" ir
JOIN "PaymentTransaction" pt ON pt.id = ir.payment_transaction_id AND pt.vendor_id = ir.vendor_id
WHERE ir.status = 'reserved' AND pt.status = 'pending' AND COALESCE(pt.metadata->>'synthetic', 'false') = 'true'
LIMIT 2`;

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
  if (start < 0 || end <= start) throw new Error("WP165_CLI_JSON_MISSING");
  return JSON.parse(text.slice(start, end + 1));
}

export function validateSingleSelect(sql) {
  const text = String(sql ?? "").trim();
  if (!SQL_SELECT.test(text) || SQL_FORBIDDEN.test(text) || text.includes("\0")) return false;
  return !/\b(?:information_schema|pg_catalog|current_user|session_user|inet_server_addr)\b/iu.test(text);
}

export function validateFreshness(facts, expectedHead) {
  if (!facts || facts.projectName !== EXPECTED_PROJECT) return { ok: false, reason: "PROJECT_MISMATCH" };
  if (facts.readyState !== "READY" || facts.target !== "preview") return { ok: false, reason: "DEPLOYMENT_NOT_READY_PREVIEW" };
  if (facts.route !== EXPECTED_ROUTE || facts.routeAliasMatched !== true) return { ok: false, reason: "ROUTE_ALIAS_MISMATCH" };
  if (!HEAD_SHA.test(facts.deployedCommitSha ?? "") || facts.deployedCommitSha !== expectedHead) return { ok: false, reason: "DEPLOYMENT_HEAD_MISMATCH" };
  if (facts.workspaceDirty !== true || facts.dirtyWorkspaceClaimedDeployed !== false) return { ok: false, reason: "DIRTY_WORKSPACE_CLAIM_INVALID" };
  if (facts.customHostStatus !== 200 || facts.deploymentHostStatus !== 200) return { ok: false, reason: "ROUTE_HEAD_PROBE_FAILED" };
  if (facts.previewBindingPresent !== true) return { ok: false, reason: "PREVIEW_BINDING_MISSING" };
  if (facts.deploymentBindingLineage !== true) return { ok: false, reason: "DEPLOYMENT_BINDING_LINEAGE_UNAVAILABLE" };
  return { ok: true, reason: null };
}

function gitSnapshot() {
  const git = process.platform === "win32" ? "git.exe" : "git";
  const status = runReadOnly(git, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const staged = runReadOnly(git, ["diff", "--cached", "--name-only"]);
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
    return { status: response.status, vercelIdPresent: response.headers.has("x-vercel-id"), bodyRead: false };
  } catch (error) {
    return { status: null, vercelIdPresent: false, bodyRead: false, errorClass: error?.constructor?.name ?? "Error" };
  }
}

function parsePreviewKeys(payload) {
  const envs = Array.isArray(payload?.envs) ? payload.envs : [];
  return envs.filter((item) => Array.isArray(item?.target) && item.target.includes("preview") && typeof item.key === "string").map((item) => item.key);
}

async function collectVercelFacts() {
  const cli = process.platform === "win32" ? "vercel.cmd" : "vercel";
  const list = runReadOnly(cli, ["list", "--json", "--limit", "5"]);
  if (list.exitCode !== 0) throw new Error("WP165_VERCEL_LIST_FAILED");
  const listPayload = parseCliJson(list.stdout);
  const deployments = Array.isArray(listPayload?.deployments) ? listPayload.deployments : [];
  const latest = deployments.find((item) => item?.name === EXPECTED_PROJECT);
  if (!latest) throw new Error("WP165_STAGING_DEPLOYMENT_MISSING");

  const inspect = runReadOnly(cli, ["inspect", EXPECTED_ROUTE, "--json"]);
  if (inspect.exitCode !== 0) throw new Error("WP165_ROUTE_INSPECT_FAILED");
  const inspected = parseCliJson(inspect.stdout);
  const envList = runReadOnly(cli, ["env", "ls", "preview", "--json", "--project", EXPECTED_PROJECT]);
  if (envList.exitCode !== 0) throw new Error("WP165_PREVIEW_ENV_METADATA_FAILED");
  const envPayload = parseCliJson(envList.stdout);

  const git = process.platform === "win32" ? "git.exe" : "git";
  const head = runReadOnly(git, ["rev-parse", "HEAD"]);
  const expectedHead = String(head.stdout ?? "").trim();
  const customHost = await headProbe(`${EXPECTED_ROUTE}/api/health`);
  const deploymentUrl = typeof latest.url === "string" ? `https://${latest.url}` : "";
  const deploymentHost = await headProbe(`${deploymentUrl}/api/health`);
  const aliases = Array.isArray(inspected?.aliases) ? inspected.aliases : [];
  const routeResolvesToLatest = typeof inspected?.url === "string" && inspected.url === latest.url && inspected?.readyState === "READY";
  const snapshot = gitSnapshot();
  const previewKeys = parsePreviewKeys(envPayload);

  return {
    facts: {
      projectName: latest.name ?? null,
      deploymentIdPresent: typeof latest.uid === "string" || typeof inspected?.id === "string",
      deploymentState: latest.state ?? inspected?.readyState ?? null,
      readyState: inspected?.readyState ?? latest.state ?? null,
      target: inspected?.target ?? latest.target ?? "",
      route: EXPECTED_ROUTE,
      routeAliasMatched: routeResolvesToLatest || aliases.includes(new URL(EXPECTED_ROUTE).hostname) || aliases.includes(EXPECTED_ROUTE.replace(/^https:\/\//u, "")),
      latestDeploymentUrl: deploymentUrl,
      deployedCommitSha: latest?.meta?.githubCommitSha ?? null,
      headSha: expectedHead,
      workspaceDirty: snapshot.statusLines > 0,
      dirtyWorkspaceClaimedDeployed: false,
      customHostStatus: customHost.status,
      deploymentHostStatus: deploymentHost.status,
      customHostVercelIdPresent: customHost.vercelIdPresent,
      deploymentHostVercelIdPresent: deploymentHost.vercelIdPresent,
      previewBindingPresent: previewKeys.includes(EXPECTED_VARIABLE),
      previewBindingKeyCount: previewKeys.length,
      // Vercel CLI exposes names/targets but not the deployment's environment snapshot.
      deploymentBindingLineage: false,
      deploymentBindingLineageSource: "vercel_cli_name_target_only",
      bodyRead: false,
      cliOutputPersisted: false,
    },
    snapshot,
  };
}

function brokerMetadata(input = {}) {
  return {
    ready: input.ready === true,
    environment: String(input.environment ?? "").toLowerCase(),
    permission: String(input.permission ?? "").toLowerCase(),
    production: input.production === true,
    source: "agent_blind_controlled_broker_metadata_only",
  };
}

function processBrokerMetadata() {
  // Only non-secret broker metadata is read. No URL, token, cookie, or env-file value is inspected.
  return {
    db: brokerMetadata({
      ready: process.env.WP165_STAGING_DB_BROKER_READY === "true",
      environment: process.env.WP165_STAGING_DB_ENVIRONMENT,
      permission: process.env.WP165_STAGING_DB_PERMISSION,
      production: process.env.WP165_STAGING_DB_PRODUCTION === "true",
    }),
    provider: {
      ...brokerMetadata({
        ready: process.env.WP165_PAYUNI_BROKER_READY === "true",
        environment: process.env.WP165_PAYUNI_ENVIRONMENT,
        permission: process.env.WP165_PAYUNI_PERMISSION,
        production: process.env.WP165_PAYUNI_PRODUCTION === "true",
      }),
      officialSandbox: process.env.WP165_PAYUNI_HOST_CLASS === "official_sandbox",
      operation: process.env.WP165_PAYUNI_OPERATION ?? "",
    },
  };
}

function initialReceipt() {
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: WORK_PACKAGE,
    status: "WP165_EXACT_NO_GO_FRESHNESS_OR_IDENTITY_UNSAFE",
    conclusion: "WP165_EXACT_NO_GO_FRESHNESS_OR_IDENTITY_UNSAFE",
    routeIdentity: null,
    previewBinding: { variableName: EXPECTED_VARIABLE, target: "preview", present: false, deploymentLineage: false, lineageSource: "UNCONFIRMED" },
    database: {
      brokerSource: "agent_blind_controlled_broker_metadata_only",
      brokerReady: false,
      environment: "UNCONFIRMED",
      permission: "UNCONFIRMED",
      productionIdentityDetected: false,
      queryAttempted: false,
      queryCount: 0,
      statementClass: "single_select_synthetic_pending_reservation",
      syntheticPendingReservationCount: null,
      providerReferenceDigest: null,
    },
    payuni: {
      brokerReady: false,
      environment: "UNCONFIRMED",
      permission: "UNCONFIRMED",
      officialSandbox: false,
      operation: "UNCONFIRMED",
      lookupAttempted: false,
      lookupCount: 0,
      retryCount: 0,
      providerReferenceDigest: null,
      normalizedStatus: null,
    },
    lineage: { sameEnvironmentGeneration: false, providerReferenceMatches: false, productionIdentityDetected: false },
    quality: { localPreflight: "NOT_RUN", freshness: "NOT_RUN", dbGuard: "NOT_RUN", providerGuard: "NOT_RUN", strictReceiptReadback: "NOT_RUN", preserveOnlyGuard: "NOT_RUN", diffCheck: "NOT_RUN", stagedIndexEmpty: "NOT_RUN" },
    sideEffects: { vercelMetadataReads: 0, routeHeadProbes: 0, databaseQueries: 0, payuniLookups: 0, retries: 0, databaseWrites: 0, providerWrites: 0, payments: 0, refunds: 0, callbackReplays: 0, deploymentWrites: 0, production: 0, bodyReads: 0 },
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
  const required = ["schemaVersion", "workPackage", "status", "conclusion", "routeIdentity", "previewBinding", "database", "payuni", "lineage", "quality", "sideEffects", "ownership", "scoreImpact", "safety", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  for (const key of required) if (!(key in (receipt ?? {}))) errors.push(`MISSING_${key}`);
  if (receipt?.schemaVersion !== SCHEMA_VERSION || receipt?.workPackage !== WORK_PACKAGE) errors.push("SCHEMA");
  if (!["WP165_EXACT_NO_GO_FRESHNESS_OR_IDENTITY_UNSAFE", "WP165_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED"].includes(receipt?.status)) errors.push("STATUS");
  if (receipt?.conclusion !== receipt?.status) errors.push("CONCLUSION");
  if (receipt?.rawOutputPersisted !== false || receipt?.rawOutputExposed !== false || receipt?.sourceEnvContentsRead !== false || receipt?.sanitized !== true) errors.push("SAFETY_FLAGS");
  if (receipt?.safety?.environmentFileRead !== false || receipt?.safety?.rawResponseSaved !== false || receipt?.safety?.rawIdsPersisted !== false || receipt?.safety?.secretsSaved !== false || receipt?.safety?.tokensSaved !== false || receipt?.safety?.cookiesSaved !== false) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.sideEffects?.databaseWrites !== 0 || receipt?.sideEffects?.providerWrites !== 0 || receipt?.sideEffects?.payments !== 0 || receipt?.sideEffects?.refunds !== 0 || receipt?.sideEffects?.callbackReplays !== 0 || receipt?.sideEffects?.deploymentWrites !== 0 || receipt?.sideEffects?.production !== 0 || receipt?.sideEffects?.retries !== 0 || receipt?.sideEffects?.bodyReads !== 0) errors.push("SIDE_EFFECTS");
  if (receipt?.database?.queryCount > 1 || receipt?.payuni?.lookupCount > 1) errors.push("EXACTLY_ONCE");
  if (!safeDigest(receipt?.canonicalDigest) && receipt?.canonicalDigest !== null) errors.push("DIGEST");
  if (receipt?.previewBinding?.variableName !== EXPECTED_VARIABLE || receipt?.previewBinding?.target !== "preview") errors.push("PREVIEW_BINDING_SCOPE");
  const serialized = JSON.stringify(receipt);
  // Safety flag names such as rawResponseSaved/tokenSaved are allowed; only reject
  // actual raw payload fields or credential-shaped values.
  if (/(?:postgres(?:ql)?:\/\/|Bearer\s+|BEGIN PRIVATE)/iu.test(serialized) || /"raw(?:Response|Payload)"\s*:\s*(?!null|false)/iu.test(serialized)) errors.push("SENSITIVE_TEXT");
  return { ok: errors.length === 0, errors };
}

function protectedPathCheck(before, after) {
  const beforeLines = new Set((before?.statusText ?? "").split(/\r?\n/u).filter(Boolean));
  const afterLines = new Set((after?.statusText ?? "").split(/\r?\n/u).filter(Boolean));
  const changed = [...beforeLines].filter((line) => !afterLines.has(line)).concat([...afterLines].filter((line) => !beforeLines.has(line)));
  const unknown = changed.filter((line) => !ADDITIONAL_PATHS.has(normalizePath(line.slice(3))));
  return { unchanged: unknown.length === 0, unknown };
}

export async function runWp165({ routeFacts = null, expectedHead = null, dbBroker = null, providerBroker = null, queryDatabase = null, lookupPayUni = null } = {}) {
  const receipt = initialReceipt();
  const before = gitSnapshot();
  receipt.ownership.before = { statusFingerprint: before.statusFingerprint, statusLines: before.statusLines, stagedIndexEmpty: before.stagedIndexEmpty };
  const brokers = { db: dbBroker ?? processBrokerMetadata().db, provider: providerBroker ?? processBrokerMetadata().provider };
  try {
    if (!routeFacts) {
      const collected = await collectVercelFacts();
      routeFacts = collected.facts;
      expectedHead = routeFacts.headSha;
      receipt.sideEffects.vercelMetadataReads = 3;
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
    receipt.previewBinding = {
      variableName: EXPECTED_VARIABLE,
      target: "preview",
      present: routeFacts.previewBindingPresent === true,
      deploymentLineage: routeFacts.deploymentBindingLineage === true,
      lineageSource: routeFacts.deploymentBindingLineageSource ?? "UNCONFIRMED",
    };
    receipt.quality.localPreflight = validateSingleSelect(SYNTHETIC_PENDING_SQL) ? "PASS" : "FAIL";
    receipt.quality.dbGuard = receipt.quality.localPreflight;
    const freshness = validateFreshness(routeFacts, expectedHead ?? routeFacts.headSha);
    receipt.quality.freshness = freshness.ok ? "PASS" : "FAIL";
    if (!freshness.ok) throw new Error(freshness.reason);

    receipt.database = { ...receipt.database, brokerReady: brokers.db.ready, environment: brokers.db.environment || "UNCONFIRMED", permission: brokers.db.permission || "UNCONFIRMED", productionIdentityDetected: brokers.db.production === true };
    receipt.payuni = { ...receipt.payuni, brokerReady: brokers.provider.ready, environment: brokers.provider.environment || "UNCONFIRMED", permission: brokers.provider.permission || "UNCONFIRMED", officialSandbox: brokers.provider.officialSandbox === true, operation: brokers.provider.operation || "UNCONFIRMED" };
    if (!brokers.db.ready || brokers.db.environment !== "staging" || brokers.db.permission !== "read_only" || brokers.db.production) throw new Error("STAGING_DB_BROKER_IDENTITY_UNCONFIRMED");
    receipt.quality.providerGuard = brokers.provider.ready && brokers.provider.environment === "sandbox" && brokers.provider.permission === "read_only" && brokers.provider.officialSandbox && brokers.provider.operation === "READ_ONLY_TRANSACTION_LOOKUP" && !brokers.provider.production ? "PASS" : "FAIL";
    if (receipt.quality.providerGuard !== "PASS") throw new Error("PAYUNI_SANDBOX_BROKER_IDENTITY_UNCONFIRMED");
    if (typeof queryDatabase !== "function") throw new Error("STAGING_DB_SECRET_BROKER_EXECUTION_CHANNEL_UNAVAILABLE");
    receipt.database.queryAttempted = true;
    receipt.database.queryCount = 1;
    receipt.sideEffects.databaseQueries = 1;
    const rows = await queryDatabase(SYNTHETIC_PENDING_SQL);
    if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.provider_reference !== "string" || !rows[0].provider_reference) throw new Error("SYNTHETIC_PENDING_RESERVATION_COUNT_NOT_ONE");
    receipt.database.syntheticPendingReservationCount = rows.length;
    receipt.database.providerReferenceDigest = sha256(rows[0].provider_reference);
    if (typeof lookupPayUni !== "function") throw new Error("PAYUNI_SECRET_BROKER_EXECUTION_CHANNEL_UNAVAILABLE");
    receipt.payuni.lookupAttempted = true;
    receipt.payuni.lookupCount = 1;
    receipt.sideEffects.payuniLookups = 1;
    const providerResult = await lookupPayUni(rows[0].provider_reference);
    if (!providerResult || typeof providerResult.providerReference !== "string" || !providerResult.providerReference) throw new Error("PAYUNI_LOOKUP_REFERENCE_MISSING");
    receipt.payuni.providerReferenceDigest = sha256(providerResult.providerReference);
    receipt.payuni.normalizedStatus = typeof providerResult.status === "string" ? providerResult.status : null;
    receipt.lineage.providerReferenceMatches = receipt.database.providerReferenceDigest === receipt.payuni.providerReferenceDigest;
    receipt.lineage.sameEnvironmentGeneration = receipt.routeIdentity.deployedCommitMatchesHead && receipt.previewBinding.deploymentLineage && brokers.db.environment === "staging" && brokers.provider.environment === "sandbox";
    if (!receipt.lineage.sameEnvironmentGeneration || !receipt.lineage.providerReferenceMatches || !receipt.payuni.normalizedStatus) throw new Error("LIVE_RECONCILIATION_LINEAGE_MISMATCH");
    receipt.status = "WP165_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED";
  } catch (error) {
    receipt.failure = receipt.failure ?? (error?.message ?? "WP165_EXTERNAL_READ_FAILED");
  }
  const after = gitSnapshot();
  const protectedCheck = protectedPathCheck(before, after);
  receipt.ownership.after = { statusFingerprint: after.statusFingerprint, statusLines: after.statusLines, stagedIndexEmpty: after.stagedIndexEmpty };
  receipt.ownership.statusFingerprintUnchanged = before.statusFingerprint === after.statusFingerprint;
  receipt.ownership.protectedUnchanged = protectedCheck.unchanged;
  receipt.ownership.unknown = protectedCheck.unknown.length;
  receipt.ownership.stagedIndexEmpty = after.stagedIndexEmpty;
  receipt.quality.preserveOnlyGuard = protectedCheck.unchanged && receipt.ownership.unknown === 0 ? "PASS" : "FAIL";
  receipt.quality.diffCheck = receipt.quality.preserveOnlyGuard;
  receipt.quality.stagedIndexEmpty = after.stagedIndexEmpty ? "PASS" : "FAIL";
  receipt.safety.productionIdentityDetected = Boolean(receipt.routeIdentity?.target === "production" || receipt.database.productionIdentityDetected || receipt.payuni.productionIdentityDetected || receipt.lineage.productionIdentityDetected);
  receipt.lineage.productionIdentityDetected = receipt.safety.productionIdentityDetected;
  receipt.safety.dirtyWorkspaceClaimedDeployed = receipt.routeIdentity?.dirtyWorkspaceClaimedDeployed === true;
  receipt.conclusion = receipt.status;
  receipt.canonicalDigest = sha256(canonical({ ...receipt, canonicalDigest: null, quality: { ...receipt.quality, strictReceiptReadback: "PENDING" } }));
  const validation = validateReceipt(receipt);
  receipt.quality.strictReceiptReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) receipt.failure = receipt.failure ?? `WP165_RECEIPT_INVALID:${validation.errors.join(",")}`;
  if (receipt.status === "WP165_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED" && receipt.failure) receipt.status = "WP165_EXACT_NO_GO_FRESHNESS_OR_IDENTITY_UNSAFE";
  receipt.conclusion = receipt.status;
  receipt.canonicalDigest = sha256(canonical({ ...receipt, canonicalDigest: null }));
  return receipt;
}

async function writeExclusive(filePath, content) {
  if (fs.existsSync(filePath)) throw new Error("WP165_RECEIPT_ALREADY_EXISTS");
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
  runWp165()
    .then(async (receipt) => {
      const reportPath = path.join(ROOT, ".ai-team", "reports", "wp165-live-sandbox-reconciliation.json");
      const evidencePath = path.join(ROOT, "docs", "ai-team", "evidence", "wp-165-live-sandbox-reconciliation.md");
      const evidence = [
        "# WP-165 Fresh Preview Runtime＋Live Sandbox Reconciliation",
        "",
        `- status: \`${receipt.status}\``,
        `- route/deployment: ${receipt.routeIdentity?.route ?? "UNCONFIRMED"}／${receipt.routeIdentity?.readyState ?? "UNCONFIRMED"}／target=${receipt.routeIdentity?.target ?? "UNCONFIRMED"}`,
        `- Preview binding name/target: ${receipt.previewBinding.variableName}/${receipt.previewBinding.target}`,
        `- deployment-specific binding lineage: \`${receipt.previewBinding.deploymentLineage}\`（Vercel CLI name/target metadata insufficient）`,
        `- DB query count／PayUni lookup count: \`${receipt.database.queryCount}/${receipt.payuni.lookupCount}\``,
        `- deployment／DB write／provider write／payment／refund／callback replay: \`${receipt.sideEffects.deploymentWrites}/${receipt.sideEffects.databaseWrites}/${receipt.sideEffects.providerWrites}/${receipt.sideEffects.payments}/${receipt.sideEffects.refunds}/${receipt.sideEffects.callbackReplays}\``,
        `- failure: \`${receipt.failure ?? "none"}\``,
        "",
        "本 receipt 僅保存遮罩化狀態與 digest；未保存 raw response、識別碼、secret、token、cookie 或 .env 內容。",
      ].join("\n");
      await writeExclusive(reportPath, JSON.stringify(receipt));
      await writeExclusive(evidencePath, evidence);
      process.stdout.write(JSON.stringify({ workPackage: WORK_PACKAGE, status: receipt.status, failure: receipt.failure, dbQueryCount: receipt.database.queryCount, payuniLookupCount: receipt.payuni.lookupCount }) + "\n");
      if (receipt.status !== "WP165_CAT04_LIVE_SANDBOX_RECONCILIATION_VERIFIED") process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(JSON.stringify({ workPackage: WORK_PACKAGE, status: "WP165_RUNNER_ERROR", errorClass: error?.constructor?.name ?? "Error" }) + "\n");
      process.exitCode = 1;
    });
}
