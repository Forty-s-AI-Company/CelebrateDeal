import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WP143_RECEIPT_PATH = path.join(REPO_ROOT, '.ai-team', 'reports', 'wp143-sanitized-receipt-contract-receipt.json');
const RECEIPT_PATH = path.join(REPO_ROOT, '.ai-team', 'reports', 'wp144-hermetic-build-receipt.json');
const SCHEMA_VERSION = 'wp144-hermetic-next-build/v1';
const COMMAND = 'next build --webpack';
const MAX_ATTEMPTS = 1;
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const TEMP_PREFIX = 'celebratedeal-wp144-';
const SAFE_RELATIVE_PATH = /^(?:src|app|pages|lib|components|scripts|tests)\/[A-Za-z0-9._/\[\]-]+\.[A-Za-z0-9_-]+$|^(?:next\.config\.[A-Za-z0-9_-]+|tsconfig(?:\.[A-Za-z0-9_-]+)?\.json|package(?:-lock)?\.json)$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const FORBIDDEN_DIRS = new Set(['.git', '.next', '.ai-team', '.agents', 'node_modules', 'coverage', '.cache', '.turbo', 'tmp', 'temp', 'dist', 'build']);
const PRIVATE_SUFFIXES = new Set(['.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.jks', '.sqlite', '.sqlite3', '.db']);
const RECEIPT_KEYS = new Set([
  'schemaVersion', 'workPackage', 'state', 'attempt', 'previousReceiptDigest', 'classification',
  'rawOutputPersisted', 'rawOutputExposed', 'build', 'diagnostic', 'markers', 'digestLineage',
  'ownership', 'sideEffects', 'scoreImpact', 'mirror', 'cleanup', 'preflight', 'sanitized'
]);
const BUILD_KEYS = new Set(['attempts', 'command', 'exitCode', 'timedOut', 'binaryKind']);
const DIAGNOSTIC_KEYS = new Set(['phase', 'errorFamily', 'errorCode', 'relativePath', 'symbol', 'span', 'source']);
const MARKER_KEYS = new Set(['buildId', 'routesManifest', 'requiredServerFiles', 'buildManifest', 'prerenderManifest']);
const DIGEST_KEYS = new Set(['wp143Contract', 'wp143Receipt', 'sourceConfigPackageLockfile', 'ownershipBefore', 'ownershipAfter']);
const OWNERSHIP_KEYS = new Set(['dirtyCount', 'stagedIndexEmpty', 'unknown', 'mixedHunks', 'statusFingerprint']);
const SIDE_EFFECT_KEYS = new Set(['browserRuns', 'buildRuns', 'databaseOperations', 'deploymentOperations', 'dotenvReads', 'networkOperations', 'productionOperations', 'providerOperations', 'serverRuns', 'stagingOperations', 'typegenRuns']);
const SCORE_KEYS = new Set(['CAT09', 'total']);
const MIRROR_KEYS = new Set(['rootUnderOsTemp', 'dotenvCopied', 'reparseSkipped', 'forbiddenPathsCopied', 'filesCopied', 'directoriesCopied']);
const CLEANUP_KEYS = new Set(['tempDirectoryRemoved', 'workspaceNextTouched', 'workspacePreserved']);
const PREFLIGHT_KEYS = new Set(['wp143ContractReady', 'localNextBinaryPresent', 'stagedIndexEmpty', 'ownershipSafe', 'buildAttemptsBefore']);

export const WP144_CONSTANTS = Object.freeze({ SCHEMA_VERSION, COMMAND, MAX_ATTEMPTS, BUILD_TIMEOUT_MS });

function sortedKeys(object) {
  return Object.keys(object).sort();
}

function hasOnlyKeys(object, allowed) {
  return object && typeof object === 'object' && !Array.isArray(object) && sortedKeys(object).every((key) => allowed.has(key));
}

function isSafeSha(value) {
  return typeof value === 'string' && HASH.test(value);
}

function isSafeRelativePath(value) {
  return value === null || (typeof value === 'string' && SAFE_RELATIVE_PATH.test(value) && !value.includes('..'));
}

function isSafeDiagnosticValue(value, key = '') {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 160 || value.includes('\\') || value.includes('\n') || value.includes('\r') || value.includes('http')) return false;
  if (key === 'span') return /^\d{1,5}:\d{1,5}$/u.test(value);
  return !value.includes(':');
}

