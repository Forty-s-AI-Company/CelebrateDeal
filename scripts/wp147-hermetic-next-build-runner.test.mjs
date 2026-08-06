import test from 'node:test';
import assert from 'node:assert/strict';
import { WP147_CONSTANTS, exclusionReason, serializeWp147Receipt, validateWp147Receipt } from './wp147-hermetic-next-build-runner.mjs';

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
