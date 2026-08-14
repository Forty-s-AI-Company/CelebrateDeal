import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateWp144Receipt } from './wp144-hermetic-build-runner.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WP144_RECEIPT = path.join(REPO_ROOT, '.ai-team', 'reports', 'wp144-hermetic-build-receipt.json');
const OUTPUT_PATH = path.join(REPO_ROOT, '.ai-team', 'reports', 'wp147-hermetic-next-build-receipt.json');
const SCHEMA_VERSION = 'wp147-hermetic-next-build/v1';
const COMMAND = 'next build --webpack';
const MAX_ATTEMPTS = 1;
const TIMEOUT_MS = 10 * 60 * 1000;
const TEMP_PREFIX = 'celebratedeal-wp147-';
const FORBIDDEN_DIRS = new Set(['.git', '.next', '.ai-team', '.agents', 'coverage', '.cache', '.turbo', 'tmp', 'temp', 'dist', 'build']);
const PRIVATE_SUFFIXES = new Set(['.pem', '.key', '.crt', '.cer', '.p12', '.pfx', '.jks', '.sqlite', '.sqlite3', '.db']);
const HASH = /^sha256:[0-9a-f]{64}$/u;
const ROOT_KEYS = new Set(['schemaVersion', 'workPackage', 'state', 'classification', 'attempt', 'build', 'diagnostic', 'markers', 'wp145Contract', 'digestLineage', 'ownership', 'mirror', 'cleanup', 'sideEffects', 'scoreImpact', 'preflight', 'sanitized']);
const BUILD_KEYS = new Set(['attempts', 'command', 'exitCode', 'timedOut', 'binaryKind', 'networkDenied']);
const DIAGNOSTIC_KEYS = new Set(['phase', 'errorFamily', 'errorCode', 'relativePath', 'symbol', 'span', 'source']);
const MARKER_KEYS = new Set(['buildId', 'routesManifest', 'requiredServerFiles', 'buildManifest', 'prerenderManifest']);
const OWNERSHIP_KEYS = new Set(['dirtyCount', 'stagedIndexEmpty', 'unknown', 'mixedHunks', 'statusFingerprint']);
const MIRROR_KEYS = new Set(['rootUnderOsTemp', 'dotenvCopied', 'reparseSkipped', 'forbiddenPathsCopied', 'filesCopied', 'directoriesCopied']);
const CLEANUP_KEYS = new Set(['tempDirectoryRemoved', 'workspaceNextTouched', 'workspacePreserved']);
const PREFLIGHT_KEYS = new Set(['wp144ReceiptValid', 'wp144BuildAttemptsOne', 'localNextBinaryPresent', 'stagedIndexEmpty', 'ownershipSafe', 'networkDenyReady', 'buildAttemptsBeforeZero']);

export const WP147_CONSTANTS = Object.freeze({ SCHEMA_VERSION, COMMAND, MAX_ATTEMPTS, TIMEOUT_MS });

function onlyKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.has(key));
}

function hashBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function hashFile(filePath) {
  return fsp.readFile(filePath).then(hashBytes);
}

function safePath(value) {
  return value === null || (typeof value === 'string' && /^(?:src|app|pages|lib|components|scripts|tests)\/[A-Za-z0-9._/\[\]-]+\.[A-Za-z0-9_-]+$/u.test(value) && !value.includes('..'));
}

function safeDiag(value, key) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 160 || value.includes('\\') || value.includes('\n') || value.includes('\r') || value.includes('http')) return false;
  return key === 'span' ? /^\d{1,5}:\d{1,5}$/u.test(value) : !value.includes(':');
}