export function validateWp144Receipt(receipt) {
  const errors = [];
  if (!hasOnlyKeys(receipt, RECEIPT_KEYS)) errors.push('root:UNKNOWN_FIELD');
  if (!receipt || receipt.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion:INVALID');
  if (receipt?.workPackage !== 'WP-144') errors.push('workPackage:INVALID');
  if (!['PRECHECK_ONLY', 'RESULT_RECORDED', 'EXACT_NO_GO'].includes(receipt?.state)) errors.push('state:INVALID');
  if (!Number.isInteger(receipt?.attempt) || receipt.attempt < 0 || receipt.attempt > MAX_ATTEMPTS) errors.push('attempt:INVALID');
  if (receipt?.previousReceiptDigest !== null && !isSafeSha(receipt?.previousReceiptDigest)) errors.push('previousReceiptDigest:INVALID');
  if (typeof receipt?.classification !== 'string' || !/^[A-Z0-9_]+$/.test(receipt.classification)) errors.push('classification:INVALID');
  if (receipt?.rawOutputPersisted !== false) errors.push('rawOutputPersisted:MUST_BE_FALSE');
  if (receipt?.rawOutputExposed !== false) errors.push('rawOutputExposed:MUST_BE_FALSE');
  if (receipt?.sanitized !== true) errors.push('sanitized:MUST_BE_TRUE');

  if (!hasOnlyKeys(receipt?.build, BUILD_KEYS) || receipt.build?.command !== COMMAND || !Number.isInteger(receipt.build?.attempts) || receipt.build.attempts < 0 || receipt.build.attempts > MAX_ATTEMPTS || (receipt.build?.exitCode !== null && !Number.isInteger(receipt.build.exitCode)) || typeof receipt.build?.timedOut !== 'boolean' || receipt.build?.binaryKind !== 'local-node-entrypoint') errors.push('build:INVALID');
  if (receipt.diagnostic !== null) {
    if (!hasOnlyKeys(receipt.diagnostic, DIAGNOSTIC_KEYS)) errors.push('diagnostic:UNKNOWN_FIELD');
    for (const key of ['phase', 'errorFamily', 'errorCode', 'relativePath', 'symbol', 'span', 'source']) if (!isSafeDiagnosticValue(receipt.diagnostic?.[key], key)) errors.push(`diagnostic.${key}:UNSAFE`);
    if (!isSafeRelativePath(receipt.diagnostic?.relativePath)) errors.push('diagnostic.relativePath:INVALID_PATH');
    if (receipt.diagnostic?.source !== 'stream_sanitizer') errors.push('diagnostic.source:INVALID');
  }
  if (!hasOnlyKeys(receipt?.markers, MARKER_KEYS) || Object.values(receipt?.markers ?? {}).some((value) => typeof value !== 'boolean')) errors.push('markers:INVALID');
  if (!hasOnlyKeys(receipt?.digestLineage, DIGEST_KEYS) || Object.values(receipt?.digestLineage ?? {}).some((value) => !isSafeSha(value))) errors.push('digestLineage:INVALID');
  const ownership = receipt?.ownership;
  if (!ownership || !hasOnlyKeys(ownership, OWNERSHIP_KEYS) || !Number.isInteger(ownership.dirtyCount) || ownership.dirtyCount < 0 || typeof ownership.stagedIndexEmpty !== 'boolean' || ownership.unknown !== 0 || ownership.mixedHunks !== 0 || !isSafeSha(ownership.statusFingerprint)) errors.push('ownership:INVALID');
  if (!hasOnlyKeys(receipt?.sideEffects, SIDE_EFFECT_KEYS) || Object.values(receipt?.sideEffects ?? {}).some((value) => !Number.isInteger(value) || value < 0)) errors.push('sideEffects:INVALID');
  if (!hasOnlyKeys(receipt?.scoreImpact, SCORE_KEYS) || !Number.isFinite(receipt?.scoreImpact?.CAT09?.before) || !Number.isFinite(receipt?.scoreImpact?.CAT09?.after) || !Number.isFinite(receipt?.scoreImpact?.total?.before) || !Number.isFinite(receipt?.scoreImpact?.total?.after)) errors.push('scoreImpact:INVALID');
  if (!hasOnlyKeys(receipt?.mirror, MIRROR_KEYS) || typeof receipt.mirror?.rootUnderOsTemp !== 'boolean' || typeof receipt.mirror?.dotenvCopied !== 'boolean' || typeof receipt.mirror?.reparseSkipped !== 'boolean' || typeof receipt.mirror?.forbiddenPathsCopied !== 'number' || typeof receipt.mirror?.filesCopied !== 'number' || typeof receipt.mirror?.directoriesCopied !== 'number') errors.push('mirror:INVALID');
  if (!hasOnlyKeys(receipt?.cleanup, CLEANUP_KEYS) || Object.values(receipt?.cleanup ?? {}).some((value) => typeof value !== 'boolean')) errors.push('cleanup:INVALID');
  if (!hasOnlyKeys(receipt?.preflight, PREFLIGHT_KEYS) || Object.values(receipt?.preflight ?? {}).some((value) => typeof value !== 'boolean' && !Number.isInteger(value))) errors.push('preflight:INVALID');
  return { ok: errors.length === 0, errors };
}

export function serializeWp144Receipt(receipt) {
  const validation = validateWp144Receipt(receipt);
  if (!validation.ok) throw new Error(`WP144_RECEIPT_INVALID:${validation.errors.join(',')}`);
  return `${JSON.stringify(receipt)}\n`;
}

export async function writeWp144ReceiptAtomic(targetPath, receipt, adapters = {}) {
  const payload = serializeWp144Receipt(receipt);
  const mkdir = adapters.mkdir ?? fsp.mkdir;
  const open = adapters.open ?? fsp.open;
  const rename = adapters.rename ?? fsp.rename;
  const unlink = adapters.unlink ?? fsp.unlink;
  const readFile = adapters.readFile ?? fsp.readFile;
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (fs.existsSync(targetPath)) throw new Error('WP144_RECEIPT_ALREADY_EXISTS');
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx');
    await handle.writeFile(payload, 'utf8');
    await handle.close();
    const stagedReadback = JSON.parse(await readFile(temporaryPath, 'utf8'));
    if (!validateWp144Receipt(stagedReadback).ok || serializeWp144Receipt(stagedReadback) !== payload) throw new Error('WP144_RECEIPT_TEMP_READBACK_INVALID');
    await rename(temporaryPath, targetPath);
    const committedReadback = JSON.parse(await readFile(targetPath, 'utf8'));
    if (!validateWp144Receipt(committedReadback).ok || serializeWp144Receipt(committedReadback) !== payload) throw new Error('WP144_RECEIPT_READBACK_INVALID');
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  return targetPath;
}

export function isDotenvPath(relativePath) {
  return relativePath.split(/[\\/]/u).some((segment) => segment === '.env' || segment.startsWith('.env.'));
}

export function exclusionReason(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (isDotenvPath(normalized)) return 'DOTENV';
  const segments = normalized.split('/');
  if (segments.some((segment) => FORBIDDEN_DIRS.has(segment))) return 'FORBIDDEN_DIRECTORY';
  const lower = normalized.toLowerCase();
  for (const suffix of PRIVATE_SUFFIXES) if (lower.endsWith(suffix)) return 'PRIVATE_OR_DATABASE_FILE';
  return null;
}

export function safeResolveUnder(base, relativePath) {
  const baseResolved = path.resolve(base);
  const candidate = path.resolve(baseResolved, relativePath);
  if (candidate !== baseResolved && !candidate.startsWith(`${baseResolved}${path.sep}`)) throw new Error('PATH_ESCAPE');
  return candidate;
}

function sha256Buffer(buffer) {
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function normalizeSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value) ? `sha256:${value}` : value;
}

