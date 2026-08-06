import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "fin08z-manual-attested-preview-marker-verification.json");
const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const BASE_SOURCE_DIGEST = "sha256:cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34";
const PROTECTED_FILES = Object.freeze([
  "src/app/__celebratedeal_wp187_fingerprint.json/route.ts",
  "src/app/__celebratedeal_wp187_fingerprint.json/route.test.ts",
  "docs/codex-goal/API_CONTRACT_REGISTRY.md",
]);
const TERMINAL_STATUSES = new Set([
  "FIN08Z_MANUAL_ATTESTED_PREVIEW_V2_MARKER_VERIFIED",
  "FIN08Z_TERMINAL_NO_GO_PRECHECK",
  "FIN08Z_TERMINAL_NO_GO_MARKER",
  "FIN08Z_TERMINAL_NO_GO_RECEIPT",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256File(filename) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex")}`;
}

export function manualAttestation() {
  return Object.freeze({ preview: true, ready: true, ownerConfirmed: true, currentPreview: true, identityConfirmed: true });
}

export function validateManualAttestation(value) {
  const expected = manualAttestation();
  return value && typeof value === "object" && Object.keys(value).sort().join("\u0000") === Object.keys(expected).sort().join("\u0000")
    && Object.keys(expected).every((key) => value[key] === true);
}

export function buildMarkerUrl(baseUrl, markerPath = MARKER_PATH) {
  try {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.port || base.search || base.hash) return null;
    const marker = new URL(markerPath, base);
    if (marker.protocol !== "https:" || marker.username || marker.password || marker.port || marker.search || marker.hash) return null;
    return marker;
  } catch {
    return null;
  }
}

