import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CLASSIFICATIONS, classifyBuildResult, exclusionReason, metadataAggregate, safeResolve, sanitizeOutput } from "./wp139-isolated-next-build-runner.mjs";

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
  const output = sanitizeOutput("C:\\Users\\eden\\project\\file.ts https://example.invalid/x DATABASE_URL=postgresql://a:b@localhost/db");
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

function expectDigest(value) {
  assert.equal(typeof value, "string");
  assert.equal(value.length, 64);
  return value;
}