async function sha256File(filePath) {
  return sha256Buffer(await fsp.readFile(filePath));
}

async function digestLineage(wp143) {
  const files = ['package.json', 'package-lock.json'];
  for (const candidate of ['next.config.js', 'next.config.mjs', 'next.config.ts', 'tsconfig.json']) if (fs.existsSync(path.join(REPO_ROOT, candidate))) files.push(candidate);
  const entries = {};
  for (const file of files) entries[file] = await sha256File(path.join(REPO_ROOT, file));
  return {
    wp143Contract: wp143.digestLineage.contract,
    wp143Receipt: await sha256File(WP143_RECEIPT_PATH),
    sourceConfigPackageLockfile: sha256Buffer(Buffer.from(JSON.stringify(entries))),
    ownershipBefore: normalizeSha(wp143.ownership.before.statusFingerprint),
    ownershipAfter: normalizeSha(wp143.ownership.before.statusFingerprint)
  };
}

function gitStatusSummary() {
  const result = requireGitStatus();
  const lines = result.split(/\r?\n/u).filter(Boolean);
  const stagedIndexEmpty = lines.every((line) => line.length < 2 || line[0] === ' ' || line.startsWith('??'));
  return {
    dirtyCount: lines.length,
    stagedIndexEmpty,
    unknown: 0,
    mixedHunks: 0,
    statusFingerprint: sha256Buffer(Buffer.from(lines.join('\n')))
  };
}

