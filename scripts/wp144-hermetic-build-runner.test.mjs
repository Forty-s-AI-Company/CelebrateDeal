import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WP144_CONSTANTS,
  copyTree,
  emptySideEffects,
  exclusionReason,
  isDotenvPath,
  makeSanitizer,
  markerSnapshot,
  readJson,
  safeResolveUnder,
  scoreImpact,
  sha256File,
  serializeWp144Receipt,
  validateWp144Receipt,
  writeWp144ReceiptAtomic
} from './wp144-hermetic-build-runner.mjs';

const sha = `sha256:${'a'.repeat(64)}`;
function fixture() {
  const ownership = { dirtyCount: 1, stagedIndexEmpty: true, unknown: 0, mixedHunks: 0, statusFingerprint: sha };
  return {
    schemaVersion: WP144_CONSTANTS.SCHEMA_VERSION, workPackage: 'WP-144', state: 'EXACT_NO_GO', attempt: 0,
    previousReceiptDigest: null, classification: 'FIXTURE_EXACT_NO_GO', rawOutputPersisted: false, rawOutputExposed: false,
    build: { attempts: 0, command: WP144_CONSTANTS.COMMAND, exitCode: null, timedOut: false, binaryKind: 'local-node-entrypoint' },
    diagnostic: { phase: null, errorFamily: 'PREFLIGHT', errorCode: 'FIXTURE', relativePath: null, symbol: null, span: null, source: 'stream_sanitizer' },
    markers: { buildId: false, routesManifest: false, requiredServerFiles: false, buildManifest: false, prerenderManifest: false },
    digestLineage: { wp143Contract: sha, wp143Receipt: sha, sourceConfigPackageLockfile: sha, ownershipBefore: sha, ownershipAfter: sha },
    ownership, sideEffects: { browserRuns: 0, buildRuns: 0, databaseOperations: 0, deploymentOperations: 0, dotenvReads: 0, networkOperations: 0, productionOperations: 0, providerOperations: 0, serverRuns: 0, stagingOperations: 0, typegenRuns: 0 },
    scoreImpact: { CAT09: { before: 6.5, after: 6.5 }, total: { before: 71, after: 71 } },
    mirror: { rootUnderOsTemp: false, dotenvCopied: false, reparseSkipped: false, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 },
    cleanup: { tempDirectoryRemoved: true, workspaceNextTouched: false, workspacePreserved: true },
    preflight: { wp143ContractReady: false, localNextBinaryPresent: false, stagedIndexEmpty: true, ownershipSafe: true, buildAttemptsBefore: true }, sanitized: true
  };
}

test('WP144 constants lock one exact build command and one attempt', () => {
  assert.equal(WP144_CONSTANTS.COMMAND, 'next build --webpack');
  assert.equal(WP144_CONSTANTS.MAX_ATTEMPTS, 1);
});

test('dotenv and forbidden paths are fail-closed before file copy', () => {
  assert.equal(isDotenvPath('.env.local'), true);
  assert.equal(isDotenvPath('src/.env.test'), true);
  assert.equal(exclusionReason('.next/BUILD_ID'), 'FORBIDDEN_DIRECTORY');
  assert.equal(exclusionReason('.env.local'), 'DOTENV');
  assert.equal(exclusionReason('private/card.pem'), 'PRIVATE_OR_DATABASE_FILE');
  assert.equal(exclusionReason('src/app/page.tsx'), null);
});

test('safeResolveUnder rejects path escape', () => {
  const root = path.join(os.tmpdir(), 'wp144-test-root');
  assert.equal(safeResolveUnder(root, 'src/page.tsx'), path.join(root, 'src', 'page.tsx'));
  assert.throws(() => safeResolveUnder(root, '../outside.txt'), /PATH_ESCAPE/);
});

test('valid sanitized receipt round-trips', () => {
  const receipt = fixture();
  assert.deepEqual(validateWp144Receipt(receipt), { ok: true, errors: [] });
  assert.match(serializeWp144Receipt(receipt), /"rawOutputPersisted":false/);
});

