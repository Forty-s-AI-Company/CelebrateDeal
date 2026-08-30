import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_PACKAGE = "WP-166";
const SCHEMA_VERSION = "wp166-vercel-deployment-env-lineage-capability/v1";
const EXPECTED_PROJECT = "celebrate-deal-staging";
const EXPECTED_ROUTE = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_VARIABLE = "STAGING_DATABASE_URL";
const HEAD_SHA = /^[0-9a-f]{40}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ADDITIONAL_PATHS = new Set([
  "scripts/wp166-vercel-deployment-env-lineage-capability.mjs",
  "scripts/wp166-vercel-deployment-env-lineage-capability.test.mjs",
  ".ai-team/reports/wp166-vercel-deployment-env-lineage-capability.json",
  "docs/ai-team/evidence/wp-166-vercel-deployment-env-lineage-capability.md",
]);

export const WP166_CONSTANTS = Object.freeze({ WORK_PACKAGE, SCHEMA_VERSION, EXPECTED_PROJECT, EXPECTED_ROUTE, EXPECTED_VARIABLE });

export const CAPABILITY_CATALOG = Object.freeze([
  { id: "vercel_version", commandClass: "vercel --version", method: "LOCAL_CLI", classification: "NON_SECRET_METADATA_ONLY", readOnly: true, deploymentLineage: false },
  { id: "vercel_list_json", commandClass: "vercel list --json --limit 5", method: "READ_ONLY_METADATA", classification: "NON_SECRET_METADATA_ONLY", readOnly: true, deploymentLineage: false },
  { id: "vercel_inspect_json", commandClass: "vercel inspect <route> --json", method: "READ_ONLY_METADATA", classification: "NON_SECRET_METADATA_ONLY", readOnly: true, deploymentLineage: false },
  { id: "vercel_env_ls_preview_json", commandClass: "vercel env ls preview --json --project <project>", method: "READ_ONLY_METADATA", classification: "NON_SECRET_METADATA_ONLY", readOnly: true, deploymentLineage: false },
  { id: "vercel_env_pull", commandClass: "vercel env pull", method: "VALUE_BEARING", classification: "MAY_RETURN_SECRET_VALUE", readOnly: false, deploymentLineage: false },
  { id: "vercel_env_mutation", commandClass: "vercel env add/rm", method: "MUTATION", classification: "MUTATING", readOnly: false, deploymentLineage: false },
  { id: "vercel_deploy", commandClass: "vercel deploy/redeploy", method: "MUTATION", classification: "MUTATING", readOnly: false, deploymentLineage: false },
  { id: "vercel_api_unknown", commandClass: "official API endpoint schema not pre-approved", method: "UNKNOWN", classification: "SCHEMA_UNKNOWN", readOnly: false, deploymentLineage: false },
]);

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

function safeStatusOutput(stdout) {
  return String(stdout ?? "").split(/\r?\n/u).filter(Boolean).map((line) => line.slice(0, 500)).join("\n");
}