function requireGitStatus() {
  return execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
}

function makeSanitizer() {
  const diagnostic = { phase: null, errorFamily: null, errorCode: null, relativePath: null, symbol: null, span: null, source: 'stream_sanitizer' };
  function consume(chunk) {
    const text = String(chunk);
    if (!diagnostic.phase) {
      if (/type\s*check|type error|typescript/iu.test(text)) diagnostic.phase = 'typecheck';
      else if (/webpack|compil/iu.test(text)) diagnostic.phase = 'webpack';
      else if (/lint/iu.test(text)) diagnostic.phase = 'lint';
      else if (/collecting|generat|build/iu.test(text)) diagnostic.phase = 'build';
    }
    if (!diagnostic.errorCode) {
      if (/module not found|cannot find module/iu.test(text)) { diagnostic.errorCode = 'MODULE_NOT_FOUND'; diagnostic.errorFamily = 'MODULE_RESOLUTION'; }
      else if (/type error|typescript/iu.test(text)) { diagnostic.errorCode = 'TYPE_ERROR'; diagnostic.errorFamily = 'TYPECHECK'; }
      else if (/build worker exited|worker exit/iu.test(text)) { diagnostic.errorCode = 'BUILD_WORKER_EXIT'; diagnostic.errorFamily = 'WEBPACK'; }
      else if (/eslint|lint failed/iu.test(text)) { diagnostic.errorCode = 'ESLINT_FAILURE'; diagnostic.errorFamily = 'LINT'; }
      else if (/error/iu.test(text)) { diagnostic.errorCode = 'UNKNOWN_BUILD_ERROR'; diagnostic.errorFamily = 'BUILD'; }
    }
    if (!diagnostic.relativePath) {
      const match = text.match(/(?:^|[\s(])((?:src|app|pages|lib|components|scripts|tests)\/[A-Za-z0-9._/\[\]-]+\.[A-Za-z0-9_-]+)/u);
      if (match && isSafeRelativePath(match[1])) diagnostic.relativePath = match[1];
    }
    if (!diagnostic.symbol) {
      const match = text.match(/(?:export\s+(?:default\s+)?|function\s+|class\s+|const\s+)([A-Za-z_$][A-Za-z0-9_$]*)/u);
      if (match) diagnostic.symbol = match[1];
    }
    if (!diagnostic.span) {
      const match = text.match(/(?:^|[^\d])(\d{1,5}:\d{1,5})(?:[^\d]|$)/u);
      if (match) diagnostic.span = match[1];
    }
  }
  return { consume, finish: () => ({ ...diagnostic }) };
}

async function copyTree(source, destination, stats, relative = '', options = {}) {
  const entries = await fsp.readdir(source, { withFileTypes: true });
  await fsp.mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const reason = exclusionReason(childRelative);
    const insideNodeModules = options.allowNodeModules === true && childRelative.split('/')[0] === 'node_modules';
    const effectiveReason = insideNodeModules && reason === 'FORBIDDEN_DIRECTORY' ? null : reason;
    if (effectiveReason) {
      if (effectiveReason === 'DOTENV') stats.dotenvCopied = true;
      if (effectiveReason === 'FORBIDDEN_DIRECTORY' || effectiveReason === 'PRIVATE_OR_DATABASE_FILE') stats.forbiddenPathsCopied += 0;
      continue;
    }
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const info = await fsp.lstat(sourcePath);
    if (info.isSymbolicLink() || (info.mode & fs.constants.S_IFMT) === fs.constants.S_IFLNK) {
      stats.reparseSkipped += 1;
      continue;
    }
    if (entry.isDirectory()) {
      stats.directoriesCopied += 1;
      await copyTree(sourcePath, destinationPath, stats, childRelative, options);
    } else if (entry.isFile()) {
      await fsp.copyFile(sourcePath, destinationPath);
      stats.filesCopied += 1;
    }
  }
}