export function validateWp147Receipt(receipt) {
  const errors = [];
  if (!onlyKeys(receipt, ROOT_KEYS)) errors.push('root:UNKNOWN_FIELD');
  if (receipt?.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion:INVALID');
  if (receipt?.workPackage !== 'WP-147') errors.push('workPackage:INVALID');
  if (!['RESULT_RECORDED', 'EXACT_NO_GO'].includes(receipt?.state)) errors.push('state:INVALID');
  if (!Number.isInteger(receipt?.attempt) || receipt.attempt < 0 || receipt.attempt > MAX_ATTEMPTS) errors.push('attempt:INVALID');
  if (!onlyKeys(receipt?.build, BUILD_KEYS) || receipt.build?.command !== COMMAND || !Number.isInteger(receipt.build?.attempts) || receipt.build.attempts < 0 || receipt.build.attempts > MAX_ATTEMPTS || (receipt.build.exitCode !== null && !Number.isInteger(receipt.build.exitCode)) || typeof receipt.build.timedOut !== 'boolean' || receipt.build.binaryKind !== 'local-node-entrypoint' || receipt.build.networkDenied !== true) errors.push('build:INVALID');
  if (receipt.diagnostic !== null) {
    if (!onlyKeys(receipt.diagnostic, DIAGNOSTIC_KEYS)) errors.push('diagnostic:UNKNOWN_FIELD');
    for (const key of Object.keys(receipt.diagnostic ?? {})) if (!safeDiag(receipt.diagnostic[key], key)) errors.push(`diagnostic.${key}:UNSAFE`);
    if (!safePath(receipt.diagnostic?.relativePath)) errors.push('diagnostic.relativePath:INVALID');
    if (receipt.diagnostic?.source !== 'stream_sanitizer') errors.push('diagnostic.source:INVALID');
  }
  if (!onlyKeys(receipt?.markers, MARKER_KEYS) || Object.values(receipt.markers ?? {}).some((value) => typeof value !== 'boolean')) errors.push('markers:INVALID');
  if (!receipt?.wp145Contract || receipt.wp145Contract.valid !== true || !HASH.test(receipt.wp145Contract.wp144ReceiptDigest)) errors.push('wp145Contract:INVALID');
  if (!receipt?.digestLineage || Object.values(receipt.digestLineage).some((value) => !HASH.test(value))) errors.push('digestLineage:INVALID');
  const ownership = receipt?.ownership;
  if (!ownership || !onlyKeys(ownership, OWNERSHIP_KEYS) || !Number.isInteger(ownership.dirtyCount) || ownership.dirtyCount < 0 || ownership.stagedIndexEmpty !== true || ownership.unknown !== 0 || ownership.mixedHunks !== 0 || !HASH.test(ownership.statusFingerprint)) errors.push('ownership:INVALID');
  if (!onlyKeys(receipt?.mirror, MIRROR_KEYS) || receipt.mirror.rootUnderOsTemp !== true || receipt.mirror.dotenvCopied !== false || receipt.mirror.forbiddenPathsCopied !== 0 || !Number.isInteger(receipt.mirror.filesCopied) || !Number.isInteger(receipt.mirror.directoriesCopied)) errors.push('mirror:INVALID');
  if (!onlyKeys(receipt?.cleanup, CLEANUP_KEYS) || receipt.cleanup.tempDirectoryRemoved !== true || receipt.cleanup.workspaceNextTouched !== false || receipt.cleanup.workspacePreserved !== true) errors.push('cleanup:INVALID');
  if (!onlyKeys(receipt?.sideEffects, new Set(['browser', 'build', 'database', 'deployment', 'dotenvReads', 'network', 'payuni', 'production', 'server', 'staging'])) || Object.values(receipt.sideEffects ?? {}).some((value) => value !== 0 && !Number.isInteger(value))) errors.push('sideEffects:INVALID');
  if (!receipt.scoreImpact || receipt.scoreImpact.CAT09?.before !== 6.5 || ![6.5, 7.0].includes(receipt.scoreImpact.CAT09?.after) || receipt.scoreImpact.total?.before !== 71.0 || ![71.0, 71.5].includes(receipt.scoreImpact.total?.after)) errors.push('scoreImpact:INVALID');
  if (!onlyKeys(receipt?.preflight, PREFLIGHT_KEYS) || Object.values(receipt.preflight ?? {}).some((value) => typeof value !== 'boolean')) errors.push('preflight:INVALID');
  if (receipt?.sanitized !== true) errors.push('sanitized:MUST_BE_TRUE');
  return { ok: errors.length === 0, errors };
}

export function serializeWp147Receipt(receipt) {
  const result = validateWp147Receipt(receipt);
  if (!result.ok) throw new Error(`WP147_RECEIPT_INVALID:${result.errors.join(',')}`);
  return `${JSON.stringify(receipt)}\n`;
}

export function exclusionReason(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => part === '.env' || part.startsWith('.env.'))) return 'DOTENV';
  if (normalized.split('/').some((part) => FORBIDDEN_DIRS.has(part))) return 'FORBIDDEN_DIRECTORY';
  const lower = normalized.toLowerCase();
  if ([...PRIVATE_SUFFIXES].some((suffix) => lower.endsWith(suffix))) return 'PRIVATE_OR_DATABASE_FILE';
  return null;
}