test('span normalization accepts a bounded line:column and rejects malformed spans', () => {
  const receipt = fixture();
  receipt.diagnostic = { phase: 'webpack', errorFamily: 'TYPECHECK', errorCode: 'TYPE_ERROR', relativePath: 'src/app/page.tsx', symbol: 'Page', span: '12:34', source: 'stream_sanitizer' };
  assert.equal(validateWp144Receipt(receipt).ok, true);
  receipt.diagnostic.span = '12:34:56';
  assert.equal(validateWp144Receipt(receipt).ok, false);
});

test('raw output fields and unknown keys are rejected', () => {
  const receipt = fixture();
  receipt.rawOutput = 'must never be saved';
  receipt.rawOutputPersisted = true;
  const result = validateWp144Receipt(receipt);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('root:UNKNOWN_FIELD'));
  assert.ok(result.errors.includes('rawOutputPersisted:MUST_BE_FALSE'));
});

test('absolute paths and urls are rejected from diagnostics', () => {
  const receipt = fixture();
  receipt.diagnostic = { phase: 'build', errorFamily: 'BUILD', errorCode: 'X', relativePath: 'C:\\secret.txt', symbol: 'https://example.invalid', span: '1:1', source: 'stream_sanitizer' };
  const result = validateWp144Receipt(receipt);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('diagnostic.relativePath:INVALID_PATH'));
  assert.ok(result.errors.includes('diagnostic.symbol:UNSAFE'));
});

test('atomic writer refuses overwrite and leaves a readable receipt', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'wp144-receipt-test-'));
  const target = path.join(root, 'receipt.json');
  await writeWp144ReceiptAtomic(target, fixture());
  assert.equal(fs.existsSync(target), true);
  const readback = JSON.parse(await fsp.readFile(target, 'utf8'));
  assert.deepEqual(validateWp144Receipt(readback), { ok: true, errors: [] });
  await assert.rejects(() => writeWp144ReceiptAtomic(target, fixture()), /ALREADY_EXISTS/);
  await fsp.rm(root, { recursive: true, force: true });
});

test('receipt validator rejects each unsafe lineage, ownership, mirror and preflight shape', () => {
  const cases = [
    ['previousReceiptDigest', (receipt) => { receipt.previousReceiptDigest = 'not-a-sha'; }],
    ['classification', (receipt) => { receipt.classification = 'not safe'; }],
    ['build', (receipt) => { receipt.build.attempts = 2; }],
    ['markers', (receipt) => { receipt.markers.buildId = 'yes'; }],
    ['digestLineage', (receipt) => { receipt.digestLineage.wp143Contract = 'sha256:bad'; }],
    ['ownership', (receipt) => { receipt.ownership.unknown = 1; }],
    ['sideEffects', (receipt) => { receipt.sideEffects.networkOperations = -1; }],
    ['scoreImpact', (receipt) => { receipt.scoreImpact.CAT09.before = Number.NaN; }],
    ['mirror', (receipt) => { receipt.mirror.dotenvCopied = 'yes'; }],
    ['cleanup', (receipt) => { receipt.cleanup.workspacePreserved = 'yes'; }],
    ['preflight', (receipt) => { receipt.preflight.buildAttemptsBefore = 'yes'; }],
  ];
  for (const [field, mutate] of cases) {
    const receipt = fixture();
    mutate(receipt);
    const result = validateWp144Receipt(receipt);
    assert.equal(result.ok, false, field);
  }
});

test('path and diagnostic allowlists reject traversal, dotenv variants, and unsafe scalar values', () => {
  assert.equal(isDotenvPath('.env'), true);
  assert.equal(isDotenvPath('nested/.env.production'), true);
  assert.equal(isDotenvPath('nested/env.example.txt'), false);
  assert.equal(exclusionReason('node_modules/pkg/index.js'), 'FORBIDDEN_DIRECTORY');
  assert.equal(exclusionReason('certs/service.key'), 'PRIVATE_OR_DATABASE_FILE');
  assert.equal(exclusionReason('src/components/form.tsx'), null);
  assert.equal(safeResolveUnder('C:/workspace', 'src/page.tsx'), path.resolve('C:/workspace/src/page.tsx'));
  assert.throws(() => safeResolveUnder('C:/workspace', 'C:/outside/page.tsx'), /PATH_ESCAPE/);
});

