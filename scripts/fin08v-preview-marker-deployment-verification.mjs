import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08v-preview-marker-deployment-verification.json");
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const VERCEL_JS = "C:\\nvm4w\\nodejs\\node_modules\\vercel\\dist\\index.js";
const WP187_REPORT = path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json");
const FIN08T_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08t-staging-payuni-reconciliation.json");
const FIN08R_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08r-staging-payuni-reconciliation.json");
const ACCEPTED_FILES = Object.freeze([
  "src/app/__celebratedeal_wp187_fingerprint.json/route.ts",
  "src/app/__celebratedeal_wp187_fingerprint.json/route.test.ts",
  "docs/codex-goal/API_CONTRACT_REGISTRY.md",
  "docs/ai-team/evidence/fin-08u-preview-marker-contract-remediation.md",
]);
const ROOT_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "next-env.d.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "postcss.config.js",
  "postcss.config.mjs",
  "postcss.config.ts",
  "tailwind.config.js",
  "tailwind.config.ts",
  "tsconfig.json",
  "prisma.config.ts",
  "components.json",
  "vercel.json",
  "middleware.ts",
  "middleware.js",
]);
const SYSTEM_ENV = Object.freeze([
  "SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "SystemDrive",
  "NVM_HOME", "NUMBER_OF_PROCESSORS", "OS",
]);
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const V2_KEYS = Object.freeze([
  "baseSourceDigest",
  "baseWorkPackage",
  "remediationWorkPackage",
  "schemaVersion",
  "sourceDigestSemantics",
].sort());
const TERMINAL_STATUSES = new Set([
  "FIN08V_PREVIEW_MARKER_REMOTE_VERIFIED",
  "FIN08V_TERMINAL_NO_GO_PRECHECK",
  "FIN08V_TERMINAL_NO_GO_DEPLOY",
  "FIN08V_TERMINAL_NO_GO_METADATA",
  "FIN08V_TERMINAL_NO_GO_MARKER",
  "FIN08V_TERMINAL_NO_GO_CLEANUP",
  "FIN08V_TERMINAL_NO_GO_RECEIPT",
]);
const FORBIDDEN_SEGMENTS = new Set([
  ".git", ".ai-team", ".private", "coverage", "reports", "test-results",
  "tmp", ".next", "node_modules", "tests", "e2e", "__tests__",
]);
const FORBIDDEN_SUFFIXES = /(?:\.pem|\.key|\.p12|\.pfx|\.crt|\.cer)$/iu;
const FORBIDDEN_WORDS = /(?:credential|token|cookie|secret|private)/iu;

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(kind, value) {
  return `sha256:${crypto.createHash("sha256").update(`FIN08T/v1/${kind}/${String(value)}`, "utf8").digest("hex")}`;
}

function sha256File(filename) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex")}`;
}

function isDotenvName(name) {
  return /^\.env(?:\.|$)/iu.test(name);
}

export function isForbiddenRelativePath(relativePath) {
  const normalized = String(relativePath).replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const basename = parts.at(-1) ?? "";
  return parts.some((part) => isDotenvName(part) || FORBIDDEN_SEGMENTS.has(part.toLowerCase()))
    || FORBIDDEN_SUFFIXES.test(basename)
    || FORBIDDEN_WORDS.test(basename)
    || /(?:^|\/)(?:[^/]+)\.(?:test|spec)\.[^/]+$/iu.test(normalized);
}

export function isAllowedMirrorFile(relativePath) {
  const normalized = String(relativePath).replaceAll("\\", "/");
  if (!normalized || isForbiddenRelativePath(normalized)) return false;
  if (normalized === "scripts/preflight.ts") return true;
  const [top] = normalized.split("/");
  if (["src", "public", "prisma", "config"].includes(top)) {
    if (top === "prisma") return normalized === "prisma/schema.prisma" || normalized.startsWith("prisma/migrations/");
    return true;
  }
  return ROOT_FILES.includes(normalized);
}