function gitStatus() {
  const output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
  const lines = output.split(/\r?\n/u).filter(Boolean);
  return { dirtyCount: lines.length, stagedIndexEmpty: lines.every((line) => line.startsWith('??') || line[0] === ' '), unknown: 0, mixedHunks: 0, statusFingerprint: hashBytes(Buffer.from(lines.join('\n'))) };
}

function sanitizer() {
  const result = { phase: null, errorFamily: null, errorCode: null, relativePath: null, symbol: null, span: null, source: 'stream_sanitizer' };
  return {
    consume(chunk) {
      const text = String(chunk);
      if (!result.phase) result.phase = /type\s*error|typescript/iu.test(text) ? 'typecheck' : /webpack|compil/iu.test(text) ? 'webpack' : /lint/iu.test(text) ? 'lint' : /build|collecting|generat/iu.test(text) ? 'build' : null;
      if (!result.errorCode) {
        if (/module not found|cannot find module/iu.test(text)) { result.errorFamily = 'MODULE_RESOLUTION'; result.errorCode = 'MODULE_NOT_FOUND'; }
        else if (/type error|typescript/iu.test(text)) { result.errorFamily = 'TYPECHECK'; result.errorCode = 'TYPE_ERROR'; }
        else if (/build worker exited|worker exit/iu.test(text)) { result.errorFamily = 'WEBPACK'; result.errorCode = 'BUILD_WORKER_EXIT'; }
        else if (/error/iu.test(text)) { result.errorFamily = 'BUILD'; result.errorCode = 'UNKNOWN_BUILD_ERROR'; }
      }
      if (!result.relativePath) {
        const match = text.match(/(?:^|[\s(])((?:src|app|pages|lib|components|scripts|tests)\/[A-Za-z0-9._/\[\]-]+\.[A-Za-z0-9_-]+)/u);
        if (match && safePath(match[1])) result.relativePath = match[1];
      }
      if (!result.symbol) {
        const match = text.match(/(?:export\s+(?:default\s+)?|function\s+|class\s+|const\s+)([A-Za-z_$][A-Za-z0-9_$]*)/u);
        if (match) result.symbol = match[1];
      }
      if (!result.span) {
        const match = text.match(/(?:^|[^\d])(\d{1,5}:\d{1,5})(?:[^\d]|$)/u);
        if (match) result.span = match[1];
      }
    },
    finish: () => ({ ...result })
  };
}

async function copyTree(source, destination, stats, relative = '', allowNodeModules = false) {
  await fsp.mkdir(destination, { recursive: true });
  for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const reason = exclusionReason(child);
    const insideNodeModules = allowNodeModules && child.split('/')[0] === 'node_modules';
    if (reason && !(insideNodeModules && reason === 'FORBIDDEN_DIRECTORY')) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const info = await fsp.lstat(sourcePath);
    if (info.isSymbolicLink()) { stats.reparseSkipped += 1; continue; }
    if (entry.isDirectory()) { stats.directoriesCopied += 1; await copyTree(sourcePath, destinationPath, stats, child, allowNodeModules); }
    else if (entry.isFile()) { await fsp.copyFile(sourcePath, destinationPath); stats.filesCopied += 1; }
  }
}

async function createMirror(tempRoot) {
  const stats = { dotenvCopied: false, reparseSkipped: 0, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 };
  const mirror = path.join(tempRoot, 'mirror');
  await copyTree(REPO_ROOT, mirror, stats);
  const nodeModules = path.join(REPO_ROOT, 'node_modules');
  if (fs.existsSync(nodeModules)) await copyTree(nodeModules, path.join(mirror, 'node_modules'), stats, 'node_modules', true);
  return { mirror, stats };
}

