import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CLASSIFICATIONS,
  baselineReceipt,
  buildEnvironment,
  buildStats,
  classifyBuildResult,
  cleanupTemp,
  copyMirror,
  digestDirtyPath,
  exclusionReason,
  isSensitiveName,
  markerMetadata,
  metadataAggregate,
  outputSignals,
  safeResolve,
  sanitizeOutput,
  statusPath,
} from "./wp139-isolated-next-build-runner.mjs";

test("excludes dotenv, build, dependency, database and private-like paths", () => {
  assert.equal(exclusionReason(".env.local"), "dotenv");
  assert.equal(exclusionReason("src/.next/cache/file"), "excluded_directory");
  assert.equal(exclusionReason("node_modules/next/index.js"), "excluded_directory");
  assert.equal(exclusionReason("tmp/data.sqlite"), "excluded_directory");
  assert.equal(exclusionReason("certs/server.pem"), "private_or_secret_like");
  assert.equal(exclusionReason("src/app/page.tsx"), null);
});

test("safeResolve rejects traversal and accepts descendants", () => {
  const base = path.join(os.tmpdir(), "wp139-safe-resolve");
  assert.equal(safeResolve(base, "../outside"), null);
  assert.equal(safeResolve(base, "child/file.txt"), path.join(base, "child", "file.txt"));
});

test("metadata aggregate is deterministic and metadata-only", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wp139-meta-"));
  try {
    fs.mkdirSync(path.join(directory, "nested"));
    fs.writeFileSync(path.join(directory, "a.txt"), "alpha");
    fs.writeFileSync(path.join(directory, "nested", "b.txt"), "beta");
    const first = metadataAggregate(directory);
    const second = metadataAggregate(directory);
    assert.deepEqual(first, second);
    assert.equal(first.files, 2);
    assert.equal(first.directories, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("sanitizer removes absolute paths, URLs, database URLs and env values", () => {
  const output = sanitizeOutput("C:\\Users\\eden\\project\\file.ts https://example.invalid/x DATABASE_URL=" + ["postgres", "ql://"].join("") + "a:b@localhost/db");
  assert.equal(output.includes("C:\\Users"), false);
  assert.equal(output.includes("https://"), false);
  assert.equal(output.includes("postgresql://"), false);
  assert.equal(output.includes("a:b@"), false);
});

test("classifies a successful isolated build only with all preservation gates", () => {
  assert.equal(classifyBuildResult({ exitCode: 0, markersPass: true, repositoryNextUnchanged: true, forbiddenCopiedCount: 0, cleanupPass: true, workspacePreserved: true }), CLASSIFICATIONS.PASS);
});

test("classifies a non-zero build as exact no-go when preservation is intact", () => {
  assert.equal(classifyBuildResult({ exitCode: 1, markersPass: false, repositoryNextUnchanged: true, forbiddenCopiedCount: 0, cleanupPass: true, workspacePreserved: true }), CLASSIFICATIONS.EXACT_NO_GO);
});

test("fails closed on repository drift, forbidden copies or cleanup failure", () => {
  const base = { exitCode: 1, markersPass: false, repositoryNextUnchanged: true, forbiddenCopiedCount: 0, cleanupPass: true, workspacePreserved: true };
  assert.equal(classifyBuildResult({ ...base, repositoryNextUnchanged: false }), CLASSIFICATIONS.UNKNOWN);
  assert.equal(classifyBuildResult({ ...base, forbiddenCopiedCount: 1 }), CLASSIFICATIONS.UNKNOWN);
  assert.equal(classifyBuildResult({ ...base, cleanupPass: false }), CLASSIFICATIONS.UNKNOWN);
  assert.equal(classifyBuildResult({ ...base, workspacePreserved: false }), CLASSIFICATIONS.UNKNOWN);
});

test("does not accept impossible mixed result", () => {
  assert.equal(classifyBuildResult({ exitCode: 0, markersPass: false, repositoryNextUnchanged: true, forbiddenCopiedCount: 0, cleanupPass: true, workspacePreserved: true }), CLASSIFICATIONS.EXACT_NO_GO);
});

test("COV-08 exclusion precedence is stable for nested sensitive paths", () => {
  assert.equal(exclusionReason("nested/.env.production/file.txt"), "dotenv");
  assert.equal(exclusionReason("nested/node_modules/cache.js"), "excluded_directory");
  assert.equal(exclusionReason("nested/data.sqlite3"), "database_file");
  assert.equal(exclusionReason("nested/private-token.txt"), "private_or_secret_like");
  assert.equal(exclusionReason("nested/normal.txt"), null);
});

test("COV-08 metadata aggregate handles missing directories and reparse entries", () => {
  const missing = metadataAggregate(path.join(os.tmpdir(), "wp139-cov08-missing", "not-created"));
  assert.deepEqual(missing, { files: 0, directories: 0, reparse: 0, entries: 0, bytes: 0, digest: expectDigest(missing.digest) });

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wp139-cov08-meta-"));
  try {
    fs.writeFileSync(path.join(directory, "file.txt"), "fixture");
    fs.symlinkSync(path.join(directory, "file.txt"), path.join(directory, "link.txt"));
    const result = metadataAggregate(directory);
    assert.equal(result.files, 1);
    assert.equal(result.reparse, 1);
    assert.equal(result.entries, 2);
    assert.equal(typeof result.digest, "string");
    assert.equal(result.digest.length, 64);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("COV-08 safeResolve keeps the base boundary exact", () => {
  const base = path.join(os.tmpdir(), "wp139-cov08-boundary");
  assert.equal(safeResolve(base, "."), path.resolve(base));
  assert.equal(safeResolve(base, "child"), path.join(path.resolve(base), "child"));
  assert.equal(safeResolve(base, ".."), null);
  assert.equal(safeResolve(base, "child",), path.join(path.resolve(base), "child"));
});

test("COV-09 sensitive names and status paths remain deterministic", () => {
  assert.equal(isSensitiveName(".env.local"), true);
  assert.equal(isSensitiveName("database.sqlite3"), true);
  assert.equal(isSensitiveName("private-key.pem"), true);
  assert.equal(isSensitiveName("normal.txt"), false);
  assert.equal(statusPath("old.txt -> new.txt"), "new.txt");
  assert.equal(statusPath("src/app/page.tsx"), "src/app/page.tsx");
});

test("COV-09 output signal attribution covers each supported diagnostic family", () => {
  const signals = outputSignals("network module not found TypeScript missing required configuration route failed");
  assert.deepEqual(signals, {
    network: true,
    moduleResolution: true,
    typecheck: true,
    configuration: true,
    route: true,
    genericError: true,
  });
  assert.deepEqual(outputSignals("ready"), {
    network: false,
    moduleResolution: false,
    typecheck: false,
    configuration: false,
    route: false,
    genericError: false,
  });
});

test("COV-09 mirror copy excludes sensitive inputs and records exact counters", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "wp139-copy-source-"));
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), "wp139-copy-destination-"));
  try {
    fs.mkdirSync(path.join(source, "src"));
    fs.mkdirSync(path.join(source, ".next"));
    fs.mkdirSync(path.join(source, "node_modules"));
    fs.writeFileSync(path.join(source, "src", "page.tsx"), "export default null;\n");
    fs.writeFileSync(path.join(source, ".env.local"), "DATABASE_URL=must-not-copy\n");
    fs.writeFileSync(path.join(source, "database.sqlite"), "must-not-copy\n");
    fs.writeFileSync(path.join(source, "private-key.pem"), "must-not-copy\n");
    fs.writeFileSync(path.join(source, "normal.txt"), "copy\n");

    const stats = buildStats();
    copyMirror(source, destination, stats);

    assert.equal(stats.filesCopied, 2);
    assert.equal(stats.directoriesExcluded, 2);
    assert.equal(stats.filesExcluded, 3);
    assert.equal(stats.excludedByReason.dotenv, 1);
    assert.equal(stats.excludedByReason.database_file, 1);
    assert.equal(stats.excludedByReason.private_or_secret_like, 1);
    assert.equal(fs.existsSync(path.join(destination, "src", "page.tsx")), true);
    assert.equal(fs.existsSync(path.join(destination, "normal.txt")), true);
    assert.equal(fs.existsSync(path.join(destination, ".env.local")), false);
    assert.equal(fs.existsSync(path.join(destination, ".next")), false);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  }
});