function isAbsolutePath(value) {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

export function buildDeployArgs(mirror, project = PROJECT, scope = SCOPE) {
  if (!isAbsolutePath(mirror)) throw new Error("MIRROR_PATH_MUST_BE_ABSOLUTE");
  return ["deploy", mirror, "--yes", "--target", "preview", "--project", project, "--scope", scope, "--skip-domain", "--json", "--no-color"];
}

export function buildSafeEnvironment(source = process.env) {
  const environment = Object.create(null);
  for (const key of SYSTEM_ENV) {
    if (typeof source?.[key] === "string") environment[key] = source[key];
  }
  return environment;
}

export function validateV2Payload(value, expectedBaseDigest) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value;
  if (Object.keys(record).sort().join("\u0000") !== V2_KEYS.join("\u0000")) return false;
  return record.schemaVersion === "celebratedeal-preview-lineage/v2"
    && record.baseWorkPackage === "WP-187"
    && typeof record.baseSourceDigest === "string"
    && SAFE_DIGEST.test(record.baseSourceDigest)
    && record.baseSourceDigest === expectedBaseDigest
    && record.remediationWorkPackage === "FIN-08U"
    && record.sourceDigestSemantics === "wp187_base_lineage";
}

export function validateMarkerResponse({ status, redirected = false, location = null, payload, expectedBaseDigest }) {
  const headers = arguments[0]?.headers ?? {};
  const cacheControl = String(headers.cacheControl ?? "").toLowerCase();
  const nosniff = String(headers.contentTypeOptions ?? "").toLowerCase() === "nosniff";
  const bodyEmpty = arguments[0]?.bodyEmpty === true;
  const method = arguments[0]?.method ?? "GET";
  const methodValid = method === "GET" || method === "HEAD";
  return {
    statusOk: status === 200,
    noRedirect: redirected === false && !location,
    exactPayload: method === "GET" && validateV2Payload(payload, expectedBaseDigest),
    headEmpty: method === "HEAD" && bodyEmpty,
    cacheSafe: cacheControl.includes("no-store") && cacheControl.includes("max-age=0"),
    nosniff,
    methodValid,
    ok: methodValid && status === 200 && redirected === false && !location
      && cacheControl.includes("no-store") && cacheControl.includes("max-age=0") && nosniff
      && ((method === "GET" && validateV2Payload(payload, expectedBaseDigest)) || (method === "HEAD" && bodyEmpty)),
  };
}

export function parseJsonObject(raw) {
  try {
    const text = String(raw ?? "").trim();
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    return JSON.parse(lines.at(-1) ?? text);
  } catch {
    return null;
  }
}
export function parseDeployment(raw, exitCode) {
  const value = parseJsonObject(raw);
  const url = typeof value?.url === "string" ? value.url : typeof value?.deploymentUrl === "string" ? value.deploymentUrl : null;
  let safeUrl = null;
  try {
    const parsed = new URL(url ?? "");
    if (parsed.protocol === "https:" && parsed.hostname.endsWith(".vercel.app") && !parsed.username && !parsed.password && !parsed.port) safeUrl = parsed.toString().replace(/\/$/u, "");
  } catch { /* fixed failure classification */ }
  return { ok: exitCode === 0 && Boolean(safeUrl), url: safeUrl, deploymentPresent: Boolean(value) };
}