export function validateMarkerResponse({ status, redirect, payload, headers }) {
  const expected = {
    schemaVersion: "celebratedeal-preview-lineage/v2",
    baseWorkPackage: "WP-187",
    baseSourceDigest: BASE_SOURCE_DIGEST,
    remediationWorkPackage: "FIN-08U",
    sourceDigestSemantics: "wp187_base_lineage",
  };
  const errors = [];
  if (status !== 200) errors.push("STATUS");
  if (redirect) errors.push("REDIRECT");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) errors.push("PAYLOAD");
  if (payload && (Object.keys(payload).sort().join("\u0000") !== Object.keys(expected).sort().join("\u0000")
    || Object.keys(expected).some((key) => payload[key] !== expected[key]))) errors.push("V2_CONTRACT");
  const cache = String(headers?.cacheControl ?? "").toLowerCase();
  if (!cache.includes("no-store") || !cache.includes("max-age=0")) errors.push("CACHE_CONTROL");
  if (String(headers?.contentTypeOptions ?? "").toLowerCase() !== "nosniff") errors.push("NOSNIFF");
  return { ok: errors.length === 0, errors };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "fin08z-manual-attested-preview-marker-verification/v1") errors.push("SCHEMA");
  if (!TERMINAL_STATUSES.has(receipt?.status)) errors.push("STATUS");
  if (!validateManualAttestation(receipt?.manualAttestation)) errors.push("ATTESTATION");
  if (receipt?.metadataQueries !== 0 || receipt?.markerGets > 1 || receipt?.markerHeads !== 0 || receipt?.otherHttpRequests !== 0) errors.push("READ_BUDGET");
  if (receipt?.deployments !== 0 || receipt?.redeployments !== 0 || receipt?.aliasMutations !== 0 || receipt?.environmentMutations !== 0) errors.push("MUTATION");
  if (receipt?.databaseOperations !== 0 || receipt?.payuniOperations !== 0 || receipt?.playwrightOperations !== 0) errors.push("SIDE_EFFECT");
  if (receipt?.scoreApplied !== false) errors.push("SCORE");
  if (receipt?.safety?.rawResponsePersisted !== false || receipt?.safety?.urlPersisted !== false || receipt?.safety?.credentialRead !== false || receipt?.safety?.manualTextPersisted !== false) errors.push("SAFETY");
  if (/(?:https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:token|credential|cookie|password)"\s*:)/iu.test(JSON.stringify(receipt))) errors.push("SENSITIVE_TEXT");
  if (receipt?.status === "FIN08Z_MANUAL_ATTESTED_PREVIEW_V2_MARKER_VERIFIED") {
    if (receipt?.markerGets !== 1 || receipt?.markerStatus !== 200 || receipt?.redirects !== 0 || receipt?.v2Contract !== true || receipt?.headersNoStore !== true || receipt?.headersNoSniff !== true) errors.push("SUCCESS_GATE");
  }
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "fin08z-manual-attested-preview-marker-verification/v1",
    workPackage: "FIN-08Z",
    status: "FIN08Z_TERMINAL_NO_GO_PRECHECK",
    manualAttestation: manualAttestation(),
    metadataQueries: 0,
    markerGets: 0,
    markerHeads: 0,
    otherHttpRequests: 0,
    markerStatus: null,
    redirects: 0,
    v2Contract: false,
    headersNoStore: false,
    headersNoSniff: false,
    deployments: 0,
    redeployments: 0,
    aliasMutations: 0,
    environmentMutations: 0,
    databaseOperations: 0,
    payuniOperations: 0,
    playwrightOperations: 0,
    scoreApplied: false,
    safety: { rawResponsePersisted: false, urlPersisted: false, credentialRead: false, manualTextPersisted: false },
    strictReadback: false,
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

function protectedStable(before) {
  const after = protectedSnapshot();
  return PROTECTED_FILES.every((relative) => before[relative] !== null && before[relative] === after[relative]);
}

async function fetchMarker(url) {
  const response = await fetch(url, { redirect: "manual" });
  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }
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
    const protectedBefore = protectedSnapshot();
    if (!PROTECTED_FILES.every((relative) => protectedBefore[relative] !== null)) return receipt;
    if (!validateManualAttestation(receipt.manualAttestation)) return receipt;
    if (process.argv[2] !== "--verify-once" || process.argv[3] !== "--manual-attestation-confirmed") return receipt;
    const markerBase = process.argv[4] === "--marker-base-url" ? process.argv[5] : null;
    const markerUrl = buildMarkerUrl(markerBase);
    if (!markerUrl) return receipt;
    const marker = await fetchMarker(markerUrl);
    receipt.markerGets = 1;
    receipt.markerStatus = marker.status;
    receipt.redirects = marker.redirect ? 1 : 0;
    const validation = validateMarkerResponse(marker);
    receipt.v2Contract = validation.errors.includes("V2_CONTRACT") === false && marker.payload !== null;
    receipt.headersNoStore = validation.errors.includes("CACHE_CONTROL") === false;
    receipt.headersNoSniff = validation.errors.includes("NOSNIFF") === false;
    if (!protectedStable(protectedBefore) || !validation.ok) {
      receipt.status = "FIN08Z_TERMINAL_NO_GO_MARKER";
      return receipt;
    }
    receipt.status = "FIN08Z_MANUAL_ATTESTED_PREVIEW_V2_MARKER_VERIFIED";
    return receipt;
  } catch {
    receipt.status = receipt.markerGets === 0 ? "FIN08Z_TERMINAL_NO_GO_PRECHECK" : "FIN08Z_TERMINAL_NO_GO_MARKER";
    return receipt;
  }
}

function writeFinal(receipt) {
  const validation = validateReceipt(receipt);
  receipt.strictReadback = validation.ok;
  if (!validation.ok && receipt.status === "FIN08Z_MANUAL_ATTESTED_PREVIEW_V2_MARKER_VERIFIED") receipt.status = "FIN08Z_TERMINAL_NO_GO_RECEIPT";
  receipt.canonicalDigest = `sha256:${crypto.createHash("sha256").update(canonical({ ...receipt, canonicalDigest: null }), "utf8").digest("hex")}`;
  fs.writeFileSync(REPORT, `${JSON.stringify(receipt)}\n`, "utf8");
  return validation;
}

function verifyReceipt(filename) {
  const receipt = JSON.parse(fs.readFileSync(filename, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(JSON.stringify({ workPackage: "FIN-08Z", status: receipt.status, strictReadback: validation.ok, errors: validation.errors }) + "\n");
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-receipt" && process.argv[3]) verifyReceipt(process.argv[3]);
  else if (process.argv[2] === "--verify-once") {
    const receipt = await runLive();
    writeFinal(receipt);
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08Z", status: receipt.status, metadataQueries: receipt.metadataQueries, markerGets: receipt.markerGets, markerStatus: receipt.markerStatus, scoreApplied: receipt.scoreApplied }) + "\n");
  } else {
    process.stdout.write(JSON.stringify({ workPackage: "FIN-08Z", status: "USAGE" }) + "\n");
    process.exitCode = 2;
  }
}