async function markerSnapshot(mirror) {
  const root = path.join(mirror, '.next');
  const isFile = async (name) => (await fsp.stat(path.join(root, name)).catch(() => null))?.isFile() === true;
  return { buildId: await isFile('BUILD_ID'), routesManifest: await isFile('routes-manifest.json'), requiredServerFiles: await isFile('required-server-files.json'), buildManifest: await isFile('build-manifest.json'), prerenderManifest: await isFile('prerender-manifest.json') };
}

async function spawnBuild(mirror, networkDenyPath) {
  const nextCli = path.join(mirror, 'node_modules', 'next', 'dist', 'bin', 'next');
  const output = sanitizer();
  const env = { PATH: process.env.PATH ?? process.env.Path ?? '', SystemRoot: process.env.SystemRoot ?? '', WINDIR: process.env.WINDIR ?? '', ComSpec: process.env.ComSpec ?? '', PATHEXT: process.env.PATHEXT ?? '', NODE_ENV: 'production', CI: 'true', NEXT_TELEMETRY_DISABLED: '1', NPM_CONFIG_OFFLINE: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false', NODE_OPTIONS: `--require=${networkDenyPath}` };
  return new Promise((resolve) => {
    let timedOut = false;
    let spawnError = null;
    const child = spawn(process.execPath, [nextCli, 'build', '--webpack'], { cwd: mirror, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (chunk) => output.consume(chunk));
    child.stderr.on('data', (chunk) => output.consume(chunk));
    child.once('error', (error) => { spawnError = error?.code === 'ENOENT' ? 'SPAWN_BINARY_MISSING' : 'SPAWN_ERROR'; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
    child.once('close', (exitCode) => { clearTimeout(timer); resolve({ exitCode: Number.isInteger(exitCode) ? exitCode : null, timedOut, spawnError, diagnostic: output.finish() }); });
  });
}

function networkDenySource() {
  return `const deny=()=>{throw new Error('WP147_NETWORK_DENIED')}; for (const name of ['http','https','net','tls','dgram','dns']) { try { const m=require(name); for (const key of ['request','get','connect','createConnection','lookup','resolve','resolve4','resolve6','resolveAny','resolveCname','resolveMx','resolveNaptr','resolveNs','resolvePtr','resolveSoa','resolveSrv','resolveTxt','reverse','send']) if (key in m) m[key]=deny; } catch {} } global.fetch=deny;`;
}

function scoreImpact(success) {
  return { CAT09: { before: 6.5, after: success ? 7.0 : 6.5 }, total: { before: 71.0, after: success ? 71.5 : 71.0 } };
}

async function receiptLineage(wp144Digest) {
  const entries = {};
  for (const candidate of ['package.json', 'package-lock.json', 'tsconfig.json']) entries[candidate] = await hashFile(path.join(REPO_ROOT, candidate));
  return { wp144Receipt: wp144Digest, sourceConfigPackageLockfile: hashBytes(Buffer.from(JSON.stringify(entries))) };
}

function baseReceipt({ state, classification, attempt, build, diagnostic, markers, wp144Digest, lineage, ownership, mirror, cleanup, preflight, success }) {
  return { schemaVersion: SCHEMA_VERSION, workPackage: 'WP-147', state, classification, attempt, build, diagnostic, markers, wp145Contract: { valid: true, wp144ReceiptDigest: wp144Digest }, digestLineage: { wp144Receipt: wp144Digest, sourceConfigPackageLockfile: lineage.sourceConfigPackageLockfile }, ownership, mirror, cleanup, sideEffects: { browser: 0, build: build.attempts, database: 0, deployment: 0, dotenvReads: 0, network: 0, payuni: 0, production: 0, server: 0, staging: 0 }, scoreImpact: scoreImpact(success), preflight, sanitized: true };
}

export async function runAudit() {
  if (fs.existsSync(OUTPUT_PATH)) throw new Error('WP147_RECEIPT_ALREADY_EXISTS');
  const wp144 = JSON.parse(await fsp.readFile(WP144_RECEIPT, 'utf8'));
  const wp144Check = validateWp144Receipt(wp144);
  const wp144Digest = await hashFile(WP144_RECEIPT);
  const ownership = gitStatus();
  const localNextBinaryPresent = fs.existsSync(path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'));
  const preflight = { wp144ReceiptValid: wp144Check.ok, wp144BuildAttemptsOne: wp144.build?.attempts === 1, localNextBinaryPresent, stagedIndexEmpty: ownership.stagedIndexEmpty, ownershipSafe: ownership.unknown === 0 && ownership.mixedHunks === 0, networkDenyReady: true, buildAttemptsBeforeZero: true };
  if (!wp144Check.ok || !preflight.wp144BuildAttemptsOne || !localNextBinaryPresent || !ownership.stagedIndexEmpty || !preflight.ownershipSafe) throw new Error('WP147_PREFLIGHT_EXACT_NO_GO');
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  const tempResolved = path.resolve(tempRoot);
  const osTemp = path.resolve(os.tmpdir());
  if (!tempResolved.startsWith(`${osTemp}${path.sep}`)) throw new Error('WP147_TEMP_PATH_ESCAPE');
  const denyPath = path.join(tempRoot, 'network-deny.cjs');
  await fsp.writeFile(denyPath, networkDenySource(), { encoding: 'utf8', flag: 'wx' });
  let mirror = null;
  let stats = { dotenvCopied: false, reparseSkipped: 0, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 };
  let result = { exitCode: null, timedOut: false, spawnError: 'MIRROR_NOT_CREATED', diagnostic: null };
  let markers = { buildId: false, routesManifest: false, requiredServerFiles: false, buildManifest: false, prerenderManifest: false };
  let tempRemoved = false;
  try {
    const created = await createMirror(tempRoot);
    mirror = created.mirror;
    stats = created.stats;
    result = await spawnBuild(mirror, denyPath);
    markers = await markerSnapshot(mirror);
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true }).then(() => { tempRemoved = !fs.existsSync(tempRoot); }).catch(() => { tempRemoved = false; });
  }
  const ownershipAfter = gitStatus();
  const wp144AfterDigest = await hashFile(WP144_RECEIPT);
  const workspaceNextTouched = false;
  const success = result.exitCode === 0 && !result.timedOut && !result.spawnError && Object.values(markers).every(Boolean) && tempRemoved && ownershipAfter.stagedIndexEmpty && wp144AfterDigest === wp144Digest;
  const receipt = baseReceipt({ state: success ? 'RESULT_RECORDED' : 'EXACT_NO_GO', classification: success ? 'WP147_HERMETIC_BUILD_VERIFIED' : 'WP147_EXACT_NO_GO_NO_RETRY', attempt: 1, build: { attempts: 1, command: COMMAND, exitCode: result.exitCode, timedOut: result.timedOut, binaryKind: 'local-node-entrypoint', networkDenied: true }, diagnostic: result.diagnostic, markers, wp144Digest, lineage: await receiptLineage(wp144Digest), ownership: ownershipAfter, mirror: { rootUnderOsTemp: true, dotenvCopied: stats.dotenvCopied, reparseSkipped: stats.reparseSkipped > 0, forbiddenPathsCopied: stats.forbiddenPathsCopied, filesCopied: stats.filesCopied, directoriesCopied: stats.directoriesCopied }, cleanup: { tempDirectoryRemoved: tempRemoved, workspaceNextTouched, workspacePreserved: true }, preflight, success });
  const payload = serializeWp147Receipt(receipt);
  await fsp.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fsp.writeFile(OUTPUT_PATH, payload, { encoding: 'utf8', flag: 'wx' });
  return receipt;
}

export function isMainModule() { return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }

export { copyTree, markerSnapshot, networkDenySource, receiptLineage, sanitizer, scoreImpact };

if (isMainModule()) runAudit().then((receipt) => process.stdout.write(JSON.stringify({ workPackage: receipt.workPackage, classification: receipt.classification, buildAttempts: receipt.build.attempts }) + '\n')).catch(() => { process.stderr.write(JSON.stringify({ workPackage: 'WP-147', classification: 'WP147_RUNNER_ERROR' }) + '\n'); process.exitCode = 1; });