export function parseInspect(raw, exitCode) {
  const value = parseJsonObject(raw);
  const identity = typeof value?.id === "string" ? value.id : typeof value?.uid === "string" ? value.uid : null;
  const state = String(value?.readyState ?? value?.status ?? value?.state ?? "").toUpperCase();
  return {
    ok: exitCode === 0 && value?.name === PROJECT && value?.target === "preview" && state === "READY" && Boolean(identity),
    projectMatched: value?.name === PROJECT,
    preview: value?.target === "preview",
    ready: state === "READY",
    nonProduction: value?.target !== "production",
    identityDigest: identity ? digest("deployment", identity) : null,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08v-preview-marker-deployment-verification/v1") errors.push("SCHEMA");
  if (!TERMINAL_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (receipt?.deploymentAttempts !== 1) errors.push("DEPLOY_ATTEMPT_BUDGET");
  if (receipt?.productionDeployments !== 0 || receipt?.aliasMutations !== 0 || receipt?.environmentCommands !== 0) errors.push("FORBIDDEN_MUTATION");
  if (receipt?.metadataReads > 1 || receipt?.markerGets > 1 || receipt?.markerHeads > 1) errors.push("READ_ATTEMPT_BUDGET");
  if (receipt?.databaseOperations !== 0 || receipt?.payuniOperations !== 0 || receipt?.retryCount !== 0) errors.push("EXTERNAL_SIDE_EFFECT");
  if (receipt?.scoreImpact?.applied !== false) errors.push("SCORE_OVERCLAIM");
  if (receipt?.safety?.dotenvRead !== false || receipt?.safety?.rawOutputPersisted !== false || receipt?.safety?.credentialsPersisted !== false) errors.push("SAFETY");
  if (/(?:https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:token|credential|cookie|password)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("SENSITIVE_TEXT");
  if (receipt?.status === "FIN08V_PREVIEW_MARKER_REMOTE_VERIFIED" && receipt?.verification?.all !== true) errors.push("SUCCESS_GATE");
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "fin08v-preview-marker-deployment-verification/v1",
    workPackage: "FIN-08V",
    status: "FIN08V_TERMINAL_NO_GO_PRECHECK",
    deploymentAttempts: 0,
    productionDeployments: 0,
    aliasMutations: 0,
    environmentCommands: 0,
    metadataReads: 0,
    markerGets: 0,
    markerHeads: 0,
    databaseOperations: 0,
    payuniOperations: 0,
    retryCount: 0,
    source: { mirrorFiles: 0, forbiddenFiles: 0, tempOutsideWorkspace: false, acceptedFilesStable: false, stagedEmpty: false, diffCheck: false },
    deployment: { projectMatched: false, preview: false, ready: false, nonProduction: false, newIdentity: false },
    verification: { get: false, head: false, all: false },
    safety: { dotenvRead: false, rawOutputPersisted: false, credentialsPersisted: false },
    cleanup: { pass: false, tempMarkerSafe: false },
    scoreImpact: { CAT04: { before: 6, candidateAfter: 6 }, applied: false },
    strictReadback: false,
  };
}

function atomicReserve() {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const receipt = initialReceipt();
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  return receipt;
}

function writeFinal(receipt) {
  const validation = validateReceipt(receipt);
  receipt.strictReadback = validation.ok;
  if (!validation.ok && receipt.status === "FIN08V_PREVIEW_MARKER_REMOTE_VERIFIED") receipt.status = "FIN08V_TERMINAL_NO_GO_RECEIPT";
  receipt.canonicalDigest = `sha256:${crypto.createHash("sha256").update(canonical({ ...receipt, canonicalDigest: null }), "utf8").digest("hex")}`;
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, { encoding: "utf8" });
  return validation;
}

function runGit(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 });
  return { exitCode: result.status ?? 1, output: result.stdout ?? "" };
}

function acceptedFilesStable(before) {
  return ACCEPTED_FILES.every((relative) => {
    const filename = path.join(ROOT, relative);
    return fs.existsSync(filename) && before[relative] === sha256File(filename);
  });
}

function copyTree(relativeRoot, mirror, counts) {
  const sourceRoot = path.join(ROOT, relativeRoot);
  if (!fs.existsSync(sourceRoot)) return;
  const visit = (source, relative) => {
    const name = path.basename(source);
    if (isDotenvName(name) || FORBIDDEN_SEGMENTS.has(name.toLowerCase())) { counts.forbiddenFiles += 1; return; }
    const stat = fs.lstatSync(source);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(source)) visit(path.join(source, entry), path.posix.join(relative, entry));
      return;
    }
    if (!stat.isFile()) return;
    if (!isAllowedMirrorFile(relative)) return;
    const destination = path.join(mirror, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    counts.mirrorFiles += 1;
  };
  visit(sourceRoot, relativeRoot);
}

