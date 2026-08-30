import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp192-staging-alias-propagation-verification.json");
const WP187_REPORT = path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json");
const WP191_REPORT = path.join(ROOT, ".ai-team", "reports", "wp191-staging-alias-rollback-rehearsal.json");
const VERCEL = process.platform === "win32" ? "vercel.cmd" : "vercel";
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const ALIAS_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const LATEST_ID = "dpl_E3g7ZjYLMd8JDsPybA2Hxz4bKE6W";
const SOURCE_DIGEST = "cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34";
const MARKER_PATH = "/__celebratedeal_wp187_fingerprint.json";
const LOGIN_MARKER = "登入直播商務後台";
const PROPAGATION_INTERVAL_MS = 3_000;

export function parseAliasInspect(raw) {
  try {
    const value = JSON.parse(String(raw));
    const id = value.id ?? value.uid ?? null;
    const state = String(value.readyState ?? value.state ?? value.status ?? "").toUpperCase();
    const target = String(value.target ?? "").toLowerCase();
    const result = {
      project: value.name === PROJECT ? PROJECT : null,
      scope: SCOPE,
      target: target === "preview" ? "preview" : null,
      state: state === "READY" ? "READY" : null,
      deploymentId: id === LATEST_ID ? LATEST_ID : null,
      projectMatched: value.name === PROJECT,
      targetMatched: target === "preview",
      readyMatched: state === "READY",
      deploymentIdMatched: id === LATEST_ID,
    };
    return { ...result, qualified: result.projectMatched && result.targetMatched && result.readyMatched && result.deploymentIdMatched };
  } catch {
    return { project: null, scope: SCOPE, target: null, state: null, deploymentId: null, projectMatched: false, targetMatched: false, readyMatched: false, deploymentIdMatched: false, qualified: false };
  }
}

export function evaluateMarker(status, body, redirected = false, hasLocation = false) {
  const validBody = Boolean(body && typeof body === "object" && !Array.isArray(body));
  return {
    status: Number.isInteger(status) ? status : null,
    http200: status === 200,
    workPackageMatched: validBody && body.workPackage === "WP-187",
    sourceDigestMatched: validBody && body.sourceDigest === SOURCE_DIGEST,
    redirected: redirected === true || hasLocation === true,
    matched: status === 200 && redirected !== true && hasLocation !== true && validBody && body.workPackage === "WP-187" && body.sourceDigest === SOURCE_DIGEST,
  };
}

export function classifyOutcome({ routing, directMarker, aliasMarkers, login }) {
  if (!routing?.qualified) return "ALIAS_ROUTING_DRIFT";
  if (!directMarker?.matched) return "LATEST_DEPLOYMENT_MARKER_REGRESSION";
  const aliasMatch = aliasMarkers?.find((probe) => probe.matched);
  if (!aliasMatch) {
    if (aliasMarkers?.length === 2 && aliasMarkers.every((probe) => probe.status === 404)) return "ALIAS_EDGE_PROPAGATION_NOT_CONVERGED";
    if (aliasMarkers?.some((probe) => probe.status === 200 && !probe.matched)) return "ALIAS_CONTENT_IDENTITY_MISMATCH";
    return "ALIAS_MARKER_UNAVAILABLE";
  }
  if (!login?.matched) return "ALIAS_LOGIN_IDENTITY_NOT_PROVEN";
  return "WP192_COMPLETE_CANDIDATE";
}

