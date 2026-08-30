import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08y-latest-preview-marker-attestation.json");
const FIN08T_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08t-staging-payuni-reconciliation.json");
const FIN08R_REPORT = path.join(ROOT, ".ai-team", "reports", "fin08r-staging-payuni-reconciliation.json");
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const VERCEL_JS = "C:\\nvm4w\\nodejs\\node_modules\\vercel\\dist\\index.js";
const BASE_SOURCE_DIGEST = "sha256:cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34";
const PROTECTED_FILES = Object.freeze([
  "src/app/__celebratedeal_wp187_fingerprint.json/route.ts",
  "src/app/__celebratedeal_wp187_fingerprint.json/route.test.ts",
  "docs/codex-goal/API_CONTRACT_REGISTRY.md",
  "scripts/fin08v-preview-marker-deployment-verification.mjs",
  "scripts/fin08w-preview-marker-recovery.mjs",
  "scripts/fin08x-preview-deployment-identity-attestation.mjs",
]);
const SYSTEM_ENV = Object.freeze([
  "SystemRoot", "WINDIR", "PATH", "PATHEXT", "ComSpec", "TEMP", "TMP",
  "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "SystemDrive",
  "NVM_HOME", "NUMBER_OF_PROCESSORS", "OS",
]);
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TERMINAL_STATUSES = new Set([
  "FIN08Y_LATEST_PREVIEW_V2_MARKER_ATTESTED",
  "FIN08Y_TERMINAL_NO_GO_PRECHECK",
  "FIN08Y_TERMINAL_NO_GO_METADATA",
  "FIN08Y_TERMINAL_NO_GO_MARKER",
  "FIN08Y_TERMINAL_NO_GO_RECEIPT",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(`FIN08Y/v1/deployment/${String(value)}`, "utf8").digest("hex")}`;
}

export function deploymentIdentityDigest(value) {
  return digest(value);
}

function sha256File(filename) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex")}`;
}

export function buildMetadataArgs(project = PROJECT, scope = SCOPE) {
  return ["list", project, "--json", "--limit", "20", "--status", "READY", "--target", "preview", "--scope", scope, "--no-color"];
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

function deploymentUrl(row) {
  const value = row?.url ?? row?.deploymentUrl ?? row?.domain ?? row?.alias;
  if (typeof value !== "string" || value.length === 0) return null;
  const candidate = /^https:\/\//u.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port) return null;
    if (!parsed.hostname || parsed.hostname.includes(".")) return parsed;
  } catch {
    return null;
  }
  return null;
}

export function parseInventory(raw, exitCode, { protectedDigests = [] } = {}) {
  const parsed = parseJsonObject(raw);
  if (exitCode !== 0 || !parsed) return { parseOk: false, orderOk: false, rows: [], eligible: [], latest: null };
  const list = rows(parsed);
  let previous = Number.POSITIVE_INFINITY;
  let orderOk = true;
  const normalized = [];
  for (const row of list) {
    const created = timestamp(row);
    if (!Number.isFinite(created) || created > previous) orderOk = false;
    previous = Number.isFinite(created) ? created : previous;
    const id = identity(row);
    const projectMatched = row?.name === PROJECT || row?.projectName === PROJECT;
    const preview = row?.target === "preview";
    const ready = String(row?.readyState ?? row?.state ?? row?.status ?? "").toUpperCase() === "READY";
    const nonProduction = row?.target !== "production" && row?.production !== true;
    const url = deploymentUrl(row);
    const identityDigest = id ? digest(id) : null;
    const eligible = projectMatched && preview && ready && nonProduction && Number.isFinite(created) && Boolean(id) && Boolean(url)
      && !protectedDigests.includes(identityDigest);
    normalized.push({ createdAt: created, identityDigest, url, eligible, classified: projectMatched && preview && ready && nonProduction });
  }
  const eligible = normalized.filter((value) => value.eligible);
  const latest = eligible.length > 0 ? eligible[0] : null;
  const latestTie = Boolean(latest && eligible[1] && eligible[1].createdAt === latest.createdAt);
  const latestUnique = Boolean(latest && !latestTie && normalized.every((value, index) => index === 0 || !value.eligible || value.createdAt < latest.createdAt));
  const unknownBeforeLatest = Boolean(latest && normalized.some((value, index) => index < normalized.indexOf(latest) && !value.classified));
  return {
    parseOk: true,
    orderOk,
    rows: normalized,
    eligible,
    latest: latestUnique && !unknownBeforeLatest ? latest : null,
    latestCandidateCount: latest ? 1 : 0,
    latestUnique: latestUnique && !unknownBeforeLatest,
    latestTie,
    unknownBeforeLatest,
  };
}

export function buildMarkerUrl(baseUrl, markerPath = MARKER_PATH) {
  if (!(baseUrl instanceof URL)) return null;
  const url = new URL(markerPath, baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) return null;
  return url;
}

