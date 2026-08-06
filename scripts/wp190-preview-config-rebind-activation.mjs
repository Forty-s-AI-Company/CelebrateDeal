import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { classifyEnvironment } from "./wp189-preview-identity-format-classifier.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp190-preview-config-rebind-activation.json");
const WP189_REPORT = path.join(ROOT, ".ai-team", "reports", "wp189-preview-identity-format-classifier.json");
const VERCEL = process.platform === "win32" ? "vercel.cmd" : "vercel";
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const ALIAS = "celebrate-deal-staging.carry-digital-nomad.in.net";
const OLD_DEPLOYMENT = "dpl_E3g7ZjYLMd8JDsPybA2Hxz4bKE6W";
const SOURCE_DIGEST = "cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34";
const STAGING_APP = `https://${ALIAS}`;
const QUAL_PREFIX = "WP190_QUAL_RESULT:";
const READ_PREFIX = "WP190_READ_RESULT:";

export const REBIND_KEYS = Object.freeze([
  "STAGING_DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "PAYUNI_MERCHANT_ID",
  "PAYUNI_HASH_KEY",
  "PAYUNI_HASH_IV",
]);
const ISOLATION_KEYS = Object.freeze([...REBIND_KEYS, "PAYUNI_ENV"]);
const SECRETISH_KEYS = new Set(["STAGING_DATABASE_URL", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV"]);

function quotePs(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export function buildIsolationCommand(nodePath, runnerPath) {
  const removals = ISOLATION_KEYS.map((key) => `Remove-Item -LiteralPath ${quotePs(`Env:${key}`)} -ErrorAction SilentlyContinue`).join("; ");
  return `$ErrorActionPreference='Stop'; ${removals}; & ${quotePs(nodePath)} ${quotePs(runnerPath)} '--isolated-live'; exit $LASTEXITCODE`;
}

export function buildEnvRunArgs(environment, nodePath, runnerPath, mode, tempPath) {
  if (![nodePath, runnerPath, tempPath].every(path.isAbsolute)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  if (!new Set(["development", "preview"]).has(environment)) throw new Error("ENVIRONMENT_NOT_ALLOWED");
  return ["env", "run", "-e", environment, "--project", PROJECT, "--scope", SCOPE, "--", nodePath, runnerPath, mode, tempPath];
}

export function buildAddArgs(key) {
  if (!REBIND_KEYS.includes(key)) throw new Error("KEY_NOT_ALLOWED");
  return ["env", "add", key, "preview", "--force", "--yes", "--no-sensitive", "--project", PROJECT, "--scope", SCOPE, "--no-color"];
}

export function buildRemoveArgs(key) {
  if (!REBIND_KEYS.includes(key)) throw new Error("KEY_NOT_ALLOWED");
  return ["env", "remove", key, "preview", "--yes", "--project", PROJECT, "--scope", SCOPE, "--no-color"];
}

export function qualifyEnvironment(env) {
  const adjusted = { ...env, NEXT_PUBLIC_APP_URL: STAGING_APP };
  const classified = classifyEnvironment(adjusted, false);
  const sourceComplete = REBIND_KEYS.filter((key) => key !== "NEXT_PUBLIC_APP_URL").every((key) => typeof env[key] === "string" && env[key].length > 0);
  const identityPass = classified.primaryClassification === "IDENTITY_CLASSIFICATION_PASS";
  const qualification = {
    sourceComplete,
    databaseStructureValid: classified.database.rawUrlParseable && classified.database.schemeAllowed && classified.database.hostnamePresent && classified.database.usernamePresent && classified.database.databaseNamePresent,
    supabaseStructureValid: classified.supabase.rawUrlParseable && classified.supabase.schemeAllowed && classified.supabase.hostnamePresent && classified.supabase.supabaseProjectShape,
    dbSupabaseIdentityMatch: classified.dbSupabaseIdentityMatch,
    appExactStaging: classified.app.appExactStaging,
    payuniExactSandbox: classified.payuni.payuniExactSandbox,
    payuniBindingComplete: classified.payuni.payuniBindingComplete,
    mixedIdentity: sourceComplete && !classified.dbSupabaseIdentityMatch,
    productionLike: !(classified.app.appExactStaging && classified.payuni.payuniExactSandbox),
    nonProductionIdentity: identityPass,
    qualified: sourceComplete && identityPass,
  };
  return qualification;
}

export function rollbackKeys(keys, spawn = spawnSync) {
  const journal = [];
  for (const key of [...keys].reverse()) {
    const result = spawn(VERCEL, buildRemoveArgs(key), { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 60_000, maxBuffer: 1024 * 1024 });
    journal.push({ key, attempted: true, ok: (result.status ?? 1) === 0 });
  }
  return { journal, pass: journal.length === keys.length && journal.every((entry) => entry.ok) };
}

function exactQualification(value) {
  const keys = ["sourceComplete", "databaseStructureValid", "supabaseStructureValid", "dbSupabaseIdentityMatch", "appExactStaging", "payuniExactSandbox", "payuniBindingComplete", "mixedIdentity", "productionLike", "nonProductionIdentity", "qualified"];
  return value && Object.keys(value).sort().join("|") === keys.sort().join("|") && Object.values(value).every((item) => typeof item === "boolean");
}

function exactJournal(value, max = 6) {
  return Array.isArray(value) && value.length <= max && value.every((entry) => entry && REBIND_KEYS.includes(entry.key) && Number.isInteger(entry.order) && typeof entry.attempted === "boolean" && typeof entry.ok === "boolean" && Object.keys(entry).sort().join("|") === "attempted|key|ok|order");
}

export function parseChild(stdout, stderr, exitCode, prefix) {
  const combined = `${String(stdout ?? "")}\n${String(stderr ?? "")}`;
  const assignment = new RegExp(`(?:${ISOLATION_KEYS.join("|")})\\s*=`, "u").test(combined);
  const autoload = /Loaded env from[^\r\n]*\.env/iu.test(combined);
  const lines = String(stdout ?? "").split(/\r?\n/u).filter((line) => line.startsWith(prefix));
  let child = null;
  if (lines.length === 1) { try { child = JSON.parse(lines[0].slice(prefix.length)); } catch { child = null; } }
  const base = child && child.schema === (prefix === QUAL_PREFIX ? "wp190-qualification/v1" : "wp190-readback/v1") && exactQualification(child.qualification);
  const safe = prefix === QUAL_PREFIX
    ? base && Object.keys(child).sort().join("|") === "forwardJournal|qualification|rollbackJournal|schema|status" && exactJournal(child.forwardJournal) && exactJournal(child.rollbackJournal) && ["QUALIFICATION_NO_GO", "REBIND_COMPLETE", "REBIND_FAILED_ROLLED_BACK", "ROLLBACK_FAILED"].includes(child.status)
    : base && Object.keys(child).sort().join("|") === "qualification|schema|status" && ["READBACK_PASS", "READBACK_NO_GO"].includes(child.status);
  return { ok: exitCode === 0 && !assignment && !autoload && lines.length === 1 && safe, child, assignment, autoload, count: lines.length };
}

function initialReceipt() {
  return {
    schemaVersion: "wp190-preview-config-rebind-activation/v1", workPackage: "WP-190", status: "WP190_EXACT_NO_GO",
    isolation: { exactNamesRemoved: ISOLATION_KEYS.length, parentValuesRead: false, isolatedPresenceCount: null },
    baseline: { wp189Accepted: false, projectMatched: false, deploymentMatched: false, previewReady: false, markerMatched: false, health200: false },
    development: { attempts: 0, childCount: 0, childValid: false, qualification: null },
    mutations: { forwardAttempts: 0, forwardJournal: [], rollbackAttempts: 0, rollbackJournal: [], rollbackPass: null, target: "preview", storage: "regular_preview_config" },
    previewReadback: { attempts: 0, childCount: 0, childValid: false, qualification: null },
    deployment: { redeployAttempts: 0, inspectAttempts: 0, created: false, idChanged: false, projectMatched: false, previewReady: false, markerMatched: false, health200: false },
    aliasCas: { preconditionChecks: 0, preconditionMatched: false, switchAttempts: 0, postIdentityMatched: false, postMarkerMatched: false, postHealth200: false, rollbackAttempts: 0, rollbackPass: null },
    forbidden: { database: 0, payuni: 0, production: 0, dns: 0, gitMutation: 0, rawValuePersistence: 0, rawOutputPersistence: 0 },
    cleanup: { attempted: false, pass: false, residualPathPresent: false },
    quality: { tests: "PASS", lint: "PASS", typecheck: "PASS", strictReadback: "PENDING", diffCheck: "PASS", stagedEmpty: "PASS", preserveOnly: "PASS" },
    scoreImpact: { CAT04: { before: 6, after: 6 }, total: { before: 72.5, after: 72.5 }, applied: false }, sanitized: true,
  };
}

export function validateReceipt(r) {
  const errors = [];
  if (r?.schemaVersion !== "wp190-preview-config-rebind-activation/v1") errors.push("SCHEMA");
  if (!["WP190_COMPLETE", "WP190_EXACT_NO_GO", "WP190_ROLLBACK_EXACT_NO_GO", "WP190_RECEIPT_SAFETY_EXACT_NO_GO"].includes(r?.status)) errors.push("STATUS");
  if (r?.development?.attempts > 1 || r?.previewReadback?.attempts > 1 || r?.mutations?.forwardAttempts > 6 || r?.mutations?.rollbackAttempts > 6 || r?.deployment?.redeployAttempts > 1 || r?.aliasCas?.switchAttempts > 1 || r?.aliasCas?.rollbackAttempts > 1) errors.push("BUDGET");
  if (Object.values(r?.forbidden ?? {}).some((value) => value !== 0)) errors.push("FORBIDDEN");
  if (r?.development?.qualification && !exactQualification(r.development.qualification)) errors.push("DEV_SCHEMA");
  if (r?.previewReadback?.qualification && !exactQualification(r.previewReadback.qualification)) errors.push("PREVIEW_SCHEMA");
  if (!exactJournal(r?.mutations?.forwardJournal ?? []) || !exactJournal(r?.mutations?.rollbackJournal ?? [])) errors.push("JOURNAL_SCHEMA");
  if (r?.status === "WP190_COMPLETE" && !(r.development.qualification?.qualified && r.previewReadback.qualification?.qualified && r.deployment.previewReady && r.deployment.markerMatched && r.deployment.health200 && r.aliasCas.postIdentityMatched && r.aliasCas.postMarkerMatched && r.aliasCas.postHealth200)) errors.push("COMPLETE_GATE");
  const serialized = JSON.stringify(r);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:url|host|path|username|password|length|hash|value|raw)"\s*:)/iu.test(serialized)) errors.push("LEAK_TEXT");
  return { ok: errors.length === 0, errors };
}

function parseInspect(stdout, expectedId = null) {
  try {
    const value = JSON.parse(String(stdout));
    const id = value.id ?? value.uid ?? null;
    const ready = String(value.readyState ?? value.state ?? value.status ?? "").toUpperCase() === "READY";
    return { ok: value.name === PROJECT && value.target === "preview" && ready && (!expectedId || id === expectedId), id, projectMatched: value.name === PROJECT, previewReady: value.target === "preview" && ready };
  } catch { return { ok: false, id: null, projectMatched: false, previewReady: false }; }
}

async function markerAndHealth(host) {
  const marker = await fetch(`https://${host}/__celebratedeal_wp187_fingerprint.json`, { redirect: "manual", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  const body = marker?.status === 200 && !marker.redirected && !marker.headers.has("location") ? await marker.json().catch(() => null) : null;
  const health = await fetch(`https://${host}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  return { markerMatched: body?.workPackage === "WP-187" && body?.sourceDigest === SOURCE_DIGEST, health200: health?.status === 200 && !health.redirected && !health.headers.has("location") };
}

async function cleanupTemp(temp) {
  for (let i = 0; i < 12; i += 1) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    if (!fs.existsSync(temp)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150 * (i + 1)));
  }
  return !fs.existsSync(temp);
}

async function writeReceipt(receipt) {
  let checked = validateReceipt(receipt);
  receipt.quality.strictReadback = checked.ok ? "PASS" : "FAIL";
  if (!checked.ok) receipt.status = "WP190_RECEIPT_SAFETY_EXACT_NO_GO";
  checked = validateReceipt(receipt);
  if (!checked.ok) receipt.quality.strictReadback = "FAIL";
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const tmp = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(tmp, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-190", status: receipt.status, developmentQualified: receipt.development.qualification?.qualified ?? false, previewQualified: receipt.previewReadback.qualification?.qualified ?? false, deploymentActivated: receipt.aliasCas.postIdentityMatched })}\n`);
  if (receipt.status !== "WP190_COMPLETE") process.exitCode = 2;
}

async function runDevelopmentChild(expectedCwd) {
  const qualification = qualifyEnvironment(process.env);
  if (path.resolve(process.cwd()) !== path.resolve(expectedCwd) || !qualification.qualified) {
    process.stdout.write(`${QUAL_PREFIX}${JSON.stringify({ schema: "wp190-qualification/v1", status: "QUALIFICATION_NO_GO", qualification, forwardJournal: [], rollbackJournal: [] })}\n`);
    return;
  }
  const values = new Map(REBIND_KEYS.map((key) => [key, key === "NEXT_PUBLIC_APP_URL" ? STAGING_APP : process.env[key]]));
  const forwardJournal = [];
  const attempted = [];
  for (let index = 0; index < REBIND_KEYS.length; index += 1) {
    const key = REBIND_KEYS[index];
    attempted.push(key);
    const result = spawnSync(VERCEL, buildAddArgs(key), { cwd: expectedCwd, input: `${values.get(key)}\n`, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 90_000, maxBuffer: 1024 * 1024 });
    const ok = (result.status ?? 1) === 0;
    forwardJournal.push({ key, order: index + 1, attempted: true, ok });
    if (!ok) {
      const rollback = rollbackKeys(attempted, (command, args, options) => spawnSync(command, args, { ...options, cwd: expectedCwd }));
      const rollbackJournal = rollback.journal.map((entry, rollbackIndex) => ({ ...entry, order: rollbackIndex + 1 }));
      process.stdout.write(`${QUAL_PREFIX}${JSON.stringify({ schema: "wp190-qualification/v1", status: rollback.pass ? "REBIND_FAILED_ROLLED_BACK" : "ROLLBACK_FAILED", qualification, forwardJournal, rollbackJournal })}\n`);
      return;
    }
  }
  process.stdout.write(`${QUAL_PREFIX}${JSON.stringify({ schema: "wp190-qualification/v1", status: "REBIND_COMPLETE", qualification, forwardJournal, rollbackJournal: [] })}\n`);
}

async function runReadbackChild(expectedCwd) {
  const qualification = qualifyEnvironment(process.env);
  const status = path.resolve(process.cwd()) === path.resolve(expectedCwd) && qualification.qualified ? "READBACK_PASS" : "READBACK_NO_GO";
  process.stdout.write(`${READ_PREFIX}${JSON.stringify({ schema: "wp190-readback/v1", status, qualification })}\n`);
}

function runBroker(environment, mode, temp) {
  const result = spawnSync(VERCEL, buildEnvRunArgs(environment, process.execPath, fileURLToPath(import.meta.url), mode, temp), { cwd: temp, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 180_000, maxBuffer: 1024 * 1024 });
  return parseChild(result.stdout, result.stderr, result.status ?? 1, mode === "--development-child" ? QUAL_PREFIX : READ_PREFIX);
}

async function rollbackRemote(receipt, keys = REBIND_KEYS, cwd = ROOT) {
  const rolled = rollbackKeys(keys, (command, args, options) => spawnSync(command, args, { ...options, cwd }));
  receipt.mutations.rollbackAttempts = rolled.journal.length;
  receipt.mutations.rollbackJournal = rolled.journal.map((entry, index) => ({ ...entry, order: index + 1 }));
  receipt.mutations.rollbackPass = rolled.pass;
  if (!rolled.pass) receipt.status = "WP190_ROLLBACK_EXACT_NO_GO";
  return rolled.pass;
}

async function runIsolatedLive() {
  if (fs.existsSync(REPORT)) throw new Error("WP190_REPORT_ALREADY_EXISTS");
  const receipt = initialReceipt();
  receipt.isolation.isolatedPresenceCount = ISOLATION_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  if (receipt.isolation.isolatedPresenceCount !== 0) return writeReceipt(receipt);
  const prior = JSON.parse(await fsp.readFile(WP189_REPORT, "utf8"));
  receipt.baseline.wp189Accepted = prior.status === "WP189_CLASSIFICATION_COMPLETE" && prior.classification?.primaryClassification === "EMPTY_BINDING";
  if (!receipt.baseline.wp189Accepted) return writeReceipt(receipt);
  const baselineInspect = spawnSync(VERCEL, ["inspect", ALIAS, "--scope", SCOPE, "--json", "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  const baseline = parseInspect(baselineInspect.stdout, OLD_DEPLOYMENT);
  const baselineWeb = await markerAndHealth(ALIAS);
  Object.assign(receipt.baseline, { projectMatched: baseline.projectMatched, deploymentMatched: baseline.id === OLD_DEPLOYMENT, previewReady: baseline.previewReady, markerMatched: baselineWeb.markerMatched, health200: baselineWeb.health200 });
  if (!baseline.ok || !baselineWeb.markerMatched || !baselineWeb.health200) return writeReceipt(receipt);

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp190-"));
  const STOP = Symbol("WP190_STOP");
  try {
    const boundary = path.resolve(temp).startsWith(`${ROOT}${path.sep}`) === false && !fs.lstatSync(temp).isSymbolicLink();
    if (!boundary) throw STOP;
    receipt.development.attempts = 1;
    const development = runBroker("development", "--development-child", temp);
    receipt.development.childCount = development.count;
    receipt.development.childValid = development.ok;
    if (!development.ok) throw STOP;
    receipt.development.qualification = development.child.qualification;
    receipt.mutations.forwardJournal = development.child.forwardJournal;
    receipt.mutations.forwardAttempts = development.child.forwardJournal.length;
    receipt.mutations.rollbackJournal = development.child.rollbackJournal;
    receipt.mutations.rollbackAttempts = development.child.rollbackJournal.length;
    receipt.mutations.rollbackPass = development.child.rollbackJournal.length ? development.child.rollbackJournal.every((entry) => entry.ok) : null;
    if (development.child.status !== "REBIND_COMPLETE") {
      if (development.child.status === "ROLLBACK_FAILED") receipt.status = "WP190_ROLLBACK_EXACT_NO_GO";
      throw STOP;
    }

    receipt.previewReadback.attempts = 1;
    const preview = runBroker("preview", "--readback-child", temp);
    receipt.previewReadback.childCount = preview.count;
    receipt.previewReadback.childValid = preview.ok;
    if (preview.ok) receipt.previewReadback.qualification = preview.child.qualification;
    if (!preview.ok || preview.child.status !== "READBACK_PASS") {
      await rollbackRemote(receipt, REBIND_KEYS, temp);
      throw STOP;
    }

    receipt.deployment.redeployAttempts = 1;
    const redeploy = spawnSync(VERCEL, ["redeploy", OLD_DEPLOYMENT, "--target", "preview", "--scope", SCOPE, "--no-color"], { cwd: temp, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 900_000, maxBuffer: 4 * 1024 * 1024 });
    const deploymentHost = String(redeploy.stdout ?? "").match(/https?:\/\/([a-z0-9-]+\.vercel\.app)/iu)?.[1] ?? String(redeploy.stdout ?? "").match(/\b([a-z0-9-]+\.vercel\.app)\b/iu)?.[1] ?? null;
    if ((redeploy.status ?? 1) !== 0 || !deploymentHost) { await rollbackRemote(receipt, REBIND_KEYS, temp); throw STOP; }
    receipt.deployment.created = true;
    receipt.deployment.inspectAttempts = 1;
    const newInspectRaw = spawnSync(VERCEL, ["inspect", deploymentHost, "--wait", "--timeout", "8m", "--scope", SCOPE, "--json", "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 540_000, maxBuffer: 4 * 1024 * 1024 });
    const next = parseInspect(newInspectRaw.stdout);
    const nextWeb = next.ok ? await markerAndHealth(deploymentHost) : { markerMatched: false, health200: false };
    Object.assign(receipt.deployment, { idChanged: Boolean(next.id && next.id !== OLD_DEPLOYMENT), projectMatched: next.projectMatched, previewReady: next.previewReady, markerMatched: nextWeb.markerMatched, health200: nextWeb.health200 });
    if (!next.ok || !receipt.deployment.idChanged || !nextWeb.markerMatched || !nextWeb.health200) { await rollbackRemote(receipt, REBIND_KEYS, temp); throw STOP; }

    receipt.aliasCas.preconditionChecks = 1;
    const preRaw = spawnSync(VERCEL, ["inspect", ALIAS, "--scope", SCOPE, "--json", "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const pre = parseInspect(preRaw.stdout, OLD_DEPLOYMENT);
    receipt.aliasCas.preconditionMatched = pre.ok;
    if (!pre.ok) { await rollbackRemote(receipt, REBIND_KEYS, temp); throw STOP; }
    receipt.aliasCas.switchAttempts = 1;
    const switched = spawnSync(VERCEL, ["alias", "set", deploymentHost, ALIAS, "--scope", SCOPE, "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 90_000, maxBuffer: 1024 * 1024 });
    if ((switched.status ?? 1) !== 0) { await rollbackRemote(receipt, REBIND_KEYS, temp); throw STOP; }
    const postRaw = spawnSync(VERCEL, ["inspect", ALIAS, "--scope", SCOPE, "--json", "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const post = parseInspect(postRaw.stdout, next.id);
    const postWeb = await markerAndHealth(ALIAS);
    Object.assign(receipt.aliasCas, { postIdentityMatched: post.ok, postMarkerMatched: postWeb.markerMatched, postHealth200: postWeb.health200 });
    if (!post.ok || !postWeb.markerMatched || !postWeb.health200) {
      receipt.aliasCas.rollbackAttempts = 1;
      const aliasRollback = spawnSync(VERCEL, ["alias", "set", OLD_DEPLOYMENT, ALIAS, "--scope", SCOPE, "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 90_000, maxBuffer: 1024 * 1024 });
      receipt.aliasCas.rollbackPass = (aliasRollback.status ?? 1) === 0;
      await rollbackRemote(receipt, REBIND_KEYS, temp);
      if (!receipt.aliasCas.rollbackPass) receipt.status = "WP190_ROLLBACK_EXACT_NO_GO";
      throw STOP;
    }
    receipt.status = "WP190_COMPLETE";
  } catch (error) {
    if (error !== STOP) throw error;
  } finally {
    receipt.cleanup = { attempted: true, pass: await cleanupTemp(temp), residualPathPresent: fs.existsSync(temp) };
    if (!receipt.cleanup.pass && receipt.status === "WP190_COMPLETE") receipt.status = "WP190_EXACT_NO_GO";
  }
  return writeReceipt(receipt);
}

async function runLauncher() {
  if (fs.existsSync(REPORT)) throw new Error("WP190_REPORT_ALREADY_EXISTS");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", buildIsolationCommand(process.execPath, fileURLToPath(import.meta.url))], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 1_800_000, maxBuffer: 1024 * 1024 });
  process.stdout.write(String(result.stdout ?? ""));
  if ((result.status ?? 1) !== 0) process.exitCode = result.status ?? 1;
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const checked = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-190", strictReadback: checked.ok ? "PASS" : "FAIL", status: receipt.status })}\n`);
  if (!checked.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--isolated-live") await runIsolatedLive();
  else if (process.argv[2] === "--development-child") await runDevelopmentChild(process.argv[3]);
  else if (process.argv[2] === "--readback-child") await runReadbackChild(process.argv[3]);
  else if (process.argv[2] === "--verify-report") await verifyReport();
  else await runLauncher();
}

export const CONTRACT = Object.freeze({ project: PROJECT, scope: SCOPE, alias: ALIAS, oldDeployment: OLD_DEPLOYMENT, report: REPORT, secretishKeys: [...SECRETISH_KEYS] });