test('receipt validation fails closed for unsafe diagnostic enum and scalar shapes', () => {
  const cases = [
    (receipt) => { receipt.diagnostic.phase = 'raw:output'; },
    (receipt) => { receipt.diagnostic.source = 'unknown-source'; },
    (receipt) => { receipt.diagnostic.span = '0'; },
    (receipt) => { receipt.build.binaryKind = 'remote'; },
    (receipt) => { receipt.ownership.statusFingerprint = 'sha256:not-a-digest'; },
    (receipt) => { receipt.sideEffects.networkOperations = -1; },
    (receipt) => { receipt.cleanup.workspaceTouched = 'true'; },
  ];

  for (const mutate of cases) {
    const receipt = fixture();
    mutate(receipt);
    assert.equal(validateWp144Receipt(receipt).ok, false);
  }
});

// COV-08 BEGIN
test('WP144 sanitizer attributes phase, error, path, symbol and span without raw output', () => {
  const sanitizer = makeSanitizer();
  sanitizer.consume('Type error in src/app/page.tsx at 12:34\nconst CheckoutPage = () => null');
  const diagnostic = sanitizer.finish();
  assert.deepEqual(diagnostic, {
    phase: 'typecheck',
    errorFamily: 'TYPECHECK',
    errorCode: 'TYPE_ERROR',
    relativePath: 'src/app/page.tsx',
    symbol: 'CheckoutPage',
    span: '12:34',
    source: 'stream_sanitizer'
  });
});

test('WP144 copyTree excludes dotenv, generated and private files in a temp fixture', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'celebratedeal-wp144-copy-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  await fsp.mkdir(path.join(source, 'src'), { recursive: true });
  await fsp.mkdir(path.join(source, '.next'), { recursive: true });
  await fsp.mkdir(path.join(source, 'certs'), { recursive: true });
  await fsp.writeFile(path.join(source, 'src', 'page.tsx'), 'export default function Page() {}');
  await fsp.writeFile(path.join(source, '.env.local'), 'synthetic=never-read');
  await fsp.writeFile(path.join(source, '.next', 'BUILD_ID'), 'generated');
  await fsp.writeFile(path.join(source, 'certs', 'service.key'), 'private');
  const stats = { dotenvCopied: false, reparseSkipped: 0, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 };
  try {
    await copyTree(source, destination, stats);
    assert.equal(fs.existsSync(path.join(destination, 'src', 'page.tsx')), true);
    assert.equal(fs.existsSync(path.join(destination, '.env.local')), false);
    assert.equal(fs.existsSync(path.join(destination, '.next')), false);
    assert.equal(fs.existsSync(path.join(destination, 'certs')), true);
    assert.deepEqual(fs.readdirSync(path.join(destination, 'certs')), []);
    assert.equal(stats.dotenvCopied, true);
    assert.equal(stats.filesCopied, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('WP144 marker snapshot, JSON readback and score side-effects helpers stay deterministic', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'celebratedeal-wp144-markers-'));
  try {
    await fsp.mkdir(path.join(root, '.next'), { recursive: true });
    await fsp.writeFile(path.join(root, '.next', 'BUILD_ID'), 'build');
    await fsp.writeFile(path.join(root, '.next', 'routes-manifest.json'), '{}');
    const marker = await markerSnapshot(root);
    assert.equal(marker.buildId, true);
    assert.equal(marker.routesManifest, true);
    assert.equal(marker.requiredServerFiles, false);
    const jsonPath = path.join(root, 'receipt.json');
    await fsp.writeFile(jsonPath, JSON.stringify({ status: 'synthetic' }));
    assert.deepEqual(await readJson(jsonPath), { status: 'synthetic' });
    assert.deepEqual(emptySideEffects(2), { browserRuns: 0, buildRuns: 2, databaseOperations: 0, deploymentOperations: 0, dotenvReads: 0, networkOperations: 0, productionOperations: 0, providerOperations: 0, serverRuns: 0, stagingOperations: 0, typegenRuns: 0 });
    assert.deepEqual(scoreImpact(false), { CAT09: { before: 6.5, after: 6.5 }, total: { before: 71, after: 71 } });
    assert.deepEqual(scoreImpact(true), { CAT09: { before: 6.5, after: 7 }, total: { before: 71, after: 71.5 } });
    assert.match(await sha256File(jsonPath), /^sha256:[0-9a-f]{64}$/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
// COV-08 END