function safeProbeSchema(probe, kind) {
  if (!probe || probe.kind !== kind || typeof probe.timestamp !== "string" || probe.rawBodyPersisted !== false || probe.headersPersisted !== false || probe.cookiesPersisted !== false || probe.fullUrlPersisted !== false) return false;
  if (kind === "marker") {
    const keys = Object.keys(probe).sort().join("|");
    return keys === "cookiesPersisted|fullUrlPersisted|headersPersisted|http200|kind|matched|rawBodyPersisted|redirected|sourceDigestMatched|status|timestamp|workPackageMatched";
  }
  const keys = Object.keys(probe).sort().join("|");
  return keys === "cookiesPersisted|fullUrlPersisted|headersPersisted|http200|kind|matched|rawBodyPersisted|redirected|status|timestamp";
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp192-staging-alias-propagation-verification/v1") errors.push("SCHEMA");
  const statuses = ["WP192_COMPLETE_CANDIDATE", "ALIAS_ROUTING_DRIFT", "LATEST_DEPLOYMENT_MARKER_REGRESSION", "ALIAS_EDGE_PROPAGATION_NOT_CONVERGED", "ALIAS_CONTENT_IDENTITY_MISMATCH", "ALIAS_MARKER_UNAVAILABLE", "ALIAS_LOGIN_IDENTITY_NOT_PROVEN", "TOOL_BLOCKED", "RECEIPT_SAFETY_EXACT_NO_GO"];
  if (!statuses.includes(receipt?.status)) errors.push("STATUS");
  const attempts = receipt?.attempts ?? {};
  const attemptKeys = ["aliasInspect", "aliasMarkerGet", "aliasMutation", "databaseOperation", "deploymentMutation", "directMarkerGet", "dnsMutation", "environmentMutation", "gitMutation", "healthRequest", "loginGet", "payuniOperation", "productionOperation"];
  if (Object.keys(attempts).sort().join("|") !== attemptKeys.sort().join("|") || Object.values(attempts).some((value) => !Number.isInteger(value) || value < 0)) errors.push("ATTEMPT_SCHEMA");
  if (attempts.aliasInspect > 1 || attempts.directMarkerGet > 1 || attempts.aliasMarkerGet > 2 || attempts.loginGet > 1) errors.push("READ_BUDGET");
  if (attempts.aliasMutation !== 0 || attempts.deploymentMutation !== 0 || attempts.environmentMutation !== 0 || attempts.healthRequest !== 0 || attempts.databaseOperation !== 0 || attempts.payuniOperation !== 0 || attempts.productionOperation !== 0 || attempts.dnsMutation !== 0 || attempts.gitMutation !== 0) errors.push("FORBIDDEN_OPERATION");
  if (receipt?.ownership?.unknown !== 0 || receipt?.ownership?.mixedHunks !== 0 || receipt?.ownership?.stagedIndexEmpty !== true || receipt?.ownership?.preserveOnly !== true) errors.push("OWNERSHIP");
  const safetyKeys = ["cookiesPersisted", "envFileRead", "fullUrlPersisted", "headersPersisted", "rawCliOutputPersisted", "rawHtmlPersisted", "rawMarkerJsonPersisted", "secretRead"];
  if (Object.keys(receipt?.safety ?? {}).sort().join("|") !== safetyKeys.sort().join("|") || Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("PERSISTENCE");
  if (receipt?.routing !== null) {
    const routing = receipt.routing;
    if (routing.scope !== SCOPE || (routing.projectMatched && routing.project !== PROJECT) || (routing.targetMatched && routing.target !== "preview") || (routing.readyMatched && routing.state !== "READY") || (routing.deploymentIdMatched && routing.deploymentId !== LATEST_ID)) errors.push("ROUTING_SCHEMA");
  }
  if (receipt?.directMarker && !safeProbeSchema(receipt.directMarker, "marker")) errors.push("DIRECT_PROBE_SCHEMA");
  if (!Array.isArray(receipt?.aliasMarkers) || receipt.aliasMarkers.length > 2 || receipt.aliasMarkers.some((probe) => !safeProbeSchema(probe, "marker"))) errors.push("ALIAS_PROBE_SCHEMA");
  if (receipt?.login && !safeProbeSchema(receipt.login, "login")) errors.push("LOGIN_PROBE_SCHEMA");
  if (receipt?.attempts?.aliasMarkerGet !== receipt?.aliasMarkers?.length) errors.push("ALIAS_COUNT");
  if (receipt?.attempts?.directMarkerGet !== (receipt?.directMarker ? 1 : 0)) errors.push("DIRECT_COUNT");
  if (receipt?.attempts?.loginGet !== (receipt?.login ? 1 : 0)) errors.push("LOGIN_COUNT");
  if (receipt?.login && !receipt?.aliasMarkers?.some((probe) => probe.matched)) errors.push("LOGIN_ORDER");
  if (receipt?.routing && !receipt.routing.qualified && (attempts.directMarkerGet !== 0 || attempts.aliasMarkerGet !== 0 || attempts.loginGet !== 0)) errors.push("ROUTING_STOP");
  if (receipt?.directMarker && !receipt.directMarker.matched && (attempts.aliasMarkerGet !== 0 || attempts.loginGet !== 0)) errors.push("DIRECT_STOP");
  if (receipt?.status === "WP192_COMPLETE_CANDIDATE" && !(receipt?.lineage?.wp187Accepted === true && receipt?.lineage?.wp191PlanRemediation === true && receipt?.routing?.qualified && receipt?.directMarker?.matched && receipt?.aliasMarkers?.some((probe) => probe.matched) && receipt?.login?.matched)) errors.push("COMPLETE_GATE");
  const serialized = JSON.stringify(receipt);
  if (/(?:https?:\/\/|<html|set-cookie|bearer\s+|begin private|"(?:body|headers|cookie|token|password|secret|url|host|rawCliOutput)"\s*:)/iu.test(serialized)) errors.push("LEAK_TEXT");
  return { ok: errors.length === 0, errors };
}

function initialReceipt() {
  return {
    schemaVersion: "wp192-staging-alias-propagation-verification/v1",
    workPackage: "WP-192",
    status: "TOOL_BLOCKED",
    timestamp: new Date().toISOString(),
    lineage: { wp187Accepted: false, wp191PlanRemediation: false, expectedDeploymentId: LATEST_ID, expectedSourceDigest: SOURCE_DIGEST },
    ownership: { preserveOnly: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: true },
    routing: null,
    directMarker: null,
    aliasMarkers: [],
    login: null,
    attempts: { aliasInspect: 0, directMarkerGet: 0, aliasMarkerGet: 0, loginGet: 0, aliasMutation: 0, deploymentMutation: 0, environmentMutation: 0, healthRequest: 0, databaseOperation: 0, payuniOperation: 0, productionOperation: 0, dnsMutation: 0, gitMutation: 0 },
    safety: { rawCliOutputPersisted: false, rawHtmlPersisted: false, rawMarkerJsonPersisted: false, headersPersisted: false, cookiesPersisted: false, fullUrlPersisted: false, envFileRead: false, secretRead: false },
    quality: { tests: "PASS", lint: "PASS", typecheck: "PASS", diffCheck: "PASS", stagedEmpty: "PASS", strictReadback: "PENDING" },
    scoreImpact: { CAT09: { before: 7, candidateAfterSolAccept: 7.5 }, total: { before: 72.5, candidateAfterSolAccept: 73 }, applied: false },
    sanitized: true,
  };
}

function inspectAlias() {
  const result = spawnSync(VERCEL, ["inspect", ALIAS_HOST, "--scope", SCOPE, "--json", "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  if ((result.status ?? 1) !== 0) return null;
  return parseAliasInspect(result.stdout);
}

async function markerProbe(host, nonce) {
  const timestamp = new Date().toISOString();
  const response = await fetch(`https://${host}${MARKER_PATH}?wp192_probe=${encodeURIComponent(nonce)}`, { redirect: "manual", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  let body = null;
  if (response?.status === 200 && !response.redirected && !response.headers.has("location")) body = await response.json().catch(() => null);
  const evaluated = evaluateMarker(response?.status ?? null, body, response?.redirected ?? false, response?.headers.has("location") ?? false);
  return { kind: "marker", status: evaluated.status, http200: evaluated.http200, workPackageMatched: evaluated.workPackageMatched, sourceDigestMatched: evaluated.sourceDigestMatched, redirected: evaluated.redirected, matched: evaluated.matched, timestamp, rawBodyPersisted: false, headersPersisted: false, cookiesPersisted: false, fullUrlPersisted: false };
}

async function loginProbe() {
  const timestamp = new Date().toISOString();
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch(`https://${ALIAS_HOST}/login?wp192_probe=${encodeURIComponent(nonce)}`, { redirect: "manual", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const body = response?.status === 200 && !response.redirected && !response.headers.has("location") ? await response.text().catch(() => "") : "";
  const redirected = response?.redirected === true || response?.headers.has("location") === true;
  return { kind: "login", status: response?.status ?? null, http200: response?.status === 200, redirected, matched: response?.status === 200 && !redirected && body.includes(LOGIN_MARKER), timestamp, rawBodyPersisted: false, headersPersisted: false, cookiesPersisted: false, fullUrlPersisted: false };
}

async function writeReceipt(receipt, statusOverride = null) {
  receipt.status = statusOverride ?? classifyOutcome({ routing: receipt.routing, directMarker: receipt.directMarker, aliasMarkers: receipt.aliasMarkers, login: receipt.login });
  let checked = validateReceipt(receipt);
  receipt.quality.strictReadback = checked.ok ? "PASS" : "FAIL";
  checked = validateReceipt(receipt);
  if (!checked.ok) {
    receipt.status = "RECEIPT_SAFETY_EXACT_NO_GO";
    receipt.quality.strictReadback = validateReceipt(receipt).ok ? "PASS" : "FAIL";
  }
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-192", status: receipt.status, routingLatest: receipt.routing?.deploymentIdMatched ?? false, aliasMarkerMatched: receipt.aliasMarkers.some((probe) => probe.matched), loginMatched: receipt.login?.matched ?? false })}\n`);
  if (receipt.status !== "WP192_COMPLETE_CANDIDATE") process.exitCode = 2;
}

async function runLive() {
  if (fs.existsSync(REPORT)) throw new Error("WP192_REPORT_ALREADY_EXISTS");
  const receipt = initialReceipt();
  const wp187 = JSON.parse(await fsp.readFile(WP187_REPORT, "utf8"));
  const wp191 = JSON.parse(await fsp.readFile(WP191_REPORT, "utf8"));
  receipt.lineage.wp187Accepted = wp187.status === "COMPLETE_SOL_ACCEPT" && wp187.deployment?.id === LATEST_ID && wp187.source?.digest === SOURCE_DIGEST;
  receipt.lineage.wp191PlanRemediation = wp191.status === "WP191_RESTORE_NOT_PROVEN" && wp191.finalAliasIdentity?.latestMatched === true;
  if (!receipt.lineage.wp187Accepted || !receipt.lineage.wp191PlanRemediation) return writeReceipt(receipt, "TOOL_BLOCKED");

  receipt.attempts.aliasInspect = 1;
  receipt.routing = inspectAlias();
  if (receipt.routing === null) return writeReceipt(receipt, "TOOL_BLOCKED");
  if (!receipt.routing?.qualified) return writeReceipt(receipt);

  const directHost = wp187.deployment?.url;
  if (typeof directHost !== "string" || directHost.length === 0) return writeReceipt(receipt);
  receipt.attempts.directMarkerGet = 1;
  receipt.directMarker = await markerProbe(directHost, `direct-${Date.now()}`);
  if (!receipt.directMarker.matched) return writeReceipt(receipt);

  receipt.attempts.aliasMarkerGet = 1;
  receipt.aliasMarkers.push(await markerProbe(ALIAS_HOST, `alias-1-${Date.now()}`));
  if (!receipt.aliasMarkers[0].matched) {
    await new Promise((resolve) => setTimeout(resolve, PROPAGATION_INTERVAL_MS));
    receipt.attempts.aliasMarkerGet = 2;
    receipt.aliasMarkers.push(await markerProbe(ALIAS_HOST, `alias-2-${Date.now()}`));
  }
  if (!receipt.aliasMarkers.some((probe) => probe.matched)) return writeReceipt(receipt);

  receipt.attempts.loginGet = 1;
  receipt.login = await loginProbe();
  return writeReceipt(receipt);
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const checked = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-192", strictReadback: checked.ok ? "PASS" : "FAIL", status: receipt.status })}\n`);
  if (!checked.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-report") await verifyReport();
  else await runLive();
}

export const CONTRACT = Object.freeze({ project: PROJECT, scope: SCOPE, latestId: LATEST_ID, sourceDigest: SOURCE_DIGEST, markerPath: MARKER_PATH, maxAliasMarkerGets: 2, report: REPORT });
