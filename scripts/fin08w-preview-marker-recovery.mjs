import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08w-preview-marker-recovery.json");
const FIN08V_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08v-preview-marker-deployment-verification.json");
const FIN08V_EVIDENCE = path.join(ROOT, "docs", "ai-team", "evidence", "fin-08v-preview-marker-deployment-verification.md");
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const VERCEL_JS = "C:\\nvm4w\\nodejs\\node_modules\\vercel\\dist\\index.js";
const PROTECTED_FILES = Object.freeze([
  "src/app/__celebratedeal_wp187_fingerprint.json/route.ts",
  "src/app/__celebratedeal_wp187_fingerprint.json/route.test.ts",
  "docs/codex-goal/API_CONTRACT_REGISTRY.md",
]);
const SYSTEM_ENV = Object.freeze([
  "SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "SystemDrive",
  "NVM_HOME", "NUMBER_OF_PROCESSORS", "OS",
]);
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const V2_KEYS = Object.freeze([
  "baseSourceDigest", "baseWorkPackage", "remediationWorkPackage", "schemaVersion", "sourceDigestSemantics",
].sort());
const TERMINAL_STATUSES = new Set([
  "FIN08W_PREVIEW_MARKER_RECOVERED_VERIFIED",
  "FIN08W_TERMINAL_NO_GO_PRECHECK",
  "FIN08W_TERMINAL_NO_GO_METADATA",
  "FIN08W_TERMINAL_NO_GO_MARKER",
  "FIN08W_TERMINAL_NO_GO_RECEIPT",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(kind, value) {
  return `sha256:${crypto.createHash("sha256").update(`FIN08W/v1/${kind}/${String(value)}`, "utf8").digest("hex")}`;
}

function sha256File(filename) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex")}`;
}

export function buildMetadataArgs(project = PROJECT, scope = SCOPE) {
  return ["list", project, "--json", "--limit", "20", "--status", "READY", "--scope", scope, "--no-color"];
}

export function buildSafeEnvironment(source = process.env) {
  const environment = Object.create(null);
  for (const key of SYSTEM_ENV) if (typeof source?.[key] === "string") environment[key] = source[key];
  return environment;
}

export function parseJsonObject(raw) {
  try {
    const text = String(raw ?? "").trim();
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const value = JSON.parse(lines.at(-1) ?? text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.deployments)) return value.deployments;
  return [];
}

function deploymentIdentity(value) {
  return typeof value?.uid === "string" ? value.uid : typeof value?.id === "string" ? value.id : null;
}

function deploymentUrl(value) {
  const candidate = typeof value?.url === "string" ? value.url : typeof value?.deploymentUrl === "string" ? value.deploymentUrl : null;
  try {
    const parsed = new URL(candidate ?? "");
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".vercel.app") || parsed.username || parsed.password || parsed.port) return null;
    return parsed.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function readyState(value) {
  return String(value?.readyState ?? value?.state ?? value?.status ?? "").toUpperCase() === "READY";
}

function createdAt(value) {
  const raw = value?.createdAt ?? value?.created ?? value?.created_at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw < 10_000_000_000 ? raw * 1000 : raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parseCandidates(raw, exitCode, { windowStart = null, windowEnd = null, expectedDigest = null } = {}) {
  const parsed = parseJsonObject(raw);
  const candidates = [];
  if (exitCode !== 0) return { parseOk: false, candidates };
  for (const value of asArray(parsed)) {
    const identity = deploymentIdentity(value);
    const url = deploymentUrl(value);
    const timestamp = createdAt(value);
    const projectMatched = value?.name === PROJECT || value?.projectName === PROJECT;
    const preview = value?.target === "preview" || value?.target === null || typeof value?.target === "undefined";
    const nonProduction = value?.target !== "production";
    const ready = readyState(value);
    const inWindow = Number.isFinite(timestamp) && Number.isFinite(windowStart) && Number.isFinite(windowEnd)
      && timestamp >= windowStart && timestamp <= windowEnd;
    const identityDigest = identity ? digest("deployment", identity) : null;
    const digestMatched = expectedDigest ? identityDigest === expectedDigest : false;
    if (projectMatched && preview && nonProduction && ready && inWindow && url && identity && (!expectedDigest || digestMatched)) {
      candidates.push({ identityDigest, url, createdAtBucket: Math.floor(timestamp / 60_000) });
    }
  }
  return { parseOk: Boolean(parsed), candidates };
}

export function validateV2Payload(value, expectedBaseDigest) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join("\u0000") !== V2_KEYS.join("\u0000")) return false;
  return value.schemaVersion === "celebratedeal-preview-lineage/v2"
    && value.baseWorkPackage === "WP-187"
    && typeof value.baseSourceDigest === "string"
    && SAFE_DIGEST.test(value.baseSourceDigest)
    && value.baseSourceDigest === expectedBaseDigest
    && value.remediationWorkPackage === "FIN-08U"
    && value.sourceDigestSemantics === "wp187_base_lineage";
}