export function validateMarkerResponse({ status, redirect, payload, headers }) {
  const errors = [];
  if (status !== 200) errors.push("STATUS");
  if (redirect) errors.push("REDIRECT");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) errors.push("PAYLOAD");
  const expected = {
    schemaVersion: "celebratedeal-preview-lineage/v2",
    baseWorkPackage: "WP-187",
    baseSourceDigest: BASE_SOURCE_DIGEST,
    remediationWorkPackage: "FIN-08U",
    sourceDigestSemantics: "wp187_base_lineage",
  };
  if (payload && (Object.keys(payload).sort().join("\u0000") !== Object.keys(expected).sort().join("\u0000")
    || Object.keys(expected).some((key) => payload[key] !== expected[key]))) errors.push("V2_CONTRACT");
  const cache = String(headers?.cacheControl ?? "").toLowerCase();
  if (!cache.includes("no-store") || !cache.includes("max-age=0")) errors.push("CACHE_CONTROL");
  if (String(headers?.contentTypeOptions ?? "").toLowerCase() !== "nosniff") errors.push("NOSNIFF");
  return { ok: errors.length === 0, errors };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08y-latest-preview-marker-attestation/v1") errors.push("SCHEMA");
  if (!TERMINAL_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (receipt?.deployments !== 0 || receipt?.redeployments !== 0 || receipt?.aliasMutations !== 0 || receipt?.environmentMutations !== 0) errors.push("MUTATION");
  if (receipt?.metadataInventoryQueries > 1 || receipt?.markerGets > 1 || receipt?.markerHeads !== 0 || receipt?.otherHttpRequests !== 0) errors.push("READ_BUDGET");
  if (receipt?.databaseOperations !== 0 || receipt?.payuniOperations !== 0 || receipt?.playwrightOperations !== 0) errors.push("SIDE_EFFECT");
  if (receipt?.scoreApplied !== false) errors.push("SCORE");
  if (receipt?.safety?.rawOutputPersisted !== false || receipt?.safety?.urlPersisted !== false || receipt?.safety?.credentialRead !== false || receipt?.safety?.rawMarkerPersisted !== false) errors.push("SAFETY");
  if (/(?:https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:token|credential|cookie|password)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("SENSITIVE_TEXT");
  if (receipt?.status === "FIN08Y_LATEST_PREVIEW_V2_MARKER_ATTESTED") {
    if (receipt?.metadataInventoryQueries !== 1 || receipt?.markerGets !== 1 || receipt?.latestCandidateCount !== 1 || receipt?.latestUnique !== true || receipt?.markerStatus !== 200 || !SAFE_DIGEST.test(receipt?.identityDigest ?? "") || !Number.isInteger(receipt?.createdAtMinuteBucket)) errors.push("SUCCESS_GATE");
    if (receipt?.markerV2Contract !== true || receipt?.headersNoStore !== true || receipt?.headersNoSniff !== true || receipt?.noRedirect !== true) errors.push("MARKER_GATE");
  }
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "fin08y-latest-preview-marker-attestation/v1",
    workPackage: "FIN-08Y",
    status: "FIN08Y_TERMINAL_NO_GO_PRECHECK",
    deployments: 0,
    redeployments: 0,
    metadataInventoryQueries: 0,
    inventoryCountBucket: "not_run",
    inventoryOrderVerified: false,
    eligibleReadyPreviewCountBucket: "not_run",
    latestCandidateCount: 0,
    latestUnique: false,
    identityDigest: null,
    createdAtMinuteBucket: null,
    oldDigestExcluded: false,
    markerGets: 0,
    markerHeads: 0,
    otherHttpRequests: 0,
    markerStatus: null,
    markerV2Contract: false,
    headersNoStore: false,
    headersNoSniff: false,
    noRedirect: false,
    aliasMutations: 0,
    environmentMutations: 0,
    databaseOperations: 0,
    payuniOperations: 0,
    playwrightOperations: 0,
    scoreApplied: false,
    safety: { rawOutputPersisted: false, urlPersisted: false, credentialRead: false, rawMarkerPersisted: false },
    strictReadback: false,
  };
}

function reserveReceipt() {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  const receipt = initialReceipt();
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  return receipt;
}

function readProtectedDigests() {
  return [FIN08T_REPORT, FIN08R_REPORT].map((filename) => JSON.parse(fs.readFileSync(filename, "utf8")))
    .map((value) => value?.freshness?.deploymentDigest)
    .filter((value) => typeof value === "string" && SAFE_DIGEST.test(value));
}

function protectedSnapshot() {
  return Object.fromEntries(PROTECTED_FILES.map((relative) => {
    const filename = path.join(ROOT, relative);
    return [relative, fs.existsSync(filename) ? sha256File(filename) : null];
  }));
}

function protectedStable(before) {
  const after = protectedSnapshot();
  return PROTECTED_FILES.every((relative) => before[relative] !== null && before[relative] === after[relative]);
}

