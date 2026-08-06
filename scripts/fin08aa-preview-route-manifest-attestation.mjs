import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08aa-preview-route-manifest-attestation.json");
const VERCEL_JS = "C:\\nvm4w\\nodejs\\node_modules\\vercel\\dist\\index.js";
const ROUTE_KEY = "/__celebratedeal_wp187_fingerprint.json";
const PROTECTED_FILES = Object.freeze([
  "src/app/__celebratedeal_wp187_fingerprint.json/route.ts",
  "src/app/__celebratedeal_wp187_fingerprint.json/route.test.ts",
  "docs/codex-goal/API_CONTRACT_REGISTRY.md",
  "scripts/fin08z-manual-attested-preview-marker-verification.mjs",
]);
const SYSTEM_ENV = Object.freeze([
  "SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "SystemDrive",
  "NVM_HOME", "NUMBER_OF_PROCESSORS", "OS",
]);
const TERMINAL_STATUSES = new Set([
  "FIN08AA_PREVIEW_ROUTE_MANIFEST_ATTESTED",
  "FIN08AA_TERMINAL_NO_GO_PRECHECK",
  "FIN08AA_TERMINAL_NO_GO_CAPABILITY",
  "FIN08AA_TERMINAL_NO_GO_ARTIFACT",
  "FIN08AA_TERMINAL_NO_GO_RECEIPT",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(namespace, value) {
  return `sha256:${crypto.createHash("sha256").update(`${namespace}/${String(value)}`, "utf8").digest("hex")}`;
}

function sha256File(filename) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex")}`;
}

export function buildCapabilityArgs(vercelJs = VERCEL_JS) {
  return [vercelJs, "inspect", "--help"];
}

export function buildSafeEnvironment(source = process.env) {
  const environment = Object.create(null);
  for (const key of SYSTEM_ENV) if (typeof source?.[key] === "string") environment[key] = source[key];
  return environment;
}

export function classifyCapability(raw, exitCode) {
  const text = String(raw ?? "").toLowerCase();
  if (exitCode !== 0) return { available: false, reason: "CLI_HELP_FAILED" };
  const route = /route\s+manifest|function\s+inventory|build[- ]output/iu.test(text);
  return route ? { available: true, reason: "STRUCTURED_ROUTE_CAPABILITY" } : { available: false, reason: "CAPABILITY_UNAVAILABLE" };
}

export function validateRouteEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  if (entry.path !== ROUTE_KEY) return false;
  if (!new Set(["app-route", "next-app-route", "function", "vercel-function"]).has(entry.kind)) return false;
  if (entry.methods !== undefined && (!Array.isArray(entry.methods) || !entry.methods.includes("GET") || !entry.methods.includes("HEAD"))) return false;
  return true;
}