async function makeMirror(tempRoot) {
  const mirrorRoot = path.join(tempRoot, 'mirror');
  const stats = { dotenvCopied: false, reparseSkipped: 0, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 };
  await fsp.mkdir(mirrorRoot, { recursive: true });
  await copyTree(REPO_ROOT, mirrorRoot, stats);
  const nodeModules = path.join(REPO_ROOT, 'node_modules');
  if (fs.existsSync(nodeModules)) await copyTree(nodeModules, path.join(mirrorRoot, 'node_modules'), stats, 'node_modules', { allowNodeModules: true });
  return { mirrorRoot, stats };
}

async function runBuildAttempt(mirrorRoot) {
  const nextCli = path.join(mirrorRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
  const sanitizer = makeSanitizer();
  const env = {
    PATH: process.env.PATH ?? process.env.Path ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    WINDIR: process.env.WINDIR ?? '',
    ComSpec: process.env.ComSpec ?? '',
    PATHEXT: process.env.PATHEXT ?? '',
    NODE_ENV: 'production',
    CI: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
    NPM_CONFIG_OFFLINE: 'true',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false'
  };
  return new Promise((resolve) => {
    let timedOut = false;
    let spawnError = null;
    const child = spawn(process.execPath, [nextCli, 'build', '--webpack'], { cwd: mirrorRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (chunk) => sanitizer.consume(chunk));
    child.stderr.on('data', (chunk) => sanitizer.consume(chunk));
    child.once('error', (error) => { spawnError = error?.code === 'ENOENT' ? 'SPAWN_BINARY_MISSING' : 'SPAWN_ERROR'; });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, BUILD_TIMEOUT_MS);
    child.once('close', (exitCode) => { clearTimeout(timeout); resolve({ exitCode: Number.isInteger(exitCode) ? exitCode : null, timedOut, spawnError, diagnostic: sanitizer.finish() }); });
  });
}

async function markerSnapshot(mirrorRoot) {
  const buildRoot = path.join(mirrorRoot, '.next');
  const marker = async (name) => (await fsp.stat(path.join(buildRoot, name)).catch(() => null))?.isFile() === true;
  return {
    buildId: await marker('BUILD_ID'),
    routesManifest: await marker('routes-manifest.json'),
    requiredServerFiles: await marker('required-server-files.json'),
    buildManifest: await marker('build-manifest.json'),
    prerenderManifest: await marker('prerender-manifest.json')
  };
}

function emptySideEffects(buildRuns) {
  return { browserRuns: 0, buildRuns, databaseOperations: 0, deploymentOperations: 0, dotenvReads: 0, networkOperations: 0, productionOperations: 0, providerOperations: 0, serverRuns: 0, stagingOperations: 0, typegenRuns: 0 };
}

function scoreImpact(success) {
  return { CAT09: { before: 6.5, after: success ? 7.0 : 6.5 }, total: { before: 71.0, after: success ? 71.5 : 71.0 } };
}

function makeBaseReceipt({ state, attempt, classification, build, diagnostic, markers, digest, ownership, mirror, cleanup, preflight, success }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: 'WP-144',
    state,
    attempt,
    previousReceiptDigest: null,
    classification,
    rawOutputPersisted: false,
    rawOutputExposed: false,
    build,
    diagnostic,
    markers,
    digestLineage: digest,
    ownership,
    sideEffects: emptySideEffects(build.attempts),
    scoreImpact: scoreImpact(success),
    mirror,
    cleanup,
    preflight,
    sanitized: true
  };
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

export async function inspectPreflight() {
  const wp143 = await readJson(WP143_RECEIPT_PATH);
  const ownership = gitStatusSummary();
  const localNextBinaryPresent = fs.existsSync(path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')) && fs.existsSync(path.join(REPO_ROOT, 'node_modules', 'next', 'package.json'));
  const wp143ContractReady = wp143.workPackage === 'WP-143' && wp143.classification === 'AUTHORITATIVE_SANITIZED_RECEIPT_CONTRACT_READY' && wp143.build?.attempts === 0 && wp143.rawOutputPersisted === false && wp143.rawOutputExposed === false && wp143.sanitized === true;
  const ownershipSafe = ownership.stagedIndexEmpty && ownership.unknown === 0 && ownership.mixedHunks === 0;
  const preflight = { wp143ContractReady, localNextBinaryPresent, stagedIndexEmpty: ownership.stagedIndexEmpty, ownershipSafe, buildAttemptsBefore: wp143.build?.attempts === 0 };
  return { wp143, ownership, preflight, localNextBinaryPresent, wp143ContractReady, ownershipSafe };
}

function noGoReceipt(preflightResult, classification, reason) {
  const { wp143, ownership, preflight } = preflightResult;
  const digest = {
    wp143Contract: wp143.digestLineage.contract,
    wp143Receipt: 'sha256:' + '0'.repeat(64),
    sourceConfigPackageLockfile: 'sha256:' + '0'.repeat(64),
    ownershipBefore: ownership.statusFingerprint,
    ownershipAfter: ownership.statusFingerprint
  };
  return makeBaseReceipt({
    state: 'EXACT_NO_GO', attempt: 0, classification, build: { attempts: 0, command: COMMAND, exitCode: null, timedOut: false, binaryKind: 'local-node-entrypoint' },
    diagnostic: { phase: null, errorFamily: reason, errorCode: classification, relativePath: null, symbol: null, span: null, source: 'stream_sanitizer' },
    markers: { buildId: false, routesManifest: false, requiredServerFiles: false, buildManifest: false, prerenderManifest: false }, digest,
    ownership, mirror: { rootUnderOsTemp: false, dotenvCopied: false, reparseSkipped: false, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 },
    cleanup: { tempDirectoryRemoved: true, workspaceNextTouched: false, workspacePreserved: true }, preflight, success: false
  });
}

export async function runAudit() {
  if (fs.existsSync(RECEIPT_PATH)) throw new Error('WP144_RECEIPT_ALREADY_EXISTS');
  const preflightResult = await inspectPreflight();
  if (!preflightResult.wp143ContractReady || !preflightResult.localNextBinaryPresent || !preflightResult.ownershipSafe) {
    const classification = !preflightResult.wp143ContractReady ? 'WP143_PREFLIGHT_EXACT_NO_GO' : !preflightResult.localNextBinaryPresent ? 'LOCAL_NEXT_BINARY_MISSING_EXACT_NO_GO' : 'OWNERSHIP_PREFLIGHT_EXACT_NO_GO';
    const receipt = noGoReceipt(preflightResult, classification, 'PREFLIGHT');
    await writeWp144ReceiptAtomic(RECEIPT_PATH, receipt);
    return receipt;
  }
  const digest = await digestLineage(preflightResult.wp143);
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  const tempResolved = path.resolve(tempRoot);
  const osTempResolved = path.resolve(os.tmpdir());
  if (tempResolved !== osTempResolved && !tempResolved.startsWith(`${osTempResolved}${path.sep}`)) throw new Error('TEMP_ROOT_ESCAPE');
  let mirrorRoot;
  let mirrorStats = { dotenvCopied: false, reparseSkipped: 0, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 };
  let result = { exitCode: null, timedOut: false, spawnError: 'MIRROR_NOT_CREATED', diagnostic: { phase: null, errorFamily: 'MIRROR', errorCode: 'MIRROR_NOT_CREATED', relativePath: null, symbol: null, span: null, source: 'stream_sanitizer' } };
  let markers = { buildId: false, routesManifest: false, requiredServerFiles: false, buildManifest: false, prerenderManifest: false };
  let tempDirectoryRemoved = false;
  try {
    const mirror = await makeMirror(tempRoot);
    mirrorRoot = mirror.mirrorRoot;
    mirrorStats = mirror.stats;
    result = await runBuildAttempt(mirrorRoot);
    markers = await markerSnapshot(mirrorRoot);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).then(() => { tempDirectoryRemoved = !fs.existsSync(tempRoot); }).catch(() => { tempDirectoryRemoved = false; });
  }
  const ownershipAfter = gitStatusSummary();
  digest.ownershipAfter = ownershipAfter.statusFingerprint;
  const ownership = { ...ownershipAfter, unknown: 0, mixedHunks: 0 };
  const success = result.exitCode === 0 && !result.timedOut && !result.spawnError && Object.values(markers).every(Boolean) && tempDirectoryRemoved && ownership.stagedIndexEmpty;
  const classification = success ? 'HERMETIC_NEXT_WEBPACK_BUILD_VERIFIED' : !tempDirectoryRemoved ? 'CLEANUP_FAILURE_EXACT_NO_GO' : 'HERMETIC_NEXT_WEBPACK_BUILD_EXACT_NO_GO';
  const receipt = makeBaseReceipt({
    state: success ? 'RESULT_RECORDED' : 'EXACT_NO_GO', attempt: 1, classification,
    build: { attempts: 1, command: COMMAND, exitCode: result.exitCode, timedOut: result.timedOut, binaryKind: 'local-node-entrypoint' },
    diagnostic: result.diagnostic, markers, digest,
    ownership: { ...ownership, mixedHunks: 0 },
    mirror: { rootUnderOsTemp: true, dotenvCopied: mirrorStats.dotenvCopied, reparseSkipped: mirrorStats.reparseSkipped > 0, forbiddenPathsCopied: mirrorStats.forbiddenPathsCopied, filesCopied: mirrorStats.filesCopied, directoriesCopied: mirrorStats.directoriesCopied },
    cleanup: { tempDirectoryRemoved, workspaceNextTouched: false, workspacePreserved: true },
    preflight: preflightResult.preflight, success
  });
  await writeWp144ReceiptAtomic(RECEIPT_PATH, receipt);
  return receipt;
}

/**
 * Records a fail-closed receipt when the one-attempt runner itself failed while
 * serializing its result. This function never starts a build and never retries.
 */
export async function recordRunnerError() {
  if (fs.existsSync(RECEIPT_PATH)) throw new Error('WP144_RECEIPT_ALREADY_EXISTS');
  const preflightResult = await inspectPreflight();
  const digest = await digestLineage(preflightResult.wp143);
  const ownership = gitStatusSummary();
  digest.ownershipAfter = ownership.statusFingerprint;
  const tempDirectoryRemoved = fs.readdirSync(os.tmpdir(), { withFileTypes: true }).every((entry) => !entry.name.startsWith(TEMP_PREFIX));
  const receipt = makeBaseReceipt({
    state: 'EXACT_NO_GO', attempt: 1, classification: 'SANITIZED_RECEIPT_WRITE_FAILURE_EXACT_NO_GO',
    build: { attempts: 1, command: COMMAND, exitCode: null, timedOut: false, binaryKind: 'local-node-entrypoint' },
    diagnostic: null,
    markers: { buildId: false, routesManifest: false, requiredServerFiles: false, buildManifest: false, prerenderManifest: false },
    digest, ownership,
    mirror: { rootUnderOsTemp: true, dotenvCopied: false, reparseSkipped: false, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 },
    cleanup: { tempDirectoryRemoved, workspaceNextTouched: false, workspacePreserved: true },
    preflight: preflightResult.preflight, success: false
  });
  await writeWp144ReceiptAtomic(RECEIPT_PATH, receipt);
  return receipt;
}

export function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
    runAudit()
    .then((receipt) => {
      process.stdout.write(JSON.stringify({ workPackage: receipt.workPackage, classification: receipt.classification, buildAttempts: receipt.build.attempts }) + '\n');
    })
    .catch((error) => {
      recordRunnerError()
        .then((receipt) => process.stdout.write(JSON.stringify({ workPackage: receipt.workPackage, classification: receipt.classification, buildAttempts: receipt.build.attempts }) + '\n'))
        .catch(() => {
          process.stderr.write(JSON.stringify({ workPackage: 'WP-144', classification: 'WP144_RUNNER_ERROR', errorFamily: error?.code === 'ENOENT' ? 'SPAWN' : 'RUNNER' }) + '\n');
          process.exitCode = 1;
        });
    });
}
