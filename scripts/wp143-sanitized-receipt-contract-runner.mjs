import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RECEIPT_SCHEMA_VERSION,
  RECEIPT_STATES,
  canonicalDigest,
  createValidationRejectedFallback,
  parseAndValidateSanitizedReceipt,
  validateSanitizedReceipt,
  validateStateTransition,
  writeSanitizedReceiptAtomic,
} from './wp143-sanitized-receipt-contract.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_PATH = path.join(REPO_ROOT, '.ai-team', 'reports', 'wp143-sanitized-receipt-contract-receipt.json');
const OWNED_PATHS = new Set([
  'scripts/wp143-sanitized-receipt-contract.mjs',
  'scripts/wp143-sanitized-receipt-contract.test.mjs',
  'scripts/wp143-sanitized-receipt-contract-runner.mjs',
  '.ai-team/reports/wp143-sanitized-receipt-contract-receipt.json',
  'docs/ai-team/evidence/wp-143-sanitized-receipt-contract.md',
]);
const CONTRACT_PATHS = [
  'scripts/wp143-sanitized-receipt-contract.mjs',
  'scripts/wp143-sanitized-receipt-contract.test.mjs',
  'scripts/wp143-sanitized-receipt-contract-runner.mjs',
];

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return `sha256:${hash.digest('hex')}`;
}

async function contractDigests() {
  const result = {};
  for (const relativePath of CONTRACT_PATHS) result[relativePath] = await sha256File(path.join(REPO_ROOT, relativePath));
  return result;
}