export function validateArtifact(artifact) {
  const errors = [];
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return { ok: false, errors: ["ARTIFACT"] };
  if (artifact.candidateCount !== 1) errors.push("CANDIDATE_COUNT");
  if (artifact.projectMatched !== true || artifact.preview !== true || artifact.ready !== true || artifact.nonProduction !== true || artifact.currentPreview !== true || artifact.identityUnique !== true) errors.push("DEPLOYMENT_IDENTITY");
  if (artifact.routeEntryCount !== 1 || artifact.routePresent !== true || !validateRouteEntry(artifact.routeEntry)) errors.push("ROUTE");
  return { ok: errors.length === 0, errors };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08aa-preview-route-manifest-attestation/v1") errors.push("SCHEMA");
  if (!TERMINAL_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (receipt?.artifactSource?.queries > 1 || receipt?.artifactSource?.applicationHttp !== 0 || receipt?.artifactSource?.logsRead !== false) errors.push("QUERY_BUDGET");
  if (receipt?.sideEffects?.deployments !== 0 || receipt?.sideEffects?.environmentMutations !== 0 || receipt?.sideEffects?.databaseOperations !== 0 || receipt?.sideEffects?.payuniOperations !== 0 || receipt?.sideEffects?.playwrightOperations !== 0 || receipt?.sideEffects?.gitMutations !== 0) errors.push("SIDE_EFFECT");
  if (receipt?.scoreImpact?.applied !== false) errors.push("SCORE");
  if (receipt?.safety?.rawOutputPersisted !== false || receipt?.safety?.rawManifestPersisted !== false || receipt?.safety?.urlPersisted !== false || receipt?.safety?.credentialRead !== false) errors.push("SAFETY");
  if (/(?:https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:token|credential|cookie|password)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("SENSITIVE_TEXT");
  if (receipt?.status === "FIN08AA_PREVIEW_ROUTE_MANIFEST_ATTESTED" && receipt?.route?.routePresent !== true) errors.push("SUCCESS_ROUTE");
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "fin08aa-preview-route-manifest-attestation/v1",
    workPackage: "FIN-08AA",
    status: "FIN08AA_TERMINAL_NO_GO_PRECHECK",
    prerequisites: { fin08zTerminal: true, markerLoopDetected: true },
    artifactSource: { kind: "vercel-build-output", queries: 0, structured: false, bounded: true, capability: "UNCLASSIFIED", logsRead: false, applicationHttp: 0 },
    deployment: { candidateCount: 0, projectMatched: false, preview: false, ready: false, nonProduction: false, currentPreview: false, identityUnique: false, identityDigest: null },
    route: { routeKey: ROUTE_KEY, routePresent: false, routeEntryCount: 0, routeKind: null, routeEntryDigest: null, methodsObserved: false, getPresent: false, headPresent: false, methodsBoundByAcceptedSource: false },
    lineage: { fin08uHashesMatched: false, sourceContractDigest: null, lineageDigest: null },
    safety: { rawOutputPersisted: false, rawManifestPersisted: false, urlPersisted: false, credentialRead: false },
    sideEffects: { deployments: 0, environmentMutations: 0, databaseOperations: 0, payuniOperations: 0, playwrightOperations: 0, gitMutations: 0 },
    quality: { protectedStable: false, stagedEmpty: false, strictReadback: false },
    scoreImpact: { before: 6, candidateAfter: 6, applied: false },
  };
}

function reserveReceipt() {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const receipt = initialReceipt();
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  return receipt;
}

function protectedSnapshot() {
  return Object.fromEntries(PROTECTED_FILES.map((relative) => {
    const filename = path.join(ROOT, relative);
    return [relative, fs.existsSync(filename) ? sha256File(filename) : null];
  }));
}

function runCapabilityProbe() {
  return spawnSync(process.execPath, buildCapabilityArgs(VERCEL_JS), {
    cwd: ROOT, env: buildSafeEnvironment(), encoding: "utf8", shell: false, windowsHide: true, timeout: 20_000, maxBuffer: 512 * 1024,
  });
}

function runLive() {
  const receipt = reserveReceipt();
  try {
    const staged = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: ROOT, windowsHide: true });
    receipt.quality.stagedEmpty = staged.status === 0;
    const protectedBefore = protectedSnapshot();
    receipt.quality.protectedStable = PROTECTED_FILES.every((relative) => protectedBefore[relative] !== null);
    if (!receipt.quality.stagedEmpty || !receipt.quality.protectedStable) return receipt;
    const probe = runCapabilityProbe();
    const capability = classifyCapability(probe.stdout, probe.status ?? 1);
    receipt.artifactSource.capability = capability.reason;
    if (!capability.available) {
      receipt.status = "FIN08AA_TERMINAL_NO_GO_CAPABILITY";
      return receipt;
    }
    receipt.artifactSource.queries = 1;
    receipt.status = "FIN08AA_TERMINAL_NO_GO_ARTIFACT";
    return receipt;
  } catch {
    receipt.status = "FIN08AA_TERMINAL_NO_GO_PRECHECK";
    return receipt;
  }
}

function writeFinal(receipt) {
  const validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok;
  if (!validation.ok && receipt.status === "FIN08AA_PREVIEW_ROUTE_MANIFEST_ATTESTED") receipt.status = "FIN08AA_TERMINAL_NO_GO_RECEIPT";
  receipt.canonicalDigest = digest("FIN08AA/v1/receipt", canonical({ ...receipt, canonicalDigest: null }));
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, "utf8");
  return validation;
}

function verifyReceipt(filename) {
  const receipt = JSON.parse(fs.readFileSync(filename, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(JSON.stringify({ workPackage: "FIN-08AA", status: receipt.status, strictReadback: validation.ok, errors: validation.errors }) + "\n");
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-receipt" && process.argv[3]) verifyReceipt(process.argv[3]);
  else if (process.argv[2] === "--attest-once" && process.argv[3] === "--source=vercel-build-output") {
    const receipt = runLive();
    writeFinal(receipt);
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08AA", status: receipt.status, artifactQueries: receipt.artifactSource.queries, capability: receipt.artifactSource.capability, routePresent: receipt.route.routePresent, scoreApplied: receipt.scoreImpact.applied }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08AA", status: "USAGE" }) + "\n");
    process.exitCode = 2;
  }
}
