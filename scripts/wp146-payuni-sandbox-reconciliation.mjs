import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = path.join(REPO_ROOT, '.ai-team', 'reports', 'wp146-payuni-sandbox-reconciliation.json');
const INPUT_PATHS = Object.freeze({
  wp117: path.join(REPO_ROOT, '.ai-team', 'reports', 'wp117-20260802-payuni-refund-reconciliation', 'sanitized-receipt.json'),
  wp118: path.join(REPO_ROOT, '.ai-team', 'reports', 'wp118-payuni-refund-reconciliation-local-receipt.json'),
  wp132Routing: path.join(REPO_ROOT, '.ai-team', 'reports', 'wp132-payuni-staging-preflight-receipt.json'),
  wp132Postdeploy: path.join(REPO_ROOT, '.ai-team', 'reports', 'wp132-postdeploy-preflight-receipt.json')
});
const SCHEMA_VERSION = 'wp146-payuni-sandbox-reconciliation/v1';
const ROOT_KEYS = new Set(['schemaVersion', 'workPackage', 'state', 'classification', 'evidenceIds', 'lineage', 'currentIdentity', 'syntheticPendingReservationCount', 'contradictionCount', 'scoreImpact', 'sideEffects', 'safety', 'sanitized']);
const IDENTITY_KEYS = new Set(['routeMarker', 'versionMarker', 'databaseIdentityMarker', 'sameEnvironmentGeneration', 'productionIdentityDetected']);
const SCORE_KEYS = new Set(['CAT04', 'total']);
const SIDE_EFFECT_KEYS = new Set(['payuniProviderQuery', 'stagingDatabaseWrite', 'databaseQuery', 'network', 'browser', 'server', 'build', 'deployment', 'production']);
const SAFETY_KEYS = new Set(['rawResponseSaved', 'cookiesSaved', 'tokensSaved', 'environmentFileRead', 'sourceIdsPersisted']);
const HASH = /^sha256:[0-9a-f]{64}$/u;

export const WP146_CONSTANTS = Object.freeze({ SCHEMA_VERSION, INPUT_COUNT: Object.keys(INPUT_PATHS).length });

