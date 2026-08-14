import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyDiagnostic,
  collectMetadata,
  copyTree,
  createNetworkDenialSource,
  createSanitizer,
  ensureNoRawFields,
  extractRelativePath,
  extractSpan,
  extractSymbol,
  inferError,
  inferPhase,
  markerSnapshot,
  normalizeRelativePath,
  readJson,
  sanitizeErrorType,
} from './wp141-sanitized-build-boundary-runner.mjs';

test('normalizes Windows and POSIX repository-relative paths without absolute prefixes', () => {
  assert.equal(normalizeRelativePath('C:\\temp\\mirror\\src\\app\\api\\demo\\route.ts:12:4'), 'src/app/api/demo/route.ts');
  assert.equal(normalizeRelativePath('/tmp/mirror/src/app/api/demo/route.ts(12,4)'), 'src/app/api/demo/route.ts');
  assert.equal(normalizeRelativePath('C:\\temp\\mirror\\.next\\server\\app-paths-manifest.json'), null);
});

test('extracts only allowlisted relative path, identifier symbol and numeric span', () => {
  const line = "Type error: C:\\tmp\\mirror\\src\\app\\api\\cloudflare\\stream-webhook\\route.ts:41:7 Property 'status' does not exist";
  assert.equal(extractRelativePath(line), 'src/app/api/cloudflare/stream-webhook/route.ts');
  assert.equal(extractSymbol(line), 'status');
  assert.deepEqual(extractSpan(line), { line: 41, column: 7 });
});

test('streaming sanitizer drops raw text and emits normalized fields only', () => {
  const sanitizer = createSanitizer();
  sanitizer.consume(Buffer.from('\u001b[31mType error: C:\\private\\src\\app\\page.tsx:9:2 Property \'title\' does not exist\u001b[0m\n'));
  const result = sanitizer.finish();
  assert.equal(result.errorFamily, 'TYPECHECK');
  assert.equal(result.errorCode, 'TYPE_ERROR');
  assert.equal(result.currentRelativePath, 'src/app/page.tsx');
  assert.equal(result.symbol, 'title');
  assert.deepEqual(result.span, { line: 9, column: 2 });
  assert.equal(result.outputLines, 1);
  assert.equal(Object.hasOwn(result, 'rawOutput'), false);
});

test('multiline and long lines remain bounded and never persist source snippets', () => {
  const sanitizer = createSanitizer();
  sanitizer.consume('Webpack failed\n' + 'x'.repeat(200000));
  const result = sanitizer.finish();
  assert.equal(result.longLineCount, 1);
  assert.equal(result.errorFamily, 'WEBPACK');
  assert.equal(Object.hasOwn(result, 'sourceSnippet'), false);
});

test('missing diagnostic fields fail closed', () => {
  const sanitizer = createSanitizer();
  sanitizer.consume('Build failed\n');
  const result = sanitizer.finish();
  assert.equal(result.confidence, 'low');
  assert.ok(result.missingFields.includes('currentRelativePath'));
  assert.equal(classifyDiagnostic(1, null, result, false), 'SANITIZED_DIAGNOSTIC_STILL_INSUFFICIENT_EXACT_NO_GO');
});

test('complete nonzero diagnostic maps only when all normalized fields are present', () => {
  const diagnostic = { missingFields: [] };
  assert.equal(classifyDiagnostic(1, null, diagnostic, false), 'SANITIZED_BUILD_BOUNDARY_MAPPED');
  assert.equal(classifyDiagnostic(0, null, diagnostic, false), 'LOCAL_ISOLATED_NEXT_BUILD_PASS');
});

test('network denial preload contains no credential inheritance and records only a marker', () => {
  const source = createNetworkDenialSource('C:/temp/wp141-marker');
  assert.match(source, /WP141_NETWORK_DENIED/);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /stdout|stderr|cookie|token|secret/i);
});

test('network denial wins over any build classification', () => {
  const diagnostic = { missingFields: [] };
  assert.equal(classifyDiagnostic(0, null, diagnostic, true), 'SANITIZED_NETWORK_DENIAL_EXACT_NO_GO');
});

test('normalization and sanitizer remain bounded for malformed and partial diagnostics', () => {
  assert.equal(normalizeRelativePath(null), null);
  assert.equal(normalizeRelativePath('file:///private/unknown.txt'), null);
  assert.equal(normalizeRelativePath('src/../secret.ts'), null);
  assert.equal(extractRelativePath('no repository path here'), null);
  assert.equal(extractSymbol('Type error: unknown value'), null);
  assert.deepEqual(extractSpan('line 12'), { line: 12, column: null });

  const sanitizer = createSanitizer();
  sanitizer.consume(Buffer.from('Webpack failed\r\n'));
  sanitizer.consume('src/app/page.tsx(4,2) member `render`\n');
  const result = sanitizer.finish();
  assert.equal(result.phase, 'webpack');
  assert.equal(result.errorFamily, 'WEBPACK');
  assert.equal(result.currentRelativePath, 'src/app/page.tsx');
  assert.equal(result.symbol, 'render');
  assert.deepEqual(result.span, { line: 4, column: 2 });
  assert.equal(result.missingFields.length, 0);
});

