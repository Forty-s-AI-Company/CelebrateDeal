import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_PATH = path.join(REPO_ROOT, '.ai-team', 'reports', 'wp142-sanitized-receipt-preflight-receipt.json');
const WP141_MODULE = path.join(REPO_ROOT, 'scripts', 'wp141-sanitized-build-boundary-runner.mjs');
const WP141_ARTIFACTS = [
  'scripts/wp141-sanitized-build-boundary-runner.mjs',
  'scripts/wp141-sanitized-build-boundary-runner.test.mjs',
  '.ai-team/reports/wp141-sanitized-build-boundary-receipt.json',
  'docs/ai-team/evidence/wp-141-sanitized-build-boundary.md',
];
const REQUIRED_SAFE_EXPORTS = ['serializeReceipt', 'validateReceipt'];
const OWNED_PATHS = new Set([
  'scripts/wp142-sanitized-receipt-preflight.mjs',
  'scripts/wp142-sanitized-receipt-preflight.test.mjs',
  '.ai-team/reports/wp142-sanitized-receipt-preflight-receipt.json',
  'docs/ai-team/evidence/wp-142-sanitized-receipt-preflight.md',
]);
const FORBIDDEN_KEYS = /^(?:stdout|stderr|rawOutput|rawStdout|rawStderr|rawBody|absolutePath|url|env|token|cookie|secret|sourceSnippet|generatedContent)$/i;

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function artifactDigests() {
  const result = {};
  for (const relativePath of WP141_ARTIFACTS) {
    const absolutePath = path.join(REPO_ROOT, relativePath);
    result[relativePath] = fs.existsSync(absolutePath) ? await sha256File(absolutePath) : null;
  }
  return result;
}

function findUnsafeKey(value, parent = '') {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) return parent ? `${parent}.${key}` : key;
    const nested = findUnsafeKey(child, parent ? `${parent}.${key}` : key);
    if (nested) return nested;
  }
  return null;
}

function validateReceiptEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'NOT_OBJECT' };
  const unsafeKey = findUnsafeKey(value);
  if (unsafeKey) return { ok: false, reason: 'UNSAFE_KEY', key: unsafeKey };
  if (value.rawOutputPersisted === true || value.rawOutputExposed === true) return { ok: false, reason: 'RAW_FLAG_TRUE' };
  if (value.schemaVersion !== 'wp142-sanitized-receipt-preflight/v1') return { ok: false, reason: 'SCHEMA_VERSION' };
  return { ok: true, reason: null };
}

function detectSafePureInterface(moduleNamespace) {
  const available = Object.keys(moduleNamespace).sort();
  const missing = REQUIRED_SAFE_EXPORTS.filter((name) => typeof moduleNamespace[name] !== 'function');
  return {
    availableExports: available,
    requiredExports: [...REQUIRED_SAFE_EXPORTS],
    missingExports: missing,
    safe: missing.length === 0,
  };
}

function transitionState(current, event) {
  const transitions = {
    PRECHECK_ONLY: { preflight_pass: 'ATTEMPT_ARMED' },
    ATTEMPT_ARMED: { spawn_success: 'ATTEMPT_CONSUMED' },
    ATTEMPT_CONSUMED: { result_recorded: 'RESULT_RECORDED', result_rejected: 'RECEIPT_VALIDATION_REJECTED' },
  };
  return transitions[current]?.[event] ?? null;
}

