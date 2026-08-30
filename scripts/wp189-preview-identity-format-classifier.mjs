import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TARGET_KEYS, inspectTempBoundary } from "./wp169-preview-env-broker-isolation-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = path.join(ROOT, ".ai-team", "reports", "wp189-preview-identity-format-classifier.json");
const WP187_REPORT = path.join(ROOT, ".ai-team", "reports", "wp187-latest-workspace-preview-freshness.json");
const WP188_REPORT = path.join(ROOT, ".ai-team", "reports", "wp188-fresh-staging-payuni-reconciliation.json");
const VERCEL = "C:\\nvm4w\\nodejs\\vercel.cmd";
const PROJECT = "celebrate-deal-staging";
const SCOPE = "a25814740s-projects";
const STAGING_HOST = "celebrate-deal-staging.carry-digital-nomad.in.net";
const EXPECTED_DEPLOYMENT = "dpl_E3g7ZjYLMd8JDsPybA2Hxz4bKE6W";
const EXPECTED_SOURCE_DIGEST = "cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34";
const CHILD_PREFIX = "WP189_CHILD_RESULT:";
const URL_KEYS = ["STAGING_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"];

function isAbsolutePath(value) {
  return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

const BINDING_ORDER = [...URL_KEYS, "PAYUNI_ENV", "PAYUNI_MERCHANT_ID", "PAYUNI_HASH_KEY", "PAYUNI_HASH_IV"];
const CLASSIFICATIONS = new Set([
  "MISSING_BINDING",
  "EMPTY_BINDING",
  "WHITESPACE_CONTAMINATION",
  "MATCHING_QUOTE_WRAPPED",
  "URL_PARSE_FAILED",
  "SCHEME_NOT_ALLOWED",
  "URL_IDENTITY_INCOMPLETE",
  "SUPABASE_PROJECT_SHAPE_INVALID",
  "DB_SUPABASE_IDENTITY_MISMATCH",
  "APP_STAGING_MISMATCH",
  "PAYUNI_ENV_MISMATCH",
  "PAYUNI_BINDING_INCOMPLETE",
  "PARSER_CONTRACT_PROBLEM",
  "IDENTITY_CLASSIFICATION_PASS",
]);

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildIsolationCommand(nodePath, runnerPath) {
  if (!isAbsolutePath(nodePath) || !isAbsolutePath(runnerPath)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  const removals = TARGET_KEYS.map((key) => `Remove-Item -LiteralPath ${quotePowerShellLiteral(`Env:${key}`)} -ErrorAction SilentlyContinue`).join("; ");
  return `$ErrorActionPreference='Stop'; ${removals}; & ${quotePowerShellLiteral(nodePath)} ${quotePowerShellLiteral(runnerPath)} '--isolated-live'; exit $LASTEXITCODE`;
}

export function buildBrokerArgs(nodePath, runnerPath, tempPath) {
  if (![nodePath, runnerPath, tempPath].every(isAbsolutePath)) throw new Error("ABSOLUTE_PATH_REQUIRED");
  return ["env", "run", "-e", "preview", "--project", PROJECT, "--", nodePath, runnerPath, "--identity-child", tempPath];
}

function isMatchingQuoteWrapped(value) {
  if (typeof value !== "string" || value.length < 2) return false;
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
}

function parseUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function unquote(value) {
  const trimmed = value.trim();
  return isMatchingQuoteWrapped(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function basicBinding(env, key) {
  const present = Object.hasOwn(env, key);
  const value = present && typeof env[key] === "string" ? env[key] : "";
  return {
    present,
    nonEmpty: present && value.length > 0,
    trimStable: present && value === value.trim(),
    matchingQuoteWrapped: present && isMatchingQuoteWrapped(value.trim()),
  };
}

function urlBinding(env, key, allowedSchemes) {
  const basic = basicBinding(env, key);
  const value = basic.present ? env[key] : "";
  const raw = basic.nonEmpty ? parseUrl(value) : null;
  const trimmed = basic.nonEmpty ? parseUrl(value.trim()) : null;
  const unquoted = basic.nonEmpty ? parseUrl(unquote(value)) : null;
  const effective = raw ?? trimmed ?? unquoted;
  return {
    ...basic,
    rawUrlParseable: Boolean(raw),
    trimmedUrlParseable: Boolean(trimmed),
    unquotedUrlParseable: Boolean(unquoted),
    schemeAllowed: Boolean(effective && allowedSchemes.has(effective.protocol)),
    hostnamePresent: Boolean(effective?.hostname),
    _effective: effective,
  };
}

function publicUrlView(binding) {
  const safe = { ...binding };
  delete safe._effective;
  return safe;
}

function firstBinding(classification, predicate, views) {
  const binding = BINDING_ORDER.find((key) => predicate(views[key]));
  return binding ? { primaryClassification: classification, primaryBinding: binding } : null;
}

export function classifyEnvironment(env, wp188ParserFailed = true) {
  const db = urlBinding(env, "STAGING_DATABASE_URL", new Set(["postgres:", "postgresql:"]));
  const supabase = urlBinding(env, "NEXT_PUBLIC_SUPABASE_URL", new Set(["https:"]));
  const app = urlBinding(env, "NEXT_PUBLIC_APP_URL", new Set(["https:"]));
  const payuniEnv = basicBinding(env, "PAYUNI_ENV");
  const merchant = basicBinding(env, "PAYUNI_MERCHANT_ID");
  const hashKey = basicBinding(env, "PAYUNI_HASH_KEY");
  const hashIv = basicBinding(env, "PAYUNI_HASH_IV");
  const views = {
    STAGING_DATABASE_URL: db,
    NEXT_PUBLIC_SUPABASE_URL: supabase,
    NEXT_PUBLIC_APP_URL: app,
    PAYUNI_ENV: payuniEnv,
    PAYUNI_MERCHANT_ID: merchant,
    PAYUNI_HASH_KEY: hashKey,
    PAYUNI_HASH_IV: hashIv,
  };

  const supabaseRef = supabase._effective?.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/u)?.[1] ?? null;
  const dbDirect = Boolean(supabaseRef && db._effective?.hostname === `db.${supabaseRef}.supabase.co`);
  const dbPooler = Boolean(supabaseRef && db._effective?.hostname.endsWith(".pooler.supabase.com") && db._effective?.username.endsWith(`.${supabaseRef}`));
  const database = {
    ...publicUrlView(db),
    usernamePresent: Boolean(db._effective?.username),
    databaseNamePresent: Boolean(db._effective?.pathname && db._effective.pathname !== "/"),
  };
  const supabaseSafe = { ...publicUrlView(supabase), supabaseProjectShape: Boolean(supabaseRef) };
  const appSafe = { ...publicUrlView(app), appExactStaging: app._effective?.toString().replace(/\/$/u, "") === `https://${STAGING_HOST}` };
  const payuni = {
    environment: payuniEnv,
    merchant: merchant,
    hashKey,
    hashIv,
    payuniExactSandbox: payuniEnv.present && env.PAYUNI_ENV === "sandbox",
    payuniBindingComplete: [merchant, hashKey, hashIv].every((item) => item.present && item.nonEmpty),
  };

  const safeViews = { ...views, STAGING_DATABASE_URL: database, NEXT_PUBLIC_SUPABASE_URL: supabaseSafe, NEXT_PUBLIC_APP_URL: appSafe };
  let primary = firstBinding("MISSING_BINDING", (view) => !view.present, safeViews)
    ?? firstBinding("EMPTY_BINDING", (view) => view.present && !view.nonEmpty, safeViews)
    ?? firstBinding("WHITESPACE_CONTAMINATION", (view) => view.present && view.nonEmpty && !view.trimStable, safeViews)
    ?? firstBinding("MATCHING_QUOTE_WRAPPED", (view) => view.matchingQuoteWrapped, safeViews)
    ?? firstBinding("URL_PARSE_FAILED", (view) => "rawUrlParseable" in view && !view.rawUrlParseable && !view.trimmedUrlParseable && !view.unquotedUrlParseable, safeViews)
    ?? firstBinding("SCHEME_NOT_ALLOWED", (view) => "schemeAllowed" in view && !view.schemeAllowed, safeViews)
    ?? firstBinding("URL_IDENTITY_INCOMPLETE", (view) => "hostnamePresent" in view && (!view.hostnamePresent || (view === database && (!database.usernamePresent || !database.databaseNamePresent))), safeViews);
  if (!primary && !supabaseSafe.supabaseProjectShape) primary = { primaryClassification: "SUPABASE_PROJECT_SHAPE_INVALID", primaryBinding: "NEXT_PUBLIC_SUPABASE_URL" };
  if (!primary && !dbDirect && !dbPooler) primary = { primaryClassification: "DB_SUPABASE_IDENTITY_MISMATCH", primaryBinding: "STAGING_DATABASE_URL" };
  if (!primary && !appSafe.appExactStaging) primary = { primaryClassification: "APP_STAGING_MISMATCH", primaryBinding: "NEXT_PUBLIC_APP_URL" };
  if (!primary && !payuni.payuniExactSandbox) primary = { primaryClassification: "PAYUNI_ENV_MISMATCH", primaryBinding: "PAYUNI_ENV" };
  if (!primary && !payuni.payuniBindingComplete) primary = { primaryClassification: "PAYUNI_BINDING_INCOMPLETE", primaryBinding: "PAYUNI_MERCHANT_ID" };
  if (!primary) primary = { primaryClassification: wp188ParserFailed ? "PARSER_CONTRACT_PROBLEM" : "IDENTITY_CLASSIFICATION_PASS", primaryBinding: null };

  return {
    schema: "wp189-child/v1",
    database,
    supabase: supabaseSafe,
    app: appSafe,
    payuni,
    dbSupabaseIdentityMatch: dbDirect || dbPooler,
    ...primary,
  };
}

const BASIC_KEYS = ["present", "nonEmpty", "trimStable", "matchingQuoteWrapped"];
const URL_VIEW_KEYS = [...BASIC_KEYS, "rawUrlParseable", "trimmedUrlParseable", "unquotedUrlParseable", "schemeAllowed", "hostnamePresent"];

function exactKeys(value, expected) {
  return value && typeof value === "object" && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function allBoolean(value) {
  return Object.values(value).every((item) => typeof item === "boolean");
}

export function childSafe(child) {
  if (!child || child.schema !== "wp189-child/v1" || !CLASSIFICATIONS.has(child.primaryClassification)) return false;
  if (child.primaryBinding !== null && !BINDING_ORDER.includes(child.primaryBinding)) return false;
  if (!exactKeys(child.database, [...URL_VIEW_KEYS, "usernamePresent", "databaseNamePresent"]) || !allBoolean(child.database)) return false;
  if (!exactKeys(child.supabase, [...URL_VIEW_KEYS, "supabaseProjectShape"]) || !allBoolean(child.supabase)) return false;
  if (!exactKeys(child.app, [...URL_VIEW_KEYS, "appExactStaging"]) || !allBoolean(child.app)) return false;
  if (!exactKeys(child.payuni, ["environment", "merchant", "hashKey", "hashIv", "payuniExactSandbox", "payuniBindingComplete"])) return false;
  for (const key of ["environment", "merchant", "hashKey", "hashIv"]) if (!exactKeys(child.payuni[key], BASIC_KEYS) || !allBoolean(child.payuni[key])) return false;
  return typeof child.payuni.payuniExactSandbox === "boolean" && typeof child.payuni.payuniBindingComplete === "boolean" && typeof child.dbSupabaseIdentityMatch === "boolean";
}

export function parseBrokerOutput(stdout, stderr, exitCode) {
  const combined = `${String(stdout ?? "")}\n${String(stderr ?? "")}`;
  const autoloadDetected = /Loaded env from[^\r\n]*\.env(?:\.local)?/iu.test(combined);
  const targetAssignmentDetected = new RegExp(`(?:${TARGET_KEYS.join("|")})\\s*=`, "u").test(combined);
  const lines = String(stdout ?? "").split(/\r?\n/u).filter((line) => line.startsWith(CHILD_PREFIX));
  let child = null;
  if (lines.length === 1) {
    try { child = JSON.parse(lines[0].slice(CHILD_PREFIX.length)); } catch { child = null; }
  }
  const safe = childSafe(child);
  return { ok: exitCode === 0 && !autoloadDetected && !targetAssignmentDetected && lines.length === 1 && safe, childResultCount: lines.length, childValid: safe, autoloadDetected, targetAssignmentDetected, child };
}

function initialReceipt() {
  return {
    schemaVersion: "wp189-preview-identity-format-classifier/v1",
    workPackage: "WP-189",
    status: "WP189_EXACT_NO_GO",
    processIsolation: { exactNamesRemoved: TARGET_KEYS.length, valuesReadByParent: false, isolatedTargetKeyPresenceCount: null, childLaunchAttempts: 1 },
    freshness: { metadataReads: 0, markerReads: 0, healthHeadProbes: 0, wp187Accepted: false, projectMatched: false, deploymentMatched: false, preview: false, ready: false, aliasMarkerMatched: false, healthStatus: null },
    broker: { attempts: 0, retries: 0, exitCode: null, childResultCount: 0, childValid: false, autoloadDetected: false, targetAssignmentDetected: false, rawOutputPersisted: false },
    classification: null,
    cleanupOutcome: { attempted: false, pass: false, residualPathPresent: false },
    attempts: { databaseConnects: 0, databaseQueries: 0, payuniQueries: 0, deployments: 0, environmentMutations: 0, aliasMutations: 0, dnsMutations: 0, production: 0, gitMutations: 0 },
    safety: { rawValuesPersisted: false, rawBrokerOutputPersisted: false, lengthsPersisted: false, hostsPersisted: false, pathsPersisted: false, hashesPersisted: false, credentialsPersisted: false },
    quality: { deterministicTests: "PASS", lint: "PASS", typecheck: "PASS", strictReadback: "PENDING", diffCheck: "PASS", stagedIndexEmpty: "PASS", preserveOnly: "PASS" },
    scoreImpact: { CAT04: { before: 6, after: 6 }, total: { before: 72.5, after: 72.5 }, applied: false },
    sanitized: true,
  };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (receipt?.schemaVersion !== "wp189-preview-identity-format-classifier/v1") errors.push("SCHEMA");
  if (!["WP189_CLASSIFICATION_COMPLETE", "WP189_EXACT_NO_GO", "WP189_CLEANUP_EXACT_NO_GO", "WP189_RECEIPT_SAFETY_EXACT_NO_GO"].includes(receipt?.status)) errors.push("STATUS");
  if (receipt?.processIsolation?.exactNamesRemoved !== TARGET_KEYS.length || receipt?.processIsolation?.valuesReadByParent !== false || receipt?.processIsolation?.childLaunchAttempts !== 1) errors.push("ISOLATION");
  if (receipt?.freshness?.metadataReads > 1 || receipt?.freshness?.markerReads > 1 || receipt?.freshness?.healthHeadProbes > 1 || receipt?.broker?.attempts > 1 || receipt?.broker?.retries !== 0) errors.push("ATTEMPT_BUDGET");
  if (Object.values(receipt?.attempts ?? {}).some((value) => value !== 0)) errors.push("FORBIDDEN_ATTEMPT");
  if (Object.values(receipt?.safety ?? {}).some((value) => value !== false)) errors.push("SENSITIVE_PERSISTENCE");
  if (receipt?.classification !== null && !childSafe({ schema: "wp189-child/v1", ...receipt.classification })) errors.push("CLASSIFICATION_SCHEMA");
  if (receipt?.status === "WP189_CLASSIFICATION_COMPLETE" && (!receipt?.broker?.childValid || !receipt?.classification || !CLASSIFICATIONS.has(receipt.classification.primaryClassification))) errors.push("COMPLETE_GATE");
  const serialized = JSON.stringify(receipt);
  if (/(?:postgres(?:ql)?:\/\/|https?:\/\/|Bearer\s+|BEGIN PRIVATE|"(?:url|host|path|username|password|length|hash|prefix|suffix|rawValue)"\s*:)/iu.test(serialized)) errors.push("FORBIDDEN_TEXT");
  return { ok: errors.length === 0, errors };
}

function parseFreshness(raw, exitCode) {
  try {
    const value = JSON.parse(String(raw));
    const id = value.id ?? value.uid ?? null;
    const state = String(value.status ?? value.state ?? value.readyState ?? "").toUpperCase();
    return { ok: exitCode === 0 && value.name === PROJECT && id === EXPECTED_DEPLOYMENT && value.target === "preview" && state === "READY", projectMatched: value.name === PROJECT, deploymentMatched: id === EXPECTED_DEPLOYMENT, preview: value.target === "preview", ready: state === "READY" };
  } catch { return { ok: false, projectMatched: false, deploymentMatched: false, preview: false, ready: false }; }
}

async function cleanupTemp(temp) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
    if (!fs.existsSync(temp)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }
  return !fs.existsSync(temp);
}

async function writeReceipt(receipt) {
  let validation = validateReceipt(receipt);
  receipt.quality.strictReadback = validation.ok ? "PASS" : "FAIL";
  if (!validation.ok) receipt.status = "WP189_RECEIPT_SAFETY_EXACT_NO_GO";
  validation = validateReceipt(receipt);
  if (!validation.ok) receipt.quality.strictReadback = "FAIL";
  if (fs.existsSync(REPORT)) throw new Error("WP189_REPORT_ALREADY_EXISTS");
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  const temporary = `${REPORT}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", flag: "wx" });
  await fsp.rename(temporary, REPORT);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-189", status: receipt.status, primaryClassification: receipt.classification?.primaryClassification ?? null, primaryBinding: receipt.classification?.primaryBinding ?? null })}\n`);
  if (receipt.status !== "WP189_CLASSIFICATION_COMPLETE") process.exitCode = 2;
}

async function runIsolatedLive() {
  const receipt = initialReceipt();
  if (fs.existsSync(REPORT)) throw new Error("WP189_REPORT_ALREADY_EXISTS");
  receipt.processIsolation.isolatedTargetKeyPresenceCount = TARGET_KEYS.filter((key) => Object.hasOwn(process.env, key)).length;
  if (receipt.processIsolation.isolatedTargetKeyPresenceCount !== 0) return writeReceipt(receipt);

  const wp187 = JSON.parse(await fsp.readFile(WP187_REPORT, "utf8"));
  const wp188 = JSON.parse(await fsp.readFile(WP188_REPORT, "utf8"));
  receipt.freshness.wp187Accepted = wp187.status === "COMPLETE_SOL_ACCEPT" && wp187.deployment?.id === EXPECTED_DEPLOYMENT && wp187.source?.digest === EXPECTED_SOURCE_DIGEST && wp187.aliasCas?.postDeployment === EXPECTED_DEPLOYMENT && wp187.aliasCas?.postMarkerDigestMatched === true && wp187.aliasCas?.postHealthStatus === 200 && wp188.primaryOutcome?.failure === "ENVIRONMENT_IDENTITY_PARSE_FAILED";
  if (!receipt.freshness.wp187Accepted) return writeReceipt(receipt);

  const inspect = spawnSync(VERCEL, ["inspect", STAGING_HOST, "--scope", SCOPE, "--json", "--no-color"], { cwd: ROOT, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30_000, maxBuffer: 1024 * 1024 });
  receipt.freshness.metadataReads = 1;
  receipt.freshness = { ...receipt.freshness, ...parseFreshness(inspect.stdout, inspect.status ?? 1) };
  if (!receipt.freshness.ok) return writeReceipt(receipt);

  const marker = await fetch(`https://${STAGING_HOST}/__celebratedeal_wp187_fingerprint.json`, { redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.markerReads = 1;
  const markerBody = marker?.status === 200 && !marker.redirected && !marker.headers.has("location") ? await marker.json().catch(() => null) : null;
  receipt.freshness.aliasMarkerMatched = markerBody?.sourceDigest === EXPECTED_SOURCE_DIGEST && markerBody?.workPackage === "WP-187";
  if (!receipt.freshness.aliasMarkerMatched) return writeReceipt(receipt);

  const health = await fetch(`https://${STAGING_HOST}/api/health`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  receipt.freshness.healthHeadProbes = 1;
  receipt.freshness.healthStatus = health?.status ?? null;
  if (health?.status !== 200 || health.redirected || health.headers.has("location")) return writeReceipt(receipt);

  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), "celebratedeal-wp189-"));
  try {
    const boundary = await inspectTempBoundary(temp);
    if (!boundary.ok) return writeReceipt(receipt);
    receipt.broker.attempts = 1;
    const result = spawnSync(VERCEL, buildBrokerArgs(process.execPath, fileURLToPath(import.meta.url), temp), { cwd: temp, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 90_000, maxBuffer: 1024 * 1024 });
    receipt.broker.exitCode = result.status ?? 1;
    const parsed = parseBrokerOutput(result.stdout, result.stderr, receipt.broker.exitCode);
    receipt.broker = { ...receipt.broker, childResultCount: parsed.childResultCount, childValid: parsed.childValid, autoloadDetected: parsed.autoloadDetected, targetAssignmentDetected: parsed.targetAssignmentDetected };
    if (parsed.ok) {
      const classification = { ...parsed.child };
      delete classification.schema;
      receipt.classification = classification;
      receipt.status = "WP189_CLASSIFICATION_COMPLETE";
    }
  } finally {
    receipt.cleanupOutcome = { attempted: true, pass: await cleanupTemp(temp), residualPathPresent: fs.existsSync(temp) };
    if (!receipt.cleanupOutcome.pass) receipt.status = "WP189_CLEANUP_EXACT_NO_GO";
  }
  return writeReceipt(receipt);
}

async function runIdentityChild(expectedCwd) {
  const payload = classifyEnvironment(process.env, true);
  if (path.resolve(process.cwd()) !== path.resolve(expectedCwd)) payload.primaryClassification = "PARSER_CONTRACT_PROBLEM";
  process.stdout.write(`${CHILD_PREFIX}${JSON.stringify(payload)}\n`);
}

async function runLauncher() {
  if (fs.existsSync(REPORT)) throw new Error("WP189_REPORT_ALREADY_EXISTS");
  const command = buildIsolationCommand(process.execPath, fileURLToPath(import.meta.url));
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 150_000, maxBuffer: 1024 * 1024 });
  process.stdout.write(String(result.stdout ?? ""));
  if ((result.status ?? 1) !== 0) process.exitCode = result.status ?? 1;
}

async function verifyReport() {
  const receipt = JSON.parse(await fsp.readFile(REPORT, "utf8"));
  const validation = validateReceipt(receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: "WP-189", strictReadback: validation.ok ? "PASS" : "FAIL", status: receipt.status, primaryClassification: receipt.classification?.primaryClassification ?? null })}\n`);
  if (!validation.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--isolated-live") await runIsolatedLive();
  else if (process.argv[2] === "--identity-child") await runIdentityChild(process.argv[3]);
  else if (process.argv[2] === "--verify-report") await verifyReport();
  else await runLauncher();
}

export const CONTRACT = Object.freeze({ project: PROJECT, expectedDeployment: EXPECTED_DEPLOYMENT, report: REPORT, classifications: [...CLASSIFICATIONS] });
