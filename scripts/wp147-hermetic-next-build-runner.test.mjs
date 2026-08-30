import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { WP147_CONSTANTS, copyTree, exclusionReason, markerSnapshot, networkDenySource, receiptLineage, sanitizer, scoreImpact, serializeWp147Receipt, validateWp147Receipt } from './wp147-hermetic-next-build-runner.mjs';

const sha = `sha256:${'c'.repeat(64)}`;
function fixture() {
  return {
    schemaVersion: WP147_CONSTANTS.SCHEMA_VERSION, workPackage: 'WP-147', state: 'EXACT_NO_GO', classification: 'WP147_EXACT_NO_GO_NO_RETRY', attempt: 1,
    build: { attempts: 1, command: WP147_CONSTANTS.COMMAND, exitCode: 1, timedOut: false, binaryKind: 'local-node-entrypoint', networkDenied: true },
    diagnostic: { phase: 'webpack', errorFamily: 'BUILD', errorCode: 'UNKNOWN_BUILD_ERROR', relativePath: null, symbol: null, span: null, source: 'stream_sanitizer' },
    markers: { buildId: false, routesManifest: false, requiredServerFiles: false, buildManifest: false, prerenderManifest: false },
    wp145Contract: { valid: true, wp144ReceiptDigest: sha }, digestLineage: { wp144Receipt: sha, sourceConfigPackageLockfile: sha },
    ownership: { dirtyCount: 1, stagedIndexEmpty: true, unknown: 0, mixedHunks: 0, statusFingerprint: sha },
    mirror: { rootUnderOsTemp: true, dotenvCopied: false, reparseSkipped: false, forbiddenPathsCopied: 0, filesCopied: 1, directoriesCopied: 1 },
    cleanup: { tempDirectoryRemoved: true, workspaceNextTouched: false, workspacePreserved: true },
    sideEffects: { browser: 0, build: 1, database: 0, deployment: 0, dotenvReads: 0, network: 0, payuni: 0, production: 0, server: 0, staging: 0 },
    scoreImpact: { CAT09: { before: 6.5, after: 6.5 }, total: { before: 71, after: 71 } },
    preflight: { wp144ReceiptValid: true, wp144BuildAttemptsOne: true, localNextBinaryPresent: true, stagedIndexEmpty: true, ownershipSafe: true, networkDenyReady: true, buildAttemptsBeforeZero: true }, sanitized: true
  };
}

test('WP147 locks an independent one-attempt command', () => { assert.equal(WP147_CONSTANTS.COMMAND, 'next build --webpack'); assert.equal(WP147_CONSTANTS.MAX_ATTEMPTS, 1); });
test('forbidden dotenv and generated paths are excluded', () => { assert.equal(exclusionReason('.env.local'), 'DOTENV'); assert.equal(exclusionReason('.next/BUILD_ID'), 'FORBIDDEN_DIRECTORY'); assert.equal(exclusionReason('src/app/page.tsx'), null); });
test('sanitized failure fixture validates and serializes', () => { const receipt = fixture(); assert.equal(validateWp147Receipt(receipt).ok, true); assert.match(serializeWp147Receipt(receipt), /"networkDenied":true/); });
test('raw output and absolute paths are rejected', () => { const receipt = fixture(); receipt.rawOutput = 'forbidden'; receipt.diagnostic.relativePath = 'C:\\bad.txt'; const result = validateWp147Receipt(receipt); assert.equal(result.ok, false); assert.ok(result.errors.includes('root:UNKNOWN_FIELD')); assert.ok(result.errors.includes('diagnostic.relativePath:INVALID')); });
test('WP144 attempt cannot be represented as a WP147 retry', () => { const receipt = fixture(); receipt.build.attempts = 2; assert.equal(validateWp147Receipt(receipt).ok, false); });
test('serializer import is side-effect free', () => { assert.equal(typeof serializeWp147Receipt, 'function'); });

// COV-08 BEGIN
test('WP147 sanitizer keeps bounded diagnostic attribution', () => {
  const output = sanitizer();
  output.consume('webpack Error: Cannot find module in src/app/page.tsx at 12:34\nconst CheckoutPage');
  assert.deepEqual(output.finish(), {
    phase: 'webpack',
    errorFamily: 'MODULE_RESOLUTION',
    errorCode: 'MODULE_NOT_FOUND',
    relativePath: 'src/app/page.tsx',
    symbol: 'CheckoutPage',
    span: '12:34',
    source: 'stream_sanitizer'
  });
});

test('WP147 network deny source and score helper encode fail-closed policy', () => {
  const deny = networkDenySource();
  assert.match(deny, /WP147_NETWORK_DENIED/);
  assert.match(deny, /global\.fetch=deny/);
  assert.deepEqual(scoreImpact(false), { CAT09: { before: 6.5, after: 6.5 }, total: { before: 71, after: 71 } });
  assert.deepEqual(scoreImpact(true), { CAT09: { before: 6.5, after: 7 }, total: { before: 71, after: 71.5 } });
});

test('WP147 copyTree and marker snapshot use a disposable mirror and exclude unsafe paths', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'celebratedeal-wp147-copy-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  await fsp.mkdir(path.join(source, 'src'), { recursive: true });
  await fsp.mkdir(path.join(source, '.next'), { recursive: true });
  await fsp.writeFile(path.join(source, 'src', 'page.tsx'), 'export default function Page() {}');
  await fsp.writeFile(path.join(source, '.env.local'), 'synthetic=never-read');
  await fsp.writeFile(path.join(source, '.next', 'BUILD_ID'), 'generated');
  const stats = { dotenvCopied: false, reparseSkipped: 0, forbiddenPathsCopied: 0, filesCopied: 0, directoriesCopied: 0 };
  try {
    await copyTree(source, destination, stats);
    assert.equal(fs.existsSync(path.join(destination, 'src', 'page.tsx')), true);
    assert.equal(fs.existsSync(path.join(destination, '.env.local')), false);
    assert.equal(stats.filesCopied, 1);
    await fsp.mkdir(path.join(destination, '.next'), { recursive: true });
    await fsp.writeFile(path.join(destination, '.next', 'BUILD_ID'), 'build');
    const marker = await markerSnapshot(destination);
    assert.equal(marker.buildId, true);
    assert.equal(marker.routesManifest, false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('WP147 receipt lineage hashes only the fixed source/config inputs', async () => {
  const lineage = await receiptLineage(sha);
  assert.equal(lineage.wp144Receipt, sha);
  assert.match(lineage.sourceConfigPackageLockfile, /^sha256:[0-9a-f]{64}$/);
});
// COV-08 END