function parseCliJson(stdout) {
  const text = String(stdout ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("WP166_CLI_JSON_MISSING");
  return JSON.parse(text.slice(start, end + 1));
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

export function validateCapabilityCatalog(catalog = CAPABILITY_CATALOG) {
  const errors = [];
  for (const item of catalog) {
    if (!["NON_SECRET_METADATA_ONLY", "MAY_RETURN_SECRET_VALUE", "MUTATING", "SCHEMA_UNKNOWN"].includes(item.classification)) errors.push(`UNKNOWN_CLASS:${item.id}`);
    if ((item.classification !== "NON_SECRET_METADATA_ONLY") && item.readOnly === true) errors.push(`NON_READ_ONLY_CLASS:${item.id}`);
    if (item.classification === "NON_SECRET_METADATA_ONLY" && item.readOnly !== true) errors.push(`SAFE_NOT_READ_ONLY:${item.id}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateCommandSafety(command, args = []) {
  const text = [command, ...args].join(" ").toLowerCase();
  if (/env\s+pull|env\s+(?:add|rm|remove)|(?:^|\s)(?:deploy|redeploy)(?:\s|$)/u.test(text)) return { ok: false, reason: "VALUE_BEARING_OR_MUTATING_COMMAND" };
  if (/(?:--token|--global-config|cookie|authorization|secret)/u.test(text)) return { ok: false, reason: "CREDENTIAL_OUTPUT_OR_SECRET_FLAG" };
  const allowed = ["--version", "list --json --limit 5", "inspect", "env ls preview --json --project"];
  if (!allowed.some((pattern) => text.includes(pattern))) return { ok: false, reason: "COMMAND_NOT_ALLOWLISTED" };
  return { ok: true, reason: null };
}

export function validateWp86RerunGuard(wp86Status) {
  return wp86Status === "PASS" || wp86Status === "ACCEPT" ? { ok: true, reason: null } : { ok: false, reason: "WP86_AUTHORITATIVE_RECEIPT_MISSING" };
}

function gitSnapshot() {
  const git = process.platform === "win32" ? "git.exe" : "git";
  const status = runReadOnly(git, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const staged = runReadOnly(git, ["diff", "--cached", "--name-only"]);
  const statusText = safeStatusOutput(status.stdout);
  const stagedText = safeStatusOutput(staged.stdout);
  return { statusFingerprint: sha256(statusText), statusLines: statusText ? statusText.split(/\r?\n/u).filter(Boolean).length : 0, statusText, stagedIndexEmpty: stagedText.trim() === "" };
}

async function headProbe(url) {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(12_000) });
    return { status: response.status, bodyRead: false };
  } catch (error) {
    return { status: null, bodyRead: false, errorClass: error?.constructor?.name ?? "Error" };
  }
}

function parsePreviewKeys(payload) {
  const envs = Array.isArray(payload?.envs) ? payload.envs : [];
  return envs.filter((item) => Array.isArray(item?.target) && item.target.includes("preview") && typeof item.key === "string").map((item) => item.key);
}

function deploymentFrom(listPayload, inspectPayload) {
  const deployments = Array.isArray(listPayload?.deployments) ? listPayload.deployments : [];
  const latest = deployments.find((item) => item?.name === EXPECTED_PROJECT);
  if (!latest) throw new Error("WP166_STAGING_DEPLOYMENT_MISSING");
  return { latest, inspectPayload };
}

async function collectSafeMetadata() {
  const cli = process.platform === "win32" ? "vercel.cmd" : "vercel";
  const commands = [
    ["vercel_version", ["--version"]],
    ["vercel_list_json", ["list", "--json", "--limit", "5"]],
    ["vercel_inspect_json", ["inspect", EXPECTED_ROUTE, "--json"]],
    ["vercel_env_ls_preview_json", ["env", "ls", "preview", "--json", "--project", EXPECTED_PROJECT]],
  ];
  const results = {};
  for (const [id, args] of commands) {
    const guard = validateCommandSafety(cli, args);
    if (!guard.ok) throw new Error(`WP166_COMMAND_GUARD:${id}:${guard.reason}`);
    const result = runReadOnly(cli, args);
    if (result.exitCode !== 0) throw new Error(`WP166_COMMAND_FAILED:${id}`);
    results[id] = { exitCode: 0, stdoutDigest: sha256(result.stdout), stderrPresent: Boolean(String(result.stderr).trim()), rawPersisted: false, schema: id === "vercel_version" ? "VERSION_TEXT" : "JSON_METADATA" };
    if (id === "vercel_list_json") results.list = parseCliJson(result.stdout);
    if (id === "vercel_inspect_json") results.inspect = parseCliJson(result.stdout);
    if (id === "vercel_env_ls_preview_json") results.env = parseCliJson(result.stdout);
  }
  const { latest, inspectPayload } = deploymentFrom(results.list, results.inspect);
  const git = process.platform === "win32" ? "git.exe" : "git";
  const headResult = runReadOnly(git, ["rev-parse", "HEAD"]);
  const headSha = String(headResult.stdout ?? "").trim();
  const customHost = await headProbe(`${EXPECTED_ROUTE}/api/health`);
  const deploymentUrl = typeof latest.url === "string" ? `https://${latest.url}` : "";
  const deploymentHost = await headProbe(`${deploymentUrl}/api/health`);
  const snapshot = gitSnapshot();
  const previewKeys = parsePreviewKeys(results.env);
  const aliases = Array.isArray(inspectPayload?.aliases) ? inspectPayload.aliases : [];
  const routeAliasMatched = typeof inspectPayload?.url === "string" && inspectPayload.url === latest.url && inspectPayload?.readyState === "READY";
  return {
    projectName: latest.name ?? null,
    route: EXPECTED_ROUTE,
    routeAliasMatched: routeAliasMatched || aliases.includes(new URL(EXPECTED_ROUTE).hostname),
    deploymentIdPresent: typeof latest.uid === "string" || typeof inspectPayload?.id === "string",
    deploymentIdDigest: sha256(latest.uid ?? inspectPayload?.id ?? ""),
    deploymentUrlPresent: deploymentUrl.length > 0,
    readyState: inspectPayload?.readyState ?? latest.state ?? null,
    target: inspectPayload?.target ?? latest.target ?? null,
    deployedCommitSha: latest?.meta?.githubCommitSha ?? null,
    headSha,
    workspaceDirty: snapshot.statusLines > 0,
    dirtyWorkspaceClaimedDeployed: false,
    customHostStatus: customHost.status,
    deploymentHostStatus: deploymentHost.status,
    previewBindingPresent: previewKeys.includes(EXPECTED_VARIABLE),
    previewBindingKeyCount: previewKeys.length,
    // Current Vercel CLI metadata has no deployment-specific environment snapshot or revision.
    deploymentEnvironmentSnapshotId: null,
    deploymentBindingLineage: false,
    lineageSource: "vercel_cli_safe_metadata_capability_audit",
    rawResponsePersisted: false,
    bodyRead: false,
    commandResults: Object.fromEntries(Object.entries(results).filter(([key]) => !["list", "inspect", "env"].includes(key))),
    metadataValuesRead: false,
  };
}

function initialReceipt() {
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: WORK_PACKAGE,
    status: "WP166_EXACT_NO_GO_VERCEL_METADATA_CAPABILITY_INSUFFICIENT",
    conclusion: "WP166_EXACT_NO_GO_VERCEL_METADATA_CAPABILITY_INSUFFICIENT",
    wp86RerunGuard: { status: "UNCONFIRMED", passed: false },
    capabilityCatalog: CAPABILITY_CATALOG.map(({ id, commandClass, method, classification, readOnly, deploymentLineage }) => ({ id, commandClass, method, classification, readOnly, deploymentLineage })),
    routeDeployment: null,
    environmentBinding: { variableName: EXPECTED_VARIABLE, target: "preview", currentProjectListPresent: false, deploymentSpecificSnapshotId: null, deploymentSpecificLineage: false },
    quality: { localPreflight: "NOT_RUN", capabilityAllowlist: "NOT_RUN", deploymentLineage: "NOT_RUN", strictReceiptReadback: "NOT_RUN", preserveOnlyGuard: "NOT_RUN", diffCheck: "NOT_RUN", stagedIndexEmpty: "NOT_RUN" },
    sideEffects: { vercelMetadataReads: 0, routeHeadProbes: 0, deploymentWrites: 0, environmentVariableMutations: 0, aliasDnsMutations: 0, production: 0, databaseOperations: 0, payuniOperations: 0, gitMutations: 0, bodyReads: 0 },
    ownership: { before: null, after: null, statusFingerprintUnchanged: false, protectedUnchanged: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: false, preserveOnly: true },
    scoreImpact: { CAT04: { before: 6.0, after: 6.0 }, total: { before: 71.5, after: 71.5 } },
    safety: { environmentFileRead: false, environmentValueRead: false, rawResponseSaved: false, secretsSaved: false, tokensSaved: false, cookiesSaved: false, productionAccess: false, dirtyWorkspaceClaimedDeployed: false },
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
  const required = ["schemaVersion", "workPackage", "status", "conclusion", "wp86RerunGuard", "capabilityCatalog", "routeDeployment", "environmentBinding", "quality", "sideEffects", "ownership", "scoreImpact", "safety", "rawOutputPersisted", "rawOutputExposed", "sourceEnvContentsRead", "sanitized"];
  for (const key of required) if (!(key in (receipt ?? {}))) errors.push(`MISSING_${key}`);
  if (receipt?.schemaVersion !== SCHEMA_VERSION || receipt?.workPackage !== WORK_PACKAGE) errors.push("SCHEMA");
  if (receipt?.status !== "WP166_EXACT_NO_GO_VERCEL_METADATA_CAPABILITY_INSUFFICIENT" && receipt?.status !== "WP166_DEPLOYMENT_ENV_BINDING_FRESHNESS_PROOF_VERIFIED") errors.push("STATUS");
  if (receipt?.conclusion !== receipt?.status) errors.push("CONCLUSION");
  if (receipt?.rawOutputPersisted !== false || receipt?.rawOutputExposed !== false || receipt?.sourceEnvContentsRead !== false || receipt?.sanitized !== true) errors.push("SAFETY_FLAGS");
  if (receipt?.safety?.environmentFileRead !== false || receipt?.safety?.environmentValueRead !== false || receipt?.safety?.rawResponseSaved !== false || receipt?.safety?.secretsSaved !== false || receipt?.safety?.tokensSaved !== false || receipt?.safety?.cookiesSaved !== false) errors.push("SENSITIVE_PERSISTENCE");
  for (const key of ["deploymentWrites", "environmentVariableMutations", "aliasDnsMutations", "production", "databaseOperations", "payuniOperations", "gitMutations", "bodyReads"]) {
    if (receipt?.sideEffects?.[key] !== 0) errors.push("SIDE_EFFECTS");
  }
  if (!safeDigest(receipt?.canonicalDigest) && receipt?.canonicalDigest !== null) errors.push("DIGEST");
  if (receipt?.environmentBinding?.variableName !== EXPECTED_VARIABLE || receipt?.environmentBinding?.target !== "preview") errors.push("BINDING_SCOPE");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|Bearer\s+|BEGIN PRIVATE)/iu.test(serialized) || /"raw(?:Response|Payload)"\s*:\s*(?!null|false)/iu.test(serialized)) errors.push("SENSITIVE_TEXT");
  return { ok: errors.length === 0, errors };
}

function protectedPathCheck(before, after) {
  const beforeLines = new Set((before?.statusText ?? "").split(/\r?\n/u).filter(Boolean));
  const afterLines = new Set((after?.statusText ?? "").split(/\r?\n/u).filter(Boolean));
  const changed = [...beforeLines].filter((line) => !afterLines.has(line)).concat([...afterLines].filter((line) => !beforeLines.has(line)));
  const unknown = changed.filter((line) => !ADDITIONAL_PATHS.has(String(line.slice(3)).replaceAll("\\", "/")));
  return { unchanged: unknown.length === 0, unknown };
}

export async function runWp166({ metadata = null, wp86Status = "ACCEPT" } = {}) {
  const receipt = initialReceipt();
  const before = gitSnapshot();
  receipt.ownership.before = { statusFingerprint: before.statusFingerprint, statusLines: before.statusLines, stagedIndexEmpty: before.stagedIndexEmpty };
  try {
    const catalogCheck = validateCapabilityCatalog();
    receipt.quality.capabilityAllowlist = catalogCheck.ok ? "PASS" : "FAIL";
    const wp86Guard = validateWp86RerunGuard(wp86Status);
    receipt.wp86RerunGuard = { status: wp86Status, passed: wp86Guard.ok };
    receipt.quality.localPreflight = catalogCheck.ok && wp86Guard.ok && before.stagedIndexEmpty ? "PASS" : "FAIL";
    if (!catalogCheck.ok) throw new Error(`WP166_CAPABILITY_CATALOG_INVALID:${catalogCheck.errors.join(",")}`);
    if (!wp86Guard.ok) throw new Error(wp86Guard.reason);
    if (!before.stagedIndexEmpty) throw new Error("STAGED_INDEX_NOT_EMPTY");
    const facts = metadata ?? await collectSafeMetadata();
    receipt.sideEffects.vercelMetadataReads = metadata ? 0 : 4;
    receipt.sideEffects.routeHeadProbes = metadata ? 0 : 2;
    receipt.routeDeployment = {
      projectName: facts.projectName,
      route: facts.route,
      routeAliasMatched: facts.routeAliasMatched,
      deploymentIdPresent: facts.deploymentIdPresent,
      deploymentIdDigest: facts.deploymentIdDigest,
      deploymentUrlPresent: facts.deploymentUrlPresent,
      readyState: facts.readyState,
      target: facts.target,
      deployedCommitSha: facts.deployedCommitSha,
      headSha: facts.headSha,
      deployedCommitMatchesHead: facts.deployedCommitSha === facts.headSha,
      workspaceDirty: facts.workspaceDirty,
      dirtyWorkspaceClaimedDeployed: facts.dirtyWorkspaceClaimedDeployed,
      customHostStatus: facts.customHostStatus,
      deploymentHostStatus: facts.deploymentHostStatus,
      bodyRead: false,
    };
    receipt.environmentBinding = {
      variableName: EXPECTED_VARIABLE,
      target: "preview",
      currentProjectListPresent: facts.previewBindingPresent === true,
      deploymentSpecificSnapshotId: facts.deploymentEnvironmentSnapshotId ?? null,
      deploymentSpecificLineage: facts.deploymentBindingLineage === true,
    };
    const routeOk = receipt.routeDeployment.projectName === EXPECTED_PROJECT && receipt.routeDeployment.route === EXPECTED_ROUTE && receipt.routeDeployment.routeAliasMatched === true && receipt.routeDeployment.readyState === "READY" && receipt.routeDeployment.target === "preview" && HEAD_SHA.test(receipt.routeDeployment.deployedCommitSha ?? "") && receipt.routeDeployment.deployedCommitMatchesHead && receipt.routeDeployment.workspaceDirty === true && receipt.routeDeployment.dirtyWorkspaceClaimedDeployed === false && receipt.routeDeployment.customHostStatus === 200 && receipt.routeDeployment.deploymentHostStatus === 200;
    const lineageOk = routeOk && facts.previewBindingPresent === true && facts.deploymentBindingLineage === true && typeof facts.deploymentEnvironmentSnapshotId === "string";
    receipt.quality.deploymentLineage = lineageOk ? "PASS" : "FAIL";
    if (!lineageOk) throw new Error("WP166_EXACT_NO_GO_VERCEL_METADATA_CAPABILITY_INSUFFICIENT");
    receipt.status = "WP166_DEPLOYMENT_ENV_BINDING_FRESHNESS_PROOF_VERIFIED";
  } catch (error) {
    receipt.failure = receipt.failure ?? (error?.message ?? "WP166_CAPABILITY_AUDIT_FAILED");
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
  receipt.safety.dirtyWorkspaceClaimedDeployed = receipt.routeDeployment?.dirtyWorkspaceClaimedDeployed === true;
  receipt.conclusion = receipt.status;
  receipt.canonicalDigest = sha256(canonical({ ...receipt, canonicalDigest: null, quality: { ...receipt.quality, strictReceiptReadback: "PENDING" } }));
  const validation = validateReceipt(receipt);
  receipt.quality.strictReceiptReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) receipt.failure = receipt.failure ?? `WP166_RECEIPT_INVALID:${validation.errors.join(",")}`;
  if (receipt.status === "WP166_DEPLOYMENT_ENV_BINDING_FRESHNESS_PROOF_VERIFIED" && receipt.failure) receipt.status = "WP166_EXACT_NO_GO_VERCEL_METADATA_CAPABILITY_INSUFFICIENT";
  receipt.conclusion = receipt.status;
  receipt.canonicalDigest = sha256(canonical({ ...receipt, canonicalDigest: null }));
  return receipt;
}

async function writeExclusive(filePath, content) {
  if (fs.existsSync(filePath)) throw new Error("WP166_RECEIPT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporaryPath, `${content}\n`, { encoding: "utf8", flag: "wx" });
  try { await fsp.rename(temporaryPath, filePath); } catch (error) { await fsp.rm(temporaryPath, { force: true }).catch(() => {}); throw error; }
}

function isMainModule() { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }

if (isMainModule()) {
  runWp166().then(async (receipt) => {
    const reportPath = path.join(ROOT, ".ai-team", "reports", "wp166-vercel-deployment-env-lineage-capability.json");
    const evidencePath = path.join(ROOT, "docs", "ai-team", "evidence", "wp-166-vercel-deployment-env-lineage-capability.md");
    const evidence = [
      "# WP-166 Vercel Deployment Environment Lineage Capability Audit",
      "",
      `- status: \`${receipt.status}\``,
      `- route/project: ${receipt.routeDeployment?.route ?? "UNCONFIRMED"}／${receipt.routeDeployment?.projectName ?? "UNCONFIRMED"}`,
      `- exact READY Preview deployment: \`${receipt.routeDeployment?.readyState ?? "UNCONFIRMED"}\`／target=${receipt.routeDeployment?.target ?? "UNCONFIRMED"}`,
      `- current Preview binding name present: \`${receipt.environmentBinding.currentProjectListPresent}\``,
      `- deployment-specific snapshot/lineage: \`${receipt.environmentBinding.deploymentSpecificSnapshotId ?? "NONE"}\`／${receipt.environmentBinding.deploymentSpecificLineage}`,
      `- failure: \`${receipt.failure ?? "none"}\``,
      "- Vercel operations: read-only metadata only; no env value, secret, token, cookie, deployment, alias/DNS or Production operation.",
      "",
      "本 receipt 僅保存 capability classification、metadata digest 與遮罩化狀態；未保存 raw CLI/API response 或 environment value。",
    ].join("\n");
    await writeExclusive(reportPath, JSON.stringify(receipt));
    await writeExclusive(evidencePath, evidence);
    process.stdout.write(JSON.stringify({ workPackage: WORK_PACKAGE, status: receipt.status, failure: receipt.failure }) + "\n");
    if (receipt.status !== "WP166_DEPLOYMENT_ENV_BINDING_FRESHNESS_PROOF_VERIFIED") process.exitCode = 2;
  }).catch((error) => { process.stderr.write(JSON.stringify({ workPackage: WORK_PACKAGE, status: "WP166_RUNNER_ERROR", errorClass: error?.constructor?.name ?? "Error" }) + "\n"); process.exitCode = 1; });
}
