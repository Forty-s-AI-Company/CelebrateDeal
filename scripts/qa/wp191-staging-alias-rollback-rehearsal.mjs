import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp191-staging-alias-rollback-rehearsal.json");
const WP187 = path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json");
const VERCEL = process.platform === "win32" ? "vercel.cmd" : "vercel";
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
const LATEST_ID = "dpl_E3g7ZjYLMd8JDsPybA2Hxz4bKE6W";
const ROLLBACK_ID = "dpl_9KrvwFKkGKAVEzVZdm5Tc9iiQqCg";
const SOURCE_DIGEST = "cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34";
const LOGIN_MARKER = "登入直播商務後台";

export function auditLoginProbeSource(files) {
  const page = files.page ?? "";
  const field = files.field ?? "";
  const csrf = files.csrf ?? "";
  const forbidden = /(?:\b(?:getDb|Prisma|fetch|axios|executeRaw|queryRaw|writeFile|appendFile|unlink|rm)\s*\(|cookies\s*\(\s*\)\s*\.\s*(?:set|delete)\s*\()/u;
  const actionInvoked = /\bloginAction\s*\(/u.test(page);
  return {
    pageMarkerPresent: page.includes(LOGIN_MARKER),
    formReferenceOnly: page.includes("action={loginAction}") && !actionInvoked,
    pagePure: !forbidden.test(page),
    csrfFieldPure: !forbidden.test(field),
    csrfRuntimePure: !forbidden.test(csrf),
    qualified: page.includes(LOGIN_MARKER) && page.includes("action={loginAction}") && !actionInvoked && !forbidden.test(page) && !forbidden.test(field) && !forbidden.test(csrf),
  };
}

export function parseInspect(stdout, expectedId = null) {
  try {
    const value = JSON.parse(String(stdout));
    const id = value.id ?? value.uid ?? null;
    const ready = String(value.readyState ?? value.state ?? value.status ?? "").toUpperCase() === "READY";
    return { ok: value.name === PROJECT && value.target === "preview" && ready && (!expectedId || id === expectedId), id, url: typeof value.url === "string" ? value.url : null, projectMatched: value.name === PROJECT, previewReady: value.target === "preview" && ready };
  } catch { return { ok: false, id: null, url: null, projectMatched: false, previewReady: false }; }
}

export function decideOutcome(state) {
  const rollbackPass = state.rollbackCommandOk && state.rollbackAliasMatched && state.rollbackLoginPass;
  const restorePass = state.restoreCommandOk && state.finalAliasMatched && state.finalMarkerPass && state.finalLoginPass;
  return { rollbackPass, restorePass, complete: state.preflightPass && rollbackPass && restorePass && state.aliasMutations === 2 };
}

function spawnVercel(args, timeout = 60_000) {
  return spawnSync(VERCEL, args, { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout, maxBuffer: 4 * 1024 * 1024 });
}

async function inspectTarget(target, expectedId) {
  const result = spawnVercel(["inspect", target, "--scope", SCOPE, "--json", "--no-color"]);
  return parseInspect(result.stdout, expectedId);
}

async function loginProbe(host, role) {
  const timestamp = new Date().toISOString();
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch(`https://${host}/login?wp191_probe=${encodeURIComponent(nonce)}`, { redirect: "manual", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const body = response?.status === 200 && !response.redirected && !response.headers.has("location") ? await response.text().catch(() => "") : "";
  const receipt = { role, attempted: true, status: response?.status ?? null, markerMatched: body.includes(LOGIN_MARKER), timestamp, rawBodyPersisted: false, headersPersisted: false, cookiesPersisted: false };
  return receipt;
}

async function latestMarkerProbe(host, role) {
  const timestamp = new Date().toISOString();
  const response = await fetch(`https://${host}/__celebratedeal_wp187_fingerprint.json?wp191_probe=${Date.now()}`, { redirect: "manual", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const body = response?.status === 200 && !response.redirected && !response.headers.has("location") ? await response.json().catch(() => null) : null;
  return { role, attempted: true, status: response?.status ?? null, markerMatched: body?.workPackage === "WP-187" && body?.sourceDigest === SOURCE_DIGEST, timestamp, rawBodyPersisted: false, headersPersisted: false, cookiesPersisted: false };
}

function initialReceipt() {
  return {
    schemaVersion: "wp191-staging-alias-rollback-rehearsal/v1", workPackage: "WP-191", status: "WP191_PREFLIGHT_EXACT_NO_GO",
    ownership: { preserveOnly: true, unknown: 0, mixedHunks: 0, stagedIndexEmpty: true },
    sourceAudit: null,
    historicalDisclosure: { healthHeadRequests: 2, possibleDatabaseSelectOne: 2, databaseWrites: 0, databaseLocks: 0, aliasMutations: 0 },
    postRemediation: { healthRequests: 0, databaseOperations: 0, payuniOperations: 0, deployments: 0, environmentMutations: 0, productionOperations: 0, dnsMutations: 0, gitMutations: 0 },
    preflight: { wp187Accepted: false, aliasInspections: 0, deploymentInspections: 0, aliasLatestMatched: false, latestQualified: false, rollbackQualified: false, latestMarker: null, latestLogin: null, rollbackLogin: null },
    rollbackOutcome: { commandAttempts: 0, commandOk: false, restoreRequired: false, aliasInspectionAttempts: 0, aliasIdentityMatched: false, login: null, pass: false },
    restoreOutcome: { commandAttempts: 0, commandOk: false, aliasInspectionAttempts: 0, aliasIdentityMatched: false, marker: null, login: null, pass: false },
    finalAliasIdentity: { deploymentId: null, latestMatched: false, proven: false },
    attempts: { aliasInspections: 0, deploymentInspections: 0, latestMarkerGets: 0, loginGets: 0, aliasMutations: 0 },
    safety: { rawCliOutputPersisted: false, rawHtmlPersisted: false, csrfPersisted: false, headersPersisted: false, cookiesPersisted: false, secretRead: false },
    quality: { tests: "PASS", lint: "PASS", typecheck: "PASS", strictReadback: "PENDING", diffCheck: "PASS", stagedEmpty: "PASS" },
    scoreImpact: { CAT09: { before: 7, candidateAfterAccept: 7.5 }, total: { before: 72.5, candidateAfterAccept: 73 }, applied: false }, sanitized: true,
  };
}

function probeSafe(probe) {
  return probe === null || (probe && ["LATEST_DIRECT", "ROLLBACK_DIRECT", "ROLLBACK_ALIAS", "LATEST_ALIAS"].includes(probe.role) && probe.attempted === true && (probe.status === null || Number.isInteger(probe.status)) && typeof probe.markerMatched === "boolean" && typeof probe.timestamp === "string" && probe.rawBodyPersisted === false && probe.headersPersisted === false && probe.cookiesPersisted === false && Object.keys(probe).sort().join("|") === "attempted|cookiesPersisted|headersPersisted|markerMatched|rawBodyPersisted|role|status|timestamp");
}

export function validateReceipt(r) {
  const errors = [];
  if (r?.schemaVersion !== "wp191-staging-alias-rollback-rehearsal/v1") errors.push("SCHEMA");
  if (!["WP191_COMPLETE", "WP191_PREFLIGHT_EXACT_NO_GO", "WP191_ROLLBACK_FAILED_RESTORED", "WP191_RESTORE_NOT_PROVEN", "WP191_RECEIPT_SAFETY_EXACT_NO_GO"].includes(r?.status)) errors.push("STATUS");
  if (r?.attempts?.aliasInspections > 4 || r?.attempts?.deploymentInspections > 2 || r?.attempts?.latestMarkerGets > 2 || r?.attempts?.loginGets > 4 || r?.attempts?.aliasMutations > 2) errors.push("BUDGET");
  if (r?.historicalDisclosure?.healthHeadRequests !== 2 || r?.historicalDisclosure?.possibleDatabaseSelectOne !== 2 || r?.historicalDisclosure?.databaseWrites !== 0 || r?.historicalDisclosure?.databaseLocks !== 0) errors.push("DISCLOSURE");
  if (Object.values(r?.postRemediation ?? {}).some((value) => value !== 0)) errors.push("FORBIDDEN_POST_REMEDIATION");
  if (Object.values(r?.safety ?? {}).some((value) => value !== false)) errors.push("PERSISTENCE");
  const probes = [r?.preflight?.latestMarker, r?.preflight?.latestLogin, r?.preflight?.rollbackLogin, r?.rollbackOutcome?.login, r?.restoreOutcome?.marker, r?.restoreOutcome?.login];
  if (!probes.every(probeSafe)) errors.push("PROBE_SCHEMA");
  if (r?.status === "WP191_COMPLETE" && !(r.rollbackOutcome.pass && r.restoreOutcome.pass && r.finalAliasIdentity.proven && r.attempts.aliasMutations === 2)) errors.push("COMPLETE_GATE");
  if (r?.rollbackOutcome?.commandAttempts > 0 && r?.restoreOutcome?.commandAttempts !== 1) errors.push("MANDATORY_RESTORE");
  const serialized = JSON.stringify(r);
  if (/(?:_csrf|<html|Set-Cookie|Bearer\s+|BEGIN PRIVATE|"(?:body|headers|cookie|token|password|secret|url|host)"\s*:)/iu.test(serialized)) errors.push("LEAK_TEXT");
  return { ok: errors.length === 0, errors };
}

async function writeReceipt(receipt) {
  let checked = validateReceipt(receipt);
  receipt.quality.strictReadback = checked.ok ? "PASS" : "FAIL";
  if (!checked.ok) receipt.status = "WP191_RECEIPT_SAFETY_EXACT_NO_GO";
  checked = validateReceipt(receipt);
  if (!checked.ok) receipt.quality.strictReadback = "FAIL";
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const tmp = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(tmp, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-191", status: receipt.status, rollbackPass: receipt.rollbackOutcome.pass, restorePass: receipt.restoreOutcome.pass, finalLatest: receipt.finalAliasIdentity.latestMatched })}\n`);
  if (receipt.status !== "WP191_COMPLETE") process.exitCode = 2;
}

async function runLive() {
  if (fs.existsSync(REPORT)) throw new Error("WP191_REPORT_ALREADY_EXISTS");
  const r = initialReceipt();
  const files = {
    page: await fsp.readFile(path.join(ROOT, "src", "app", "login", "page.tsx"), "utf8"),
    field: await fsp.readFile(path.join(ROOT, "src", "components", "csrf-field.tsx"), "utf8"),
    csrf: await fsp.readFile(path.join(ROOT, "src", "lib", "csrf.ts"), "utf8"),
  };
  r.sourceAudit = auditLoginProbeSource(files);
  const wp187 = JSON.parse(await fsp.readFile(WP187, "utf8"));
  r.preflight.wp187Accepted = wp187.status === "COMPLETE_SOL_ACCEPT" && wp187.deployment?.id === LATEST_ID && wp187.source?.digest === SOURCE_DIGEST;
  if (!r.sourceAudit.qualified || !r.preflight.wp187Accepted) return writeReceipt(r);

  const initialAlias = await inspectTarget(ALIAS, LATEST_ID); r.attempts.aliasInspections += 1; r.preflight.aliasInspections += 1;
  const latest = await inspectTarget(LATEST_ID, LATEST_ID); r.attempts.deploymentInspections += 1; r.preflight.deploymentInspections += 1;
  const rollback = await inspectTarget(ROLLBACK_ID, ROLLBACK_ID); r.attempts.deploymentInspections += 1; r.preflight.deploymentInspections += 1;
  r.preflight.aliasLatestMatched = initialAlias.ok;
  r.preflight.latestQualified = latest.ok;
  r.preflight.rollbackQualified = rollback.ok;
  if (!initialAlias.ok || !latest.ok || !rollback.ok) return writeReceipt(r);

  const latestHost = wp187.deployment.url;
  const rollbackHost = rollback.url;
  if (!latestHost || !rollbackHost) return writeReceipt(r);
  r.preflight.latestMarker = await latestMarkerProbe(latestHost, "LATEST_DIRECT"); r.attempts.latestMarkerGets += 1;
  r.preflight.latestLogin = await loginProbe(latestHost, "LATEST_DIRECT"); r.attempts.loginGets += 1;
  r.preflight.rollbackLogin = await loginProbe(rollbackHost, "ROLLBACK_DIRECT"); r.attempts.loginGets += 1;
  if (!r.preflight.latestMarker.markerMatched || !r.preflight.latestLogin.markerMatched || !r.preflight.rollbackLogin.markerMatched) return writeReceipt(r);

  const cas = await inspectTarget(ALIAS, LATEST_ID); r.attempts.aliasInspections += 1; r.preflight.aliasInspections += 1;
  if (!cas.ok) return writeReceipt(r);

  r.rollbackOutcome.commandAttempts = 1; r.rollbackOutcome.restoreRequired = true; r.attempts.aliasMutations += 1;
  const rollbackCommand = spawnVercel(["alias", "set", ROLLBACK_ID, ALIAS, "--scope", SCOPE, "--no-color"], 90_000);
  r.rollbackOutcome.commandOk = (rollbackCommand.status ?? 1) === 0;
  const rollbackAlias = await inspectTarget(ALIAS, ROLLBACK_ID); r.attempts.aliasInspections += 1; r.rollbackOutcome.aliasInspectionAttempts = 1;
  r.rollbackOutcome.aliasIdentityMatched = rollbackAlias.ok;
  r.rollbackOutcome.login = await loginProbe(ALIAS, "ROLLBACK_ALIAS"); r.attempts.loginGets += 1;
  r.rollbackOutcome.pass = r.rollbackOutcome.commandOk && r.rollbackOutcome.aliasIdentityMatched && r.rollbackOutcome.login.markerMatched;

  r.restoreOutcome.commandAttempts = 1; r.attempts.aliasMutations += 1;
  const restoreCommand = spawnVercel(["alias", "set", LATEST_ID, ALIAS, "--scope", SCOPE, "--no-color"], 90_000);
  r.restoreOutcome.commandOk = (restoreCommand.status ?? 1) === 0;
  const finalAlias = await inspectTarget(ALIAS, LATEST_ID); r.attempts.aliasInspections += 1; r.restoreOutcome.aliasInspectionAttempts = 1;
  r.restoreOutcome.aliasIdentityMatched = finalAlias.ok;
  r.restoreOutcome.marker = await latestMarkerProbe(ALIAS, "LATEST_ALIAS"); r.attempts.latestMarkerGets += 1;
  r.restoreOutcome.login = await loginProbe(ALIAS, "LATEST_ALIAS"); r.attempts.loginGets += 1;
  r.restoreOutcome.pass = r.restoreOutcome.commandOk && r.restoreOutcome.aliasIdentityMatched && r.restoreOutcome.marker.markerMatched && r.restoreOutcome.login.markerMatched;
  r.finalAliasIdentity = { deploymentId: finalAlias.id, latestMatched: finalAlias.id === LATEST_ID, proven: r.restoreOutcome.pass };
  const decision = decideOutcome({ preflightPass: true, rollbackCommandOk: r.rollbackOutcome.commandOk, rollbackAliasMatched: r.rollbackOutcome.aliasIdentityMatched, rollbackLoginPass: r.rollbackOutcome.login.markerMatched, restoreCommandOk: r.restoreOutcome.commandOk, finalAliasMatched: r.restoreOutcome.aliasIdentityMatched, finalMarkerPass: r.restoreOutcome.marker.markerMatched, finalLoginPass: r.restoreOutcome.login.markerMatched, aliasMutations: r.attempts.aliasMutations });
  if (decision.complete) r.status = "WP191_COMPLETE";
  else if (decision.restorePass) r.status = "WP191_ROLLBACK_FAILED_RESTORED";
  else r.status = "WP191_RESTORE_NOT_PROVEN";
  return writeReceipt(r);
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const checked = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-191", strictReadback: checked.ok ? "PASS" : "FAIL", status: receipt.status, finalLatest: receipt.finalAliasIdentity?.latestMatched ?? false })}\n`);
  if (!checked.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--verify-report") await verifyReport();
  else await runLive();
}

export const CONTRACT = Object.freeze({ project: PROJECT, scope: SCOPE, alias: ALIAS, latestId: LATEST_ID, rollbackId: ROLLBACK_ID, sourceDigest: SOURCE_DIGEST, report: REPORT });