test('COV-09 diagnostic attribution and error sanitization are deterministic', () => {
  assert.equal(inferPhase('Running eslint'), 'lint');
  assert.equal(inferPhase('Generating static pages'), 'generate-static-pages');
  assert.equal(inferPhase('unrelated output'), null);
  assert.deepEqual(inferError('Cannot find module'), { family: 'MODULE_RESOLUTION', code: 'MODULE_NOT_FOUND', re: inferError('Cannot find module').re });
  assert.equal(inferError('unrelated output'), null);
  assert.equal(sanitizeErrorType({ code: 'ETIMEDOUT' }), 'TIMEOUT');
  assert.equal(sanitizeErrorType({ code: 'ENOENT' }), 'COMMAND_NOT_FOUND');
  assert.equal(sanitizeErrorType({ code: 'EACCES' }), 'ACCESS_DENIED');
  assert.equal(sanitizeErrorType(new Error('child')), 'CHILD_PROCESS_ERROR');
  assert.equal(sanitizeErrorType({ name: 'Custom Error!' }), 'Custom_Error_');
  assert.equal(sanitizeErrorType(null), 'UNKNOWN_ERROR');
});

test('COV-09 sanitized metadata and copy boundaries handle disposable fixtures only', async () => {
  const source = await fsp.mkdtemp(path.join(os.tmpdir(), 'wp141-copy-source-'));
  const destination = await fsp.mkdtemp(path.join(os.tmpdir(), 'wp141-copy-destination-'));
  try {
    await fsp.mkdir(path.join(source, 'src', 'nested'), { recursive: true });
    await fsp.mkdir(path.join(source, '.next'));
    await fsp.writeFile(path.join(source, 'src', 'nested', 'page.tsx'), 'export default null;\n');
    await fsp.writeFile(path.join(source, '.env.local'), 'DATABASE_URL=excluded\n');
    await fsp.writeFile(path.join(source, 'private-token.txt'), 'excluded\n');
    await fsp.writeFile(path.join(source, 'normal.txt'), 'copied\n');

    const stats = await copyTree(source, destination);
    assert.equal(stats.filesCopied, 2);
    assert.equal(stats.filesExcluded, 2);
    assert.equal(stats.directoriesExcluded, 1);
    assert.equal(stats.excludedByReason.dotenv, 1);
    assert.equal(stats.excludedByReason.private_or_secret_like, 1);
    assert.equal(fs.existsSync(path.join(destination, 'src', 'nested', 'page.tsx')), true);
    assert.equal(fs.existsSync(path.join(destination, '.next')), false);

    const metadata = await collectMetadata(source);
    assert.equal(metadata.files, 4);
    assert.equal(metadata.directories, 3);
    assert.equal(metadata.entries, 7);
    assert.equal(typeof metadata.digest, 'string');
    assert.equal(metadata.digest.length, 64);
    const missingMetadata = await collectMetadata(path.join(source, 'missing'));
    assert.deepEqual(missingMetadata, { files: 0, directories: 0, reparse: 0, entries: 0, bytes: 0, digest: expectDigest(missingMetadata.digest) });

    const markers = await markerSnapshot(source);
    assert.equal(markers.pass, false);
    await fsp.mkdir(path.join(source, '.next', 'server'), { recursive: true });
    for (const relativePath of [
      '.next/BUILD_ID',
      '.next/build-manifest.json',
      '.next/routes-manifest.json',
      '.next/server/app-paths-manifest.json',
    ]) await fsp.writeFile(path.join(source, relativePath), 'marker\n');
    assert.equal((await markerSnapshot(source)).pass, true);

    const jsonPath = path.join(source, 'receipt.json');
    await fsp.writeFile(jsonPath, JSON.stringify({ status: 'SAFE' }));
    assert.deepEqual(await readJson(jsonPath), { status: 'SAFE' });
    ensureNoRawFields({ nested: [{ status: 'SAFE' }] });
    assert.throws(() => ensureNoRawFields({ nested: { rawOutput: 'must not persist' } }), /UNSAFE_RECEIPT_FIELD/);
  } finally {
    await fsp.rm(source, { recursive: true, force: true });
    await fsp.rm(destination, { recursive: true, force: true });
  }
});

function expectDigest(value) {
  assert.equal(typeof value, 'string');
  assert.equal(value.length, 64);
  return value;
}