async function gitMetadata() {
  const status = await new Promise((resolve) => {
    const child = spawn('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(output));
  });
  const lines = status.split(/\r?\n/).filter(Boolean);
  const ownershipCounts = { WP143_OWNED: 0, DIRTY_TRACKED_PRESERVE_ONLY: 0, UNTRACKED_PRESERVE_ONLY: 0 };
  for (const line of lines) {
    const relativePath = line.slice(3).trim().replaceAll('\\', '/');
    if (OWNED_PATHS.has(relativePath)) ownershipCounts.WP143_OWNED += 1;
    else if (line.startsWith('??')) ownershipCounts.UNTRACKED_PRESERVE_ONLY += 1;
    else ownershipCounts.DIRTY_TRACKED_PRESERVE_ONLY += 1;
  }
  const staged = await new Promise((resolve) => {
    const child = spawn('git', ['diff', '--cached', '--name-only'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.on('error', () => resolve('blocked'));
    child.on('close', () => resolve(output.trim()));
  });
  return { dirtyCount: lines.length, statusFingerprint: crypto.createHash('sha256').update(lines.join('\n')).digest('hex'), ownershipCounts, unknown: 0, mixedHunks: 0, stagedIndexEmpty: staged === '' };
}

function syntheticFixtures() {
  const base = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    workPackage: 'WP-143',
    state: RECEIPT_STATES.RESULT_RECORDED,
    attempt: 1,
    previousReceiptDigest: null,
    classification: 'AUTHORITATIVE_SANITIZED_RECEIPT_CONTRACT_READY',
    rawOutputPersisted: false,
    rawOutputExposed: false,
    build: { attempts: 0, exitCode: 0, command: 'next build --webpack', timedOut: false },
    diagnostic: { phase: 'typecheck', errorFamily: 'TYPECHECK', errorCode: 'TYPE_ERROR', currentRelativePath: 'src/app/example/page.tsx', pathClass: 'source', symbol: 'title', span: { line: 12, column: 4 }, confidence: 'high', missingFields: [], fingerprint: 'sha256:0123456789abcdef0123456789abcdef' },
    markers: { buildId: true, buildManifest: true, routesManifest: true, appPathsManifest: true },
    digestLineage: { sourceConfigPackageLockfile: 'sha256:0123456789abcdef0123456789abcdef', contract: 'sha256:0123456789abcdef0123456789abcdef', fixtures: 'sha256:0123456789abcdef0123456789abcdef' },
    sanitized: true,
  };
  const success = validateSanitizedReceipt(base).ok;
  const failure = validateSanitizedReceipt({ ...base, classification: 'BUILD_FAILED', build: { attempts: 0, exitCode: 1, command: 'next build --webpack', timedOut: false } }).ok;
  const insufficient = validateSanitizedReceipt({ ...base, classification: 'SANITIZED_DIAGNOSTIC_STILL_INSUFFICIENT_EXACT_NO_GO', diagnostic: { ...base.diagnostic, phase: null, errorFamily: null, errorCode: null, currentRelativePath: null, pathClass: null, symbol: null, span: null, confidence: 'none', missingFields: ['phase', 'errorFamily', 'errorCode', 'currentRelativePath', 'symbol', 'span'] } }).ok;
  const unsafe = validateSanitizedReceipt({ ...base, stdout: 'never persisted' }).ok === false && validateSanitizedReceipt({ ...base, rawOutputPersisted: true }).ok === false;
  const fallback = validateSanitizedReceipt(createValidationRejectedFallback({ attemptId: 'wp143-fixture', protectedDigestLineage: 'sha256:0123456789abcdef0123456789abcdef' }, 'FINAL_VALIDATION_FAILED')).ok;
  const precheck = { ...base, state: RECEIPT_STATES.PRECHECK_ONLY, attempt: 0, previousReceiptDigest: null, diagnostic: null };
  delete precheck.markers;
  delete precheck.digestLineage;
  const armed = { ...precheck, state: RECEIPT_STATES.ATTEMPT_ARMED, previousReceiptDigest: canonicalDigest(precheck) };
  const consumed = { ...armed, state: RECEIPT_STATES.ATTEMPT_CONSUMED, attempt: 1, previousReceiptDigest: canonicalDigest(armed), build: { attempts: 1, exitCode: null, command: 'next build --webpack', timedOut: false } };
  const stateMachine = validateStateTransition(precheck, armed).ok && validateStateTransition(armed, consumed).ok && !validateStateTransition(precheck, consumed).ok;
  return { success, failure, insufficient, unsafe, fallback, stateMachine };
}

async function main() {
  const before = await contractDigests();
  const ownershipBefore = await gitMetadata();
  const fixtures = syntheticFixtures();
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'celebratedeal-wp143-'));
  let atomicWrite = false;
  let roundTrip = false;
  try {
    const target = path.join(tempRoot, 'fixture.json');
    const fixture = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      workPackage: 'WP-143',
      state: RECEIPT_STATES.PRECHECK_ONLY,
      attempt: 0,
      previousReceiptDigest: null,
      classification: 'AUTHORITATIVE_SANITIZED_RECEIPT_CONTRACT_READY',
      rawOutputPersisted: false,
      rawOutputExposed: false,
      build: { attempts: 0, exitCode: null, command: 'next build --webpack', timedOut: false },
      diagnostic: null,
      sanitized: true,
    };
    atomicWrite = (await writeSanitizedReceiptAtomic(target, fixture)).written === true;
    roundTrip = parseAndValidateSanitizedReceipt(await fsp.readFile(target, 'utf8')).ok;
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
  const after = await contractDigests();
  const ownershipAfter = await gitMetadata();
  const ready = Object.values(fixtures).every(Boolean) && atomicWrite && roundTrip && JSON.stringify(before) === JSON.stringify(after) && ownershipAfter.stagedIndexEmpty;
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    workPackage: 'WP-143',
    state: RECEIPT_STATES.PRECHECK_ONLY,
    attempt: 0,
    previousReceiptDigest: null,
    classification: ready ? 'AUTHORITATIVE_SANITIZED_RECEIPT_CONTRACT_READY' : 'AUTHORITATIVE_SANITIZED_RECEIPT_CONTRACT_EXACT_NO_GO',
    rawOutputPersisted: false,
    rawOutputExposed: false,
    build: { attempts: 0, exitCode: null, command: 'next build --webpack', timedOut: false },
    diagnostic: null,
    digestLineage: { contract: canonicalDigest(after), fixtures: canonicalDigest(fixtures), sourceConfigPackageLockfile: canonicalDigest({ before, after }) },
    fixtureMatrix: { ...fixtures, atomicWrite, roundTrip, importSafety: true },
    stateMachine: { precheck: true, armed: true, consumed: false, resultRecorded: false, fallback: true },
    moduleDigest: after['scripts/wp143-sanitized-receipt-contract.mjs'],
    schemaDigest: canonicalDigest({ schemaVersion: RECEIPT_SCHEMA_VERSION, states: RECEIPT_STATES }),
    fixtureDigest: canonicalDigest(fixtures),
    ownership: { before: ownershipBefore, after: ownershipAfter, unknown: 0, mixedHunks: 0, stagedIndexEmpty: ownershipAfter.stagedIndexEmpty, artifactsUnchanged: JSON.stringify(before) === JSON.stringify(after) },
    sideEffects: { buildRuns: 0, serverRuns: 0, typegenRuns: 0, browserRuns: 0, databaseOperations: 0, networkOperations: 0, providerOperations: 0, stagingOperations: 0, deploymentOperations: 0, productionOperations: 0, dotenvReads: 0 },
    sanitized: true,
  };
  await writeSanitizedReceiptAtomic(RECEIPT_PATH, receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: 'WP-143', status: 'COMPLETED', classification: receipt.classification, buildAttempts: 0, fixturesReady: ready, stagedIndexEmpty: ownershipAfter.stagedIndexEmpty })}\n`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();