function bucket(value) {
  if (!Number.isFinite(value)) return "not_run";
  if (value === 0) return "zero";
  if (value === 1) return "one";
  return "many";
}

async function fetchMarker(url) {
  const response = await fetch(url, { redirect: "manual" });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  return {
    status: response.status,
    redirect: response.status >= 300 && response.status < 400,
    payload,
    headers: { cacheControl: response.headers.get("cache-control"), contentTypeOptions: response.headers.get("x-content-type-options") },
  };
}

async function runLive() {
  const receipt = reserveReceipt();
  try {
    const staged = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: ROOT, windowsHide: true });
    if (staged.status !== 0) return receipt;
    const protectedBefore = protectedSnapshot();
    if (!PROTECTED_FILES.every((relative) => protectedBefore[relative] !== null)) return receipt;
    const oldDigests = readProtectedDigests();
    if (oldDigests.length === 0) return receipt;
    const result = spawnSync(process.execPath, [VERCEL_JS, ...buildMetadataArgs()], {
      cwd: ROOT, env: buildSafeEnvironment(), encoding: "utf8", shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    });
    receipt.metadataInventoryQueries = 1;
    if (!protectedStable(protectedBefore)) {
      receipt.status = "FIN08Y_TERMINAL_NO_GO_METADATA";
      return receipt;
    }
    const parsed = parseInventory(result.stdout, result.status ?? 1, { protectedDigests: oldDigests });
    receipt.inventoryCountBucket = bucket(parsed.rows.length);
    receipt.inventoryOrderVerified = parsed.orderOk;
    receipt.eligibleReadyPreviewCountBucket = bucket(parsed.eligible.length);
    receipt.latestCandidateCount = parsed.latestCandidateCount;
    receipt.latestUnique = parsed.latestUnique;
    if (!parsed.parseOk || !parsed.orderOk || !parsed.latest) {
      receipt.status = "FIN08Y_TERMINAL_NO_GO_METADATA";
      return receipt;
    }
    receipt.identityDigest = parsed.latest.identityDigest;
    receipt.createdAtMinuteBucket = Math.floor(parsed.latest.createdAt / 60_000);
    receipt.oldDigestExcluded = true;
    const markerUrl = buildMarkerUrl(parsed.latest.url);
    if (!markerUrl) {
      receipt.status = "FIN08Y_TERMINAL_NO_GO_MARKER";
      return receipt;
    }
    const marker = await fetchMarker(markerUrl);
    receipt.markerGets = 1;
    receipt.markerStatus = marker.status;
    receipt.noRedirect = !marker.redirect;
    const validation = validateMarkerResponse(marker);
    receipt.markerV2Contract = validation.errors.includes("V2_CONTRACT") === false && marker.payload !== null;
    receipt.headersNoStore = validation.errors.includes("CACHE_CONTROL") === false;
    receipt.headersNoSniff = validation.errors.includes("NOSNIFF") === false;
    if (!validation.ok) {
      receipt.status = "FIN08Y_TERMINAL_NO_GO_MARKER";
      return receipt;
    }
    receipt.status = "FIN08Y_LATEST_PREVIEW_V2_MARKER_ATTESTED";
    return receipt;
  } catch {
    receipt.status = receipt.metadataInventoryQueries === 0 ? "FIN08Y_TERMINAL_NO_GO_PRECHECK" : receipt.markerGets === 0 ? "FIN08Y_TERMINAL_NO_GO_METADATA" : "FIN08Y_TERMINAL_NO_GO_MARKER";
    return receipt;
  }
}

function writeFinal(receipt) {
  const validation = validateReceipt(receipt);
  receipt.strictReadback = validation.ok;
  if (!validation.ok && receipt.status === "FIN08Y_LATEST_PREVIEW_V2_MARKER_ATTESTED") receipt.status = "FIN08Y_TERMINAL_NO_GO_RECEIPT";
  receipt.canonicalDigest = `sha256:${crypto.createHash("sha256").update(canonical({ ...receipt, canonicalDigest: null }), "utf8").digest("hex")}`;
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, "utf8");
  return validation;
}

function verifyReceipt(filename) {
  const receipt = JSON.parse(fs.readFileSync(filename, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(JSON.stringify({ workPackage: "FIN-08Y", status: receipt.status, strictReadback: validation.ok, errors: validation.errors }) + "\n");
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-receipt" && process.argv[3]) verifyReceipt(process.argv[3]);
  else if (process.argv[2] === "--attest-once") {
    const receipt = await runLive();
    writeFinal(receipt);
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08Y", status: receipt.status, deployments: receipt.deployments, metadataInventoryQueries: receipt.metadataInventoryQueries, latestCandidateCount: receipt.latestCandidateCount, markerGets: receipt.markerGets, markerStatus: receipt.markerStatus, scoreApplied: receipt.scoreApplied }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08Y", status: "USAGE" }) + "\n");
    process.exitCode = 2;
  }
}