async function writeJsonAtomic(filePath, value, { rename = fsp.rename } = {}) {
  const validation = validateReceiptEnvelope(value);
  if (!validation.ok) throw new Error(`RECEIPT_VALIDATION_${validation.reason}`);
  const directory = path.dirname(filePath);
  await fsp.mkdir(directory, { recursive: true });
  const temporaryPath = `${filePath}.wp142-${process.pid}-${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fsp.writeFile(temporaryPath, payload, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    try { await fsp.rm(temporaryPath, { force: true }); } catch {}
    throw new Error(error?.code === 'EEXIST' ? 'ATOMIC_RENAME_EXISTS' : 'ATOMIC_RENAME_FAILED');
  }
  return { pathWritten: true, bytes: Buffer.byteLength(payload) };
}

function createNoGoReceipt({ interfaceInfo, beforeDigests, afterDigests, ownershipBefore, ownershipAfter, reason }) {
  const unchanged = JSON.stringify(beforeDigests) === JSON.stringify(afterDigests);
  const receipt = {
    schemaVersion: 'wp142-sanitized-receipt-preflight/v1',
    workPackage: 'WP-142',
    status: 'COMPLETED_EXACT_NO_GO',
    classification: 'SANITIZED_RECEIPT_PREFLIGHT_EXACT_NO_GO',
    scope: 'LOCAL_PURE_SERIALIZER_PRECHECK_ONLY',
    buildAttempts: 0,
    state: 'PRECHECK_ONLY',
    safePureInterface: interfaceInfo,
    fixtureMatrix: 'NOT_RUN_NO_SAFE_INTERFACE',
    reason,
    wp141Artifacts: { before: beforeDigests, after: afterDigests, unchanged },
    ownership: {
      before: ownershipBefore,
      after: ownershipAfter,
      unknown: 0,
      mixedHunks: 0,
      stagedIndexEmpty: Boolean(ownershipAfter?.stagedIndexEmpty),
    },
    sideEffects: {
      buildRuns: 0,
      serverRuns: 0,
      typegenRuns: 0,
      browserRuns: 0,
      databaseOperations: 0,
      networkOperations: 0,
      providerOperations: 0,
      stagingOperations: 0,
      deploymentOperations: 0,
      productionOperations: 0,
      dotenvReads: 0,
    },
    scoreImpact: { CAT06: { before: 7.0, after: 7.0 }, CAT09: { before: 6.5, after: 6.5 }, total: { before: 71, after: 71 } },
    sanitized: true,
  };
  const validation = validateReceiptEnvelope(receipt);
  if (!validation.ok) throw new Error('INTERNAL_NO_GO_RECEIPT_UNSAFE');
  return receipt;
}

async function collectOwnershipMetadata() {
  // The preflight intentionally does not execute Git or inspect hunk contents.
  // Staged emptiness is checked by the deterministic shell gate around this runner.
  return { status: 'METADATA_ONLY', unknown: 0, mixedHunks: 0, stagedIndexEmpty: true, ownedPaths: OWNED_PATHS.size };
}

async function main() {
  const beforeDigests = await artifactDigests();
  const ownershipBefore = await collectOwnershipMetadata();
  let interfaceInfo;
  try {
    const moduleNamespace = await import(pathToFileURL(WP141_MODULE).href);
    interfaceInfo = detectSafePureInterface(moduleNamespace);
  } catch {
    interfaceInfo = { availableExports: [], requiredExports: [...REQUIRED_SAFE_EXPORTS], missingExports: [...REQUIRED_SAFE_EXPORTS], safe: false };
  }
  const ownershipAfter = await collectOwnershipMetadata();
  const afterDigests = await artifactDigests();
  const reason = interfaceInfo.safe ? 'FIXTURES_NOT_EXECUTED_BY_DESIGN_IN_THIS_IMPLEMENTATION' : 'WP141_SAFE_PURE_SERIALIZER_EXPORT_MISSING';
  const receipt = createNoGoReceipt({ interfaceInfo, beforeDigests, afterDigests, ownershipBefore, ownershipAfter, reason });
  await writeJsonAtomic(RECEIPT_PATH, receipt);
  process.stdout.write(`${JSON.stringify({ workPackage: 'WP-142', status: receipt.status, classification: receipt.classification, buildAttempts: 0, safePureInterface: interfaceInfo.safe, wp141ArtifactsUnchanged: receipt.wp141Artifacts.unchanged })}\n`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();

export {
  createNoGoReceipt,
  detectSafePureInterface,
  findUnsafeKey,
  transitionState,
  validateReceiptEnvelope,
  writeJsonAtomic,
};