export function validateMarkerResponse({ method, status, redirected = false, location = null, headers = {}, payload = null, bodyEmpty = false, expectedBaseDigest }) {
  const cacheControl = String(headers.cacheControl ?? "").toLowerCase();
  const nosniff = String(headers.contentTypeOptions ?? "").toLowerCase() === "nosniff";
  const methodValid = method === "GET" || method === "HEAD";
  const noRedirect = redirected === false && !location;
  const bodyValid = method === "GET" ? validateV2Payload(payload, expectedBaseDigest) : method === "HEAD" && bodyEmpty;
  return {
    statusOk: status === 200,
    noRedirect,
    cacheSafe: cacheControl.includes("no-store") && cacheControl.includes("max-age=0"),
    nosniff,
    bodyValid,
    ok: methodValid && status === 200 && noRedirect && cacheControl.includes("no-store")
      && cacheControl.includes("max-age=0") && nosniff && bodyValid,
  };
}

export function validatePrerequisite({ receipt, evidenceText, protectedStable }) {
  const reasons = [];
  if (receipt?.schemaVersion !== "fin08v-preview-marker-deployment-verification/v1") reasons.push("FIN08V_SCHEMA");
  if (receipt?.deploymentAttempts !== 1) reasons.push("DEPLOYMENT_ATTEMPT_COUNT");
  if (receipt?.productionDeployments !== 0 || receipt?.aliasMutations !== 0 || receipt?.environmentCommands !== 0) reasons.push("MUTATION_COUNT");
  if (receipt?.metadataReads !== 0 || receipt?.markerGets !== 0 || receipt?.markerHeads !== 0) reasons.push("READ_COUNT");
  if (receipt?.databaseOperations !== 0 || receipt?.payuniOperations !== 0 || receipt?.retryCount !== 0) reasons.push("SIDE_EFFECT_COUNT");
  if (!protectedStable) reasons.push("PROTECTED_DRIFT");
  if (!/FIN08V_POST_RUN_CLEANUP_VERIFIED=true/u.test(String(evidenceText ?? ""))) reasons.push("CLEANUP_EVIDENCE");
  const expectedDigest = typeof receipt?.deployment?.identityDigest === "string" && SAFE_DIGEST.test(receipt.deployment.identityDigest)
    ? receipt.deployment.identityDigest : null;
  const windowStart = Number.isFinite(receipt?.deployment?.windowStart) ? receipt.deployment.windowStart : null;
  const windowEnd = Number.isFinite(receipt?.deployment?.windowEnd) ? receipt.deployment.windowEnd : null;
  if (!expectedDigest && !(Number.isFinite(windowStart) && Number.isFinite(windowEnd))) reasons.push("IDENTITY_WINDOW_MISSING");
  return { ok: reasons.length === 0, reasons, expectedDigest, windowStart, windowEnd };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08w-preview-marker-recovery/v1") errors.push("SCHEMA");
  if (!TERMINAL_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (receipt?.deployments !== 0) errors.push("DEPLOYMENT_MUTATION");
  if (receipt?.metadataQueries > 1 || receipt?.markerGets > 1 || receipt?.markerHeads > 1) errors.push("READ_BUDGET");
  if (receipt?.aliasMutations !== 0 || receipt?.environmentMutations !== 0 || receipt?.databaseOperations !== 0 || receipt?.payuniOperations !== 0 || receipt?.playwrightOperations !== 0) errors.push("SIDE_EFFECT");
  if (receipt?.scoreApplied !== false) errors.push("SCORE");
  if (receipt?.safety?.rawOutputPersisted !== false || receipt?.safety?.urlPersisted !== false || receipt?.safety?.credentialRead !== false) errors.push("SAFETY");
  if (/(?:https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:token|credential|cookie|password)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("SENSITIVE_TEXT");
  if (receipt?.status === "FIN08W_PREVIEW_MARKER_RECOVERED_VERIFIED" && receipt?.verification?.all !== true) errors.push("SUCCESS_GATE");
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "fin08w-preview-marker-recovery/v1",
    workPackage: "FIN-08W",
    status: "FIN08W_TERMINAL_NO_GO_PRECHECK",
    deployments: 0,
    metadataQueries: 0,
    candidateCount: 0,
    candidatePreview: false,
    candidateReady: false,
    candidateProduction: false,
    markerGets: 0,
    markerHeads: 0,
    redirects: 0,
    aliasMutations: 0,
    environmentMutations: 0,
    databaseOperations: 0,
    payuniOperations: 0,
    playwrightOperations: 0,
    scoreApplied: false,
    verification: { get: false, head: false, all: false },
    safety: { rawOutputPersisted: false, urlPersisted: false, credentialRead: false },
    strictReadback: false,
  };
}

function reserveReceipt() {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const receipt = initialReceipt();
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  return receipt;
}

function readPrerequisite() {
  const receipt = JSON.parse(fs.readFileSync(FIN08V_REPORT, "utf8"));
  const evidenceText = fs.readFileSync(FIN08V_EVIDENCE, "utf8");
  const protectedBefore = Object.fromEntries(PROTECTED_FILES.map((relative) => [relative, sha256File(path.join(ROOT, relative))]));
  const protectedStable = PROTECTED_FILES.every((relative) => protectedBefore[relative] === sha256File(path.join(ROOT, relative)));
  return { receipt, evidenceText, protectedStable, gate: validatePrerequisite({ receipt, evidenceText, protectedStable }) };
}

async function fetchMarker(url, method, expectedBaseDigest) {
  const response = await fetch(`${url}${MARKER_PATH}`, { method, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const headers = { cacheControl: response.headers.get("cache-control") ?? "", contentTypeOptions: response.headers.get("x-content-type-options") ?? "" };
  const location = response.headers.get("location");
  if (method === "GET") {
    const body = await response.text();
    let payload = null;
    try { payload = JSON.parse(body); } catch { /* fail closed */ }
    return validateMarkerResponse({ method, status: response.status, redirected: response.redirected, location, headers, payload, expectedBaseDigest });
  }
  const body = await response.text();
  return validateMarkerResponse({ method, status: response.status, redirected: response.redirected, location, headers, bodyEmpty: body.length === 0, expectedBaseDigest });
}

function runLive() {
  const receipt = reserveReceipt();
  try {
    const prerequisite = readPrerequisite();
    if (!prerequisite.gate.ok) return receipt;
    const result = spawnSync(process.execPath, [VERCEL_JS, ...buildMetadataArgs()], {
      cwd: ROOT, env: buildSafeEnvironment(), encoding: "utf8", shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    });
    receipt.metadataQueries = 1;
    const window = prerequisite.gate;
    const parsed = parseCandidates(result.stdout, result.status ?? 1, window);
    receipt.candidateCount = parsed.candidates.length;
    if (!parsed.parseOk || parsed.candidates.length !== 1) {
      receipt.status = "FIN08W_TERMINAL_NO_GO_METADATA";
      return receipt;
    }
    const candidate = parsed.candidates[0];
    receipt.candidatePreview = true;
    receipt.candidateReady = true;
    receipt.candidateProduction = false;
    receipt.candidateDigest = candidate.identityDigest;
    receipt.markerGets = 1;
    const get = fetchMarker(candidate.url, "GET", JSON.parse(fs.readFileSync(path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json"), "utf8"))?.source?.digest);
    return get.then(async (getResult) => {
      receipt.markerHeads = 1;
      const headResult = await fetchMarker(candidate.url, "HEAD", JSON.parse(fs.readFileSync(path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json"), "utf8"))?.source?.digest);
      receipt.verification.get = getResult.ok;
      receipt.verification.head = headResult.ok;
      receipt.verification.all = getResult.ok && headResult.ok;
      receipt.status = receipt.verification.all ? "FIN08W_PREVIEW_MARKER_RECOVERED_VERIFIED" : "FIN08W_TERMINAL_NO_GO_MARKER";
      return receipt;
    });
  } catch {
    receipt.status = "FIN08W_TERMINAL_NO_GO_METADATA";
    return receipt;
  }
}

function writeFinal(receipt) {
  const validation = validateReceipt(receipt);
  receipt.strictReadback = validation.ok;
  if (!validation.ok && receipt.status === "FIN08W_PREVIEW_MARKER_RECOVERED_VERIFIED") receipt.status = "FIN08W_TERMINAL_NO_GO_RECEIPT";
  receipt.canonicalDigest = `sha256:${crypto.createHash("sha256").update(canonical({ ...receipt, canonicalDigest: null }), "utf8").digest("hex")}`;
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, "utf8");
  return validation;
}

function verifyReceipt(filename) {
  const receipt = JSON.parse(fs.readFileSync(filename, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(JSON.stringify({ workPackage: "FIN-08W", status: receipt.status, strictReadback: validation.ok, errors: validation.errors }) + "\n");
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-receipt" && process.argv[3]) verifyReceipt(process.argv[3]);
  else if (process.argv[2] === "--recover-verify-once") {
    const receipt = await runLive();
    writeFinal(receipt);
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08W", status: receipt.status, deployments: receipt.deployments, metadataQueries: receipt.metadataQueries, candidateCount: receipt.candidateCount, markerGets: receipt.markerGets, markerHeads: receipt.markerHeads, scoreApplied: receipt.scoreApplied }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08W", status: "USAGE" }) + "\n");
    process.exitCode = 2;
  }
}