function onlyKeys(value, allowed) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => allowed.has(key));
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function readNumber(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function validateWp146Receipt(receipt) {
  const errors = [];
  if (!onlyKeys(receipt, ROOT_KEYS)) errors.push('root:UNKNOWN_FIELD');
  if (receipt?.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion:INVALID');
  if (receipt?.workPackage !== 'WP-146') errors.push('workPackage:INVALID');
  if (!['RECONCILED', 'EXACT_NO_GO_EXTERNAL_REFRESH_REQUIRED'].includes(receipt?.state)) errors.push('state:INVALID');
  if (typeof receipt?.classification !== 'string' || !/^[A-Z0-9_]+$/u.test(receipt.classification)) errors.push('classification:INVALID');
  if (!Array.isArray(receipt?.evidenceIds) || receipt.evidenceIds.length !== 4 || receipt.evidenceIds.some((id) => !/^WP-\d+(?:-[a-z]+)?$/u.test(id))) errors.push('evidenceIds:INVALID');
  if (!receipt?.lineage || Object.keys(receipt.lineage).length !== 4 || Object.values(receipt.lineage).some((value) => !HASH.test(value))) errors.push('lineage:INVALID');
  if (!onlyKeys(receipt?.currentIdentity, IDENTITY_KEYS) || Object.values(receipt.currentIdentity).some((value) => typeof value !== 'boolean')) errors.push('currentIdentity:INVALID');
  if (readNumber(receipt?.syntheticPendingReservationCount) === null) errors.push('syntheticPendingReservationCount:INVALID');
  if (readNumber(receipt?.contradictionCount) === null) errors.push('contradictionCount:INVALID');
  if (!onlyKeys(receipt?.scoreImpact, SCORE_KEYS) || !Number.isFinite(receipt.scoreImpact?.CAT04?.before) || !Number.isFinite(receipt.scoreImpact?.CAT04?.after) || !Number.isFinite(receipt.scoreImpact?.total?.before) || !Number.isFinite(receipt.scoreImpact?.total?.after)) errors.push('scoreImpact:INVALID');
  if (!onlyKeys(receipt?.sideEffects, SIDE_EFFECT_KEYS) || Object.values(receipt.sideEffects ?? {}).some((value) => value !== 0)) errors.push('sideEffects:INVALID');
  if (!onlyKeys(receipt?.safety, SAFETY_KEYS) || Object.values(receipt.safety ?? {}).some((value) => value !== false)) errors.push('safety:INVALID');
  if (receipt?.sanitized !== true) errors.push('sanitized:MUST_BE_TRUE');
  return { ok: errors.length === 0, errors };
}

export function serializeWp146Receipt(receipt) {
  const validation = validateWp146Receipt(receipt);
  if (!validation.ok) throw new Error(`WP146_RECEIPT_INVALID:${validation.errors.join(',')}`);
  return `${JSON.stringify(receipt)}\n`;
}

export function buildReconciliation({ wp117, wp118, wp132Routing, wp132Postdeploy, digests }) {
  const currentIdentity = {
    routeMarker: wp132Postdeploy?.staging?.route_not_found === false && wp132Postdeploy?.staging?.authenticated_admin_ui === true,
    versionMarker: false,
    databaseIdentityMarker: wp132Routing?.preflight?.non_production_db_identity_proven === true,
    sameEnvironmentGeneration: false,
    productionIdentityDetected: wp117?.sandboxAction?.productionEndpointUsed === true || wp117?.sandboxAction?.productionCredentialUsed === true
  };
  const pendingCount = wp132Postdeploy?.local_snapshot?.pending_reservation_count;
  const contradictionCount = [
    wp117?.postRefundLocalObservation?.reconciled !== true,
    wp118?.acceptance?.live_sandbox_or_staging_proof !== true,
    pendingCount !== 1,
    currentIdentity.versionMarker !== true,
    currentIdentity.databaseIdentityMarker !== true
  ].filter(Boolean).length;
  const exactNoGo = pendingCount !== 1 || contradictionCount !== 0 || currentIdentity.productionIdentityDetected;
  return {
    schemaVersion: SCHEMA_VERSION,
    workPackage: 'WP-146',
    state: exactNoGo ? 'EXACT_NO_GO_EXTERNAL_REFRESH_REQUIRED' : 'RECONCILED',
    classification: exactNoGo ? 'EXACT_NO_GO_EXTERNAL_REFRESH_REQUIRED' : 'CAT04_LOCAL_EVIDENCE_RECONCILED',
    evidenceIds: ['WP-117', 'WP-118', 'WP-132-routing', 'WP-132-postdeploy'],
    lineage: {
      wp117: digests.wp117,
      wp118: digests.wp118,
      wp132Routing: digests.wp132Routing,
      wp132Postdeploy: digests.wp132Postdeploy
    },
    currentIdentity,
    syntheticPendingReservationCount: readNumber(pendingCount) ?? 0,
    contradictionCount,
    scoreImpact: { CAT04: { before: 6.0, after: 6.0 }, total: { before: 71.0, after: 71.0 } },
    sideEffects: { payuniProviderQuery: 0, stagingDatabaseWrite: 0, databaseQuery: 0, network: 0, browser: 0, server: 0, build: 0, deployment: 0, production: 0 },
    safety: { rawResponseSaved: false, cookiesSaved: false, tokensSaved: false, environmentFileRead: false, sourceIdsPersisted: false },
    sanitized: true
  };
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, 'utf8'));
}

async function hashInputs() {
  const digests = {};
  for (const [key, filePath] of Object.entries(INPUT_PATHS)) digests[key] = digestBytes(await fsp.readFile(filePath));
  return digests;
}

async function writeExclusive(targetPath, receipt) {
  if (fs.existsSync(targetPath)) throw new Error('WP146_RECEIPT_ALREADY_EXISTS');
  const payload = serializeWp146Receipt(receipt);
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, payload, { encoding: 'utf8', flag: 'wx' });
    const parsed = JSON.parse(await fsp.readFile(temporaryPath, 'utf8'));
    if (!validateWp146Receipt(parsed).ok) throw new Error('WP146_TEMP_READBACK_INVALID');
    await fsp.rename(temporaryPath, targetPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function runOfflineReconciliation() {
  if (fs.existsSync(OUTPUT_PATH)) throw new Error('WP146_RECEIPT_ALREADY_EXISTS');
  const [wp117, wp118, wp132Routing, wp132Postdeploy] = await Promise.all(Object.values(INPUT_PATHS).map(readJson));
  const receipt = buildReconciliation({ wp117, wp118, wp132Routing, wp132Postdeploy, digests: await hashInputs() });
  await writeExclusive(OUTPUT_PATH, receipt);
  return receipt;
}

export function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  runOfflineReconciliation()
    .then((receipt) => process.stdout.write(JSON.stringify({ workPackage: receipt.workPackage, classification: receipt.classification, pendingReservationCount: receipt.syntheticPendingReservationCount, contradictionCount: receipt.contradictionCount }) + '\n'))
    .catch(() => {
      process.stderr.write(JSON.stringify({ workPackage: 'WP-146', classification: 'WP146_RUNNER_ERROR', errorFamily: 'OFFLINE_RECONCILIATION' }) + '\n');
      process.exitCode = 1;
    });
}