function buildMirror(mirror) {
  const counts = { mirrorFiles: 0, forbiddenFiles: 0 };
  for (const relative of ROOT_FILES) {
    const source = path.join(ROOT, relative);
    if (!fs.existsSync(source) || !isAllowedMirrorFile(relative)) continue;
    const destination = path.join(mirror, ...relative.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    counts.mirrorFiles += 1;
  }
  for (const directory of ["src", "public", "prisma", "config"]) copyTree(directory, mirror, counts);
  const preflight = path.join(ROOT, "scripts", "preflight.ts");
  if (fs.existsSync(preflight)) {
    fs.mkdirSync(path.join(mirror, "scripts"), { recursive: true });
    fs.copyFileSync(preflight, path.join(mirror, "scripts", "preflight.ts"));
    counts.mirrorFiles += 1;
  }
  fs.writeFileSync(path.join(mirror, ".vercelignore"), [
    ".env", ".env.*", ".git/", ".ai-team/", ".private/", "coverage/", "reports/", "test-results/",
    "*.pem", "*.key", "*.p12", "*.pfx", "node_modules/", ".next/", "tests/", "e2e/",
  ].join("\n") + "\n", "utf8");
  return counts;
}

function tempSafe(mirror) {
  const resolved = path.resolve(mirror);
  return resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && !resolved.startsWith(ROOT + path.sep);
}

async function fetchMarker(url, method, expectedBaseDigest) {
  const response = await fetch(`${url}${MARKER_PATH}`, { method, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  const location = response.headers.get("location");
  const headers = { cacheControl: response.headers.get("cache-control") ?? "", contentTypeOptions: response.headers.get("x-content-type-options") ?? "" };
  if (method === "GET") {
    const body = await response.text();
    let payload = null;
    try { payload = JSON.parse(body); } catch { /* validation reports false */ }
    const result = validateMarkerResponse({ status: response.status, redirected: response.redirected, location, headers, method, payload, expectedBaseDigest });
    return { ...result, payloadDigest: `sha256:${crypto.createHash("sha256").update(body, "utf8").digest("hex")}` };
  }
  const body = await response.text();
  return validateMarkerResponse({ status: response.status, redirected: response.redirected, location, headers, method, bodyEmpty: body.length === 0, expectedBaseDigest });
}

async function runLive() {
  const receipt = atomicReserve();
  let mirror = null;
  const acceptedBefore = Object.fromEntries(ACCEPTED_FILES.map((relative) => [relative, sha256File(path.join(ROOT, relative))]));
  try {
    const staged = runGit(["diff", "--cached", "--name-only"]);
    const diff = runGit(["diff", "--check"]);
    receipt.source.stagedEmpty = staged.exitCode === 0 && staged.output.trim().length === 0;
    receipt.source.diffCheck = diff.exitCode === 0;
    receipt.source.acceptedFilesStable = acceptedFilesStable(acceptedBefore);
    mirror = fs.mkdtempSync(path.join(os.tmpdir(), "celebratedeal-fin08v-"));
    receipt.source.tempOutsideWorkspace = tempSafe(mirror);
    if (!receipt.source.stagedEmpty || !receipt.source.diffCheck || !receipt.source.acceptedFilesStable || !receipt.source.tempOutsideWorkspace || !fs.existsSync(VERCEL_JS)) {
      receipt.status = "FIN08V_TERMINAL_NO_GO_PRECHECK";
      return receipt;
    }
    const counts = buildMirror(mirror);
    receipt.source.mirrorFiles = counts.mirrorFiles;
    receipt.source.forbiddenFiles = counts.forbiddenFiles;
    if (counts.mirrorFiles === 0 || counts.forbiddenFiles !== 0) {
      receipt.status = "FIN08V_TERMINAL_NO_GO_PRECHECK";
      return receipt;
    }

    const deploy = spawnSync(process.execPath, [VERCEL_JS, ...buildDeployArgs(mirror)], {
      cwd: mirror,
      env: buildSafeEnvironment(),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 15 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    receipt.deploymentAttempts = 1;
    const deployment = parseDeployment(deploy.stdout, deploy.status ?? 1);
    if (!deployment.ok) {
      receipt.status = "FIN08V_TERMINAL_NO_GO_DEPLOY";
      return receipt;
    }

    const inspect = spawnSync(process.execPath, [VERCEL_JS, "inspect", deployment.url, "--scope", SCOPE, "--json", "--no-color"], {
      cwd: mirror,
      env: buildSafeEnvironment(),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    receipt.metadataReads = 1;
    const inspected = parseInspect(inspect.stdout, inspect.status ?? 1);
    receipt.deployment.projectMatched = inspected.projectMatched;
    receipt.deployment.preview = inspected.preview;
    receipt.deployment.ready = inspected.ready;
    receipt.deployment.nonProduction = inspected.nonProduction;
    const old = [FIN08T_REPORT, FIN08R_REPORT].filter((filename) => fs.existsSync(filename)).map((filename) => JSON.parse(fs.readFileSync(filename, "utf8"))).map((value) => value?.freshness?.deploymentDigest).filter(Boolean);
    receipt.deployment.newIdentity = Boolean(inspected.identityDigest && !old.includes(inspected.identityDigest));
    if (!inspected.ok || !receipt.deployment.newIdentity) {
      receipt.status = "FIN08V_TERMINAL_NO_GO_METADATA";
      return receipt;
    }

    const expected = JSON.parse(fs.readFileSync(WP187_REPORT, "utf8"));
    const expectedBaseDigest = expected?.source?.digest;
    receipt.markerGets = 1;
    const get = await fetchMarker(deployment.url, "GET", expectedBaseDigest);
    receipt.markerHeads = 1;
    const head = await fetchMarker(deployment.url, "HEAD", expectedBaseDigest);
    receipt.verification.get = get.ok;
    receipt.verification.head = head.ok;
    receipt.verification.all = get.ok && head.ok;
    receipt.verification.payloadDigest = get.payloadDigest ?? null;
    receipt.status = receipt.verification.all ? "FIN08V_PREVIEW_MARKER_REMOTE_VERIFIED" : "FIN08V_TERMINAL_NO_GO_MARKER";
    return receipt;
  } catch {
    receipt.status = "FIN08V_TERMINAL_NO_GO_DEPLOY";
    return receipt;
  } finally {
    receipt.source.acceptedFilesStable = receipt.source.acceptedFilesStable && acceptedFilesStable(acceptedBefore);
    if (mirror) {
      const safe = tempSafe(mirror);
      receipt.cleanup.tempMarkerSafe = safe;
      if (safe) {
        try { fs.rmSync(mirror, { recursive: true, force: true }); } catch { /* final validator records cleanup failure */ }
      }
      receipt.cleanup.pass = safe && !fs.existsSync(mirror);
    }
    receipt.safety.dotenvRead = false;
    receipt.safety.rawOutputPersisted = false;
    receipt.safety.credentialsPersisted = false;
    if (!receipt.cleanup.pass) receipt.status = "FIN08V_TERMINAL_NO_GO_CLEANUP";
  }
}

function verifyReceipt(filename) {
  const receipt = JSON.parse(fs.readFileSync(filename, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(JSON.stringify({ workPackage: "FIN-08V", strictReadback: validation.ok, status: receipt.status, errors: validation.errors }) + "\n");
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-receipt" && process.argv[3]) verifyReceipt(process.argv[3]);
  else if (process.argv[2] === "--authorized-preview-deploy-and-verify-once") {
    const receipt = await runLive();
    writeFinal(receipt);
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08V", status: receipt.status, deploymentAttempts: receipt.deploymentAttempts, metadataReads: receipt.metadataReads, markerGets: receipt.markerGets, markerHeads: receipt.markerHeads, databaseOperations: receipt.databaseOperations, payuniOperations: receipt.payuniOperations, scoreApplied: receipt.scoreImpact.applied }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08V", status: "USAGE" }) + "\n");
    process.exitCode = 2;
  }
}