test("COV-09 build environment is synthetic and scoped to a disposable root", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp139-env-"));
  try {
    const environment = buildEnvironment(tempRoot);
    assert.equal(environment.NODE_ENV, "production");
    assert.equal(environment.CI, "true");
    assert.equal(environment.DATABASE_URL.startsWith("postgresql://synthetic:"), true);
    assert.equal(environment.TEMP, path.join(tempRoot, "runtime-tmp"));
    assert.equal(environment.HOME, path.join(tempRoot, "runtime-home"));
    assert.equal(fs.existsSync(environment.TEMP), true);
    assert.equal(fs.existsSync(environment.HOME), true);
    assert.equal(fs.existsSync(environment.NPM_CONFIG_CACHE), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("COV-09 marker metadata distinguishes incomplete and valid Next markers", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp139-markers-"));
  try {
    assert.deepEqual(markerMetadata(tempRoot), {
      markers: [
        { relativePath: ".next/BUILD_ID", exists: false, size: null, type: null },
        { relativePath: ".next/build-manifest.json", exists: false, size: null, type: null },
        { relativePath: ".next/routes-manifest.json", exists: false, size: null, type: null },
        { relativePath: ".next/server/app-paths-manifest.json", exists: false, size: null, type: null },
      ],
      pass: false,
      nextIsReparse: false,
    });
    fs.mkdirSync(path.join(tempRoot, ".next", "server"), { recursive: true });
    for (const relativePath of [
      ".next/BUILD_ID",
      ".next/build-manifest.json",
      ".next/routes-manifest.json",
      ".next/server/app-paths-manifest.json",
    ]) fs.writeFileSync(path.join(tempRoot, relativePath), "marker\n");
    const result = markerMetadata(tempRoot);
    assert.equal(result.pass, true);
    assert.equal(result.nextIsReparse, false);
    assert.equal(result.markers.every((marker) => marker.type === "file" && marker.size > 0), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("COV-09 cleanup, dirty digests and baseline receipt are fail-closed", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp139-cleanup-"));
  assert.equal(cleanupTemp(tempRoot), true);
  assert.equal(cleanupTemp(os.tmpdir()), false);
  assert.deepEqual(digestDirtyPath(".env.local"), { pathOnly: true });
  assert.deepEqual(digestDirtyPath("definitely-missing-wp139-file"), { missing: true });
  const packageDigest = digestDirtyPath("package.json");
  assert.equal(typeof packageDigest.sha256, "string");
  assert.equal(packageDigest.sha256.length, 64);
  const receipt = baselineReceipt();
  assert.equal(receipt.schemaVersion, "wp139-isolated-next-build/v1");
  assert.equal(receipt.classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(receipt.sideEffects.productionOperations, 0);
  assert.equal(receipt.sanitized, true);
});

function expectDigest(value) {
  assert.equal(typeof value, "string");
  assert.equal(value.length, 64);
  return value;
}
