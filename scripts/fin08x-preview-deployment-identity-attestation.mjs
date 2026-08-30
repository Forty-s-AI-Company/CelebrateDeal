import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08x-preview-deployment-identity-attestation.json");
const FIN08V_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08v-preview-marker-deployment-verification.json");
const FIN08W_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08w-preview-marker-recovery.json");
const FIN08T_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08t-staging-payuni-reconciliation.json");
const FIN08R_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08r-staging-payuni-reconciliation.json");
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const VERCEL_JS = "C:\\nvm4w\\nodejs\\node_modules\\vercel\\dist\\index.js";
const PROTECTED_FILES = Object.freeze([
  "src/app/__celebratedeal_wp187_fingerprint.json/route.ts",
  "src/app/__celebratedeal_wp187_fingerprint.json/route.test.ts",
  "docs/codex-goal/API_CONTRACT_REGISTRY.md",
  "scripts/fin08v-preview-marker-deployment-verification.mjs",
  "scripts/fin08w-preview-marker-recovery.mjs",
]);
const SYSTEM_ENV = Object.freeze([
  "SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "SystemDrive",
  "NVM_HOME", "NUMBER_OF_PROCESSORS", "OS",
]);
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TERMINAL_STATUSES = new Set([
  "FIN08X_PREVIEW_DEPLOYMENT_IDENTITY_ATTESTED",
  "FIN08X_TERMINAL_NO_GO_PRECHECK",
  "FIN08X_TERMINAL_NO_GO_METADATA",
  "FIN08X_TERMINAL_NO_GO_RECEIPT",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(`FIN08X/v1/deployment/${String(value)}`, "utf8").digest("hex")}`;
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

function rows(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.deployments) ? value.deployments : [];
}

function identity(row) {
  return typeof row?.uid === "string" ? row.uid : typeof row?.id === "string" ? row.id : null;
}

function timestamp(row) {
  const value = row?.createdAt ?? row?.created ?? row?.created_at;
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseInventory(raw, exitCode, { oldDigests = [], lowerBound = null } = {}) {
  const parsed = parseJsonObject(raw);
  if (exitCode !== 0 || !parsed) return { parseOk: false, orderOk: false, candidates: [] };
  const list = rows(parsed);
  let previous = Number.POSITIVE_INFINITY;
  let orderOk = true;
  const candidates = [];
  for (const row of list) {
    const created = timestamp(row);
    if (!Number.isFinite(created) || created > previous) orderOk = false;
    previous = created ?? previous;
    const id = identity(row);
    const idDigest = id ? digest(id) : null;
    const projectMatched = row?.name === PROJECT || row?.projectName === PROJECT;
    const preview = row?.target === "preview";
    const ready = String(row?.readyState ?? row?.state ?? row?.status ?? "").toUpperCase() === "READY";
    const nonProduction = row?.target !== "production";
    const oldExcluded = !idDigest || !oldDigests.includes(idDigest);
    const newerThanBoundary = Number.isFinite(lowerBound) && Number.isFinite(created) && created > lowerBound;
    if (projectMatched && preview && ready && nonProduction && oldExcluded && newerThanBoundary) {
      candidates.push({ identityDigest: idDigest, createdAtMinuteBucket: Math.floor(created / 60_000) });
    }
  }
  return { parseOk: true, orderOk, candidates };
}

export function validatePrerequisite({ fin08v, fin08w, oldDigests, lowerBound, protectedStable }) {
  const reasons = [];
  if (fin08v?.deploymentAttempts !== 1) reasons.push("FIN08V_DEPLOYMENT_ATTEMPT");
  if (fin08w?.deployments !== 0 || fin08w?.metadataQueries !== 0 || fin08w?.markerGets !== 0 || fin08w?.markerHeads !== 0) reasons.push("FIN08W_READ_BUDGET");
  if (!Array.isArray(oldDigests) || oldDigests.length === 0 || oldDigests.some((value) => !SAFE_DIGEST.test(value))) reasons.push("OLD_DIGEST_BOUNDARY");
  if (!Number.isFinite(lowerBound)) reasons.push("TIME_BOUNDARY_MISSING");
  if (!protectedStable) reasons.push("PROTECTED_DRIFT");
  return { ok: reasons.length === 0, reasons };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08x-preview-deployment-identity-attestation/v1") errors.push("SCHEMA");
  if (!TERMINAL_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (receipt?.deployments !== 0 || receipt?.redeployments !== 0 || receipt?.aliasMutations !== 0 || receipt?.environmentMutations !== 0) errors.push("MUTATION");
  if (receipt?.metadataInventoryQueries > 1 || receipt?.markerRequests !== 0) errors.push("QUERY_BUDGET");
  if (receipt?.databaseOperations !== 0 || receipt?.payuniOperations !== 0 || receipt?.playwrightOperations !== 0) errors.push("SIDE_EFFECT");
  if (receipt?.scoreApplied !== false) errors.push("SCORE");
  if (receipt?.safety?.rawOutputPersisted !== false || receipt?.safety?.urlPersisted !== false || receipt?.safety?.credentialRead !== false) errors.push("SAFETY");
  if (/(?:https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:token|credential|cookie|password)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("SENSITIVE_TEXT");
  if (receipt?.status === "FIN08X_PREVIEW_DEPLOYMENT_IDENTITY_ATTESTED" && receipt?.candidateCount !== 1) errors.push("CANDIDATE_GATE");
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "fin08x-preview-deployment-identity-attestation/v1",
    workPackage: "FIN-08X",
    status: "FIN08X_TERMINAL_NO_GO_PRECHECK",
    deployments: 0,
    redeployments: 0,
    metadataInventoryQueries: 0,
    candidateCount: 0,
    identityDigest: null,
    createdAtMinuteBucket: null,
    projectMatched: false,
    preview: false,
    ready: false,
    nonProduction: false,
    newerThanProtectedBoundary: false,
    oldDigestExcluded: false,
    inventoryOrderVerified: false,
    markerRequests: 0,
    aliasMutations: 0,
    environmentMutations: 0,
    databaseOperations: 0,
    payuniOperations: 0,
    playwrightOperations: 0,
    scoreApplied: false,
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
  const fin08v = JSON.parse(fs.readFileSync(FIN08V_REPORT, "utf8"));
  const fin08w = JSON.parse(fs.readFileSync(FIN08W_REPORT, "utf8"));
  const old = [FIN08T_REPORT, FIN08R_REPORT].map((filename) => JSON.parse(fs.readFileSync(filename, "utf8")));
  const oldDigests = old.map((value) => value?.freshness?.deploymentDigest).filter((value) => typeof value === "string");
  const protectedBefore = Object.fromEntries(PROTECTED_FILES.map((relative) => [relative, sha256File(path.join(ROOT, relative))]));
  const protectedStable = PROTECTED_FILES.every((relative) => protectedBefore[relative] === sha256File(path.join(ROOT, relative)));
  const lowerBound = old.map((value) => value?.freshness?.createdAt ?? value?.freshness?.observedAt).find((value) => Number.isFinite(value));
  return { fin08v, fin08w, oldDigests, lowerBound, protectedStable, gate: validatePrerequisite({ fin08v, fin08w, oldDigests, lowerBound, protectedStable }) };
}

function runLive() {
  const receipt = reserveReceipt();
  try {
    const prerequisite = readPrerequisite();
    if (!prerequisite.gate.ok) return receipt;
    const result = spawnSync(process.execPath, [VERCEL_JS, ...buildMetadataArgs()], {
      cwd: ROOT, env: buildSafeEnvironment(), encoding: "utf8", shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    });
    receipt.metadataInventoryQueries = 1;
    const parsed = parseInventory(result.stdout, result.status ?? 1, { oldDigests: prerequisite.oldDigests, lowerBound: prerequisite.lowerBound });
    receipt.inventoryOrderVerified = parsed.orderOk;
    receipt.candidateCount = parsed.candidates.length;
    if (!parsed.parseOk || !parsed.orderOk || parsed.candidates.length !== 1) {
      receipt.status = "FIN08X_TERMINAL_NO_GO_METADATA";
      return receipt;
    }
    const candidate = parsed.candidates[0];
    receipt.identityDigest = candidate.identityDigest;
    receipt.createdAtMinuteBucket = candidate.createdAtMinuteBucket;
    receipt.projectMatched = true;
    receipt.preview = true;
    receipt.ready = true;
    receipt.nonProduction = true;
    receipt.newerThanProtectedBoundary = true;
    receipt.oldDigestExcluded = true;
    receipt.status = "FIN08X_PREVIEW_DEPLOYMENT_IDENTITY_ATTESTED";
    return receipt;
  } catch {
    receipt.status = "FIN08X_TERMINAL_NO_GO_METADATA";
    return receipt;
  }
}

function writeFinal(receipt) {
  const validation = validateReceipt(receipt);
  receipt.strictReadback = validation.ok;
  if (!validation.ok && receipt.status === "FIN08X_PREVIEW_DEPLOYMENT_IDENTITY_ATTESTED") receipt.status = "FIN08X_TERMINAL_NO_GO_RECEIPT";
  receipt.canonicalDigest = `sha256:${crypto.createHash("sha256").update(canonical({ ...receipt, canonicalDigest: null }), "utf8").digest("hex")}`;
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, "utf8");
  return validation;
}

function verifyReceipt(filename) {
  const receipt = JSON.parse(fs.readFileSync(filename, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(JSON.stringify({ workPackage: "FIN-08X", status: receipt.status, strictReadback: validation.ok, errors: validation.errors }) + "\n");
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-receipt" && process.argv[3]) verifyReceipt(process.argv[3]);
  else if (process.argv[2] === "--attest-once") {
    const receipt = runLive();
    writeFinal(receipt);
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08X", status: receipt.status, deployments: receipt.deployments, metadataInventoryQueries: receipt.metadataInventoryQueries, candidateCount: receipt.candidateCount, markerRequests: receipt.markerRequests, scoreApplied: receipt.scoreApplied }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08X", status: "USAGE" }) + "\n");
    process.exitCode = 2;
  }
}
