import assert from "node:assert/strict";
import test from "node:test";
import { CLASSIFICATIONS, classifyDiagnostic, sanitizeDiagnosticText } from "./wp129-public-partner-server-diagnostic-runner.mjs";

test("classifies missing mirror input before process checks", () => {
  assert.equal(classifyDiagnostic({ mirror: { missing: ["package.json"], forbiddenCopied: [] }, junction: { ok: true }, resolution: { ok: true }, port: { ok: true }, lifecycle: { spawned: true }, readiness: {} }), CLASSIFICATIONS.MIRROR_INPUT_MISSING);
});

test("classifies a bad junction and module resolution fail closed", () => {
  assert.equal(classifyDiagnostic({ mirror: { missing: [], forbiddenCopied: [] }, junction: { ok: false }, resolution: { ok: true }, port: { ok: true }, lifecycle: { spawned: true }, readiness: {} }), CLASSIFICATIONS.NODE_MODULES_JUNCTION_FAILURE);
  assert.equal(classifyDiagnostic({ mirror: { missing: [], forbiddenCopied: [] }, junction: { ok: true }, resolution: { ok: false }, port: { ok: true }, lifecycle: { spawned: true }, readiness: {} }), CLASSIFICATIONS.MODULE_RESOLUTION_FAILURE);
});

test("distinguishes port and lifecycle failures", () => {
  assert.equal(classifyDiagnostic({ mirror: { missing: [], forbiddenCopied: [] }, junction: { ok: true }, resolution: { ok: true }, port: { ok: false }, lifecycle: { spawned: false }, readiness: {} }), CLASSIFICATIONS.PORT_ALLOCATION_FAILURE);
  assert.equal(classifyDiagnostic({ mirror: { missing: [], forbiddenCopied: [] }, junction: { ok: true }, resolution: { ok: true }, port: { ok: true }, lifecycle: { spawned: false, spawnError: "ENOENT" }, readiness: {} }), CLASSIFICATIONS.PROCESS_LIFECYCLE_FAILURE);
});

test("classifies an exited Next process only after runner predicates pass", () => {
  assert.equal(classifyDiagnostic({ mirror: { missing: [], forbiddenCopied: [] }, junction: { ok: true }, resolution: { ok: true }, port: { ok: true }, lifecycle: { spawned: true, exitBeforeReady: true }, readiness: { processExited: true } }), CLASSIFICATIONS.EXISTING_APP_OR_NEXT_BOUNDARY);
});

test("keeps readiness mismatch and unknown states fail-closed", () => {
  assert.equal(classifyDiagnostic({ mirror: { missing: [], forbiddenCopied: [] }, junction: { ok: true }, resolution: { ok: true }, port: { ok: true }, lifecycle: { spawned: true, exitBeforeReady: false }, readiness: { ok: false, processExited: false } }), CLASSIFICATIONS.READINESS_PROBE_MISMATCH);
  assert.equal(classifyDiagnostic({ mirror: { missing: [], forbiddenCopied: [] }, junction: { ok: true }, resolution: { ok: true }, port: { ok: true }, lifecycle: { spawned: true }, readiness: {} }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});

test("sanitizes diagnostics without persisting raw text", () => {
  const sanitized = sanitizeDiagnosticText("C:\\Users\\eden\\project\\.env.local FOO=bar https://example.test/x");
  assert.equal(sanitized.includes("C:\\Users"), false);
  assert.equal(sanitized.includes("bar"), false);
  assert.equal(sanitized.includes("example.test"), false);
});

test("COV-08 inspectMirror reports missing inputs and safe forbidden categories", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { inspectMirror } = await import("./wp129-public-partner-server-diagnostic-runner.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wp129-cov08-"));
  try {
    fs.mkdirSync(path.join(directory, "certs"), { recursive: true });
    fs.writeFileSync(path.join(directory, "certs", "fixture.pem"), "synthetic-certificate");
    fs.writeFileSync(path.join(directory, "fixture.sqlite"), "synthetic-database");
    const result = inspectMirror(directory);
    assert.equal(result.missing.includes("package.json"), true);
    assert.deepEqual(result.forbiddenCategories, { dotenv: 0, databaseFile: 1, certificate: 1 });
    assert.deepEqual(result.forbiddenCopied, ["certs/fixture.pem", "fixture.sqlite"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("COV-08 diagnostic precedence rejects forbidden mirror and readiness contradictions", () => {
  const base = { mirror: { missing: [], forbiddenCopied: [] }, junction: { ok: true }, resolution: { ok: true }, port: { ok: true }, lifecycle: { spawned: true, exitBeforeReady: false }, readiness: { ok: true, processExited: false } };
  assert.equal(classifyDiagnostic({ ...base, mirror: { missing: ["package.json"], forbiddenCopied: [] } }), CLASSIFICATIONS.MIRROR_INPUT_MISSING);
  assert.equal(classifyDiagnostic({ ...base, lifecycle: { spawned: false, spawnError: "EPIPE" } }), CLASSIFICATIONS.PROCESS_LIFECYCLE_FAILURE);
  assert.equal(classifyDiagnostic({ ...base, readiness: { ok: true }, lifecycle: { spawned: true, exitBeforeReady: false } }), CLASSIFICATIONS.READINESS_PROBE_MISMATCH);
  assert.equal(classifyDiagnostic({ ...base, readiness: {}, lifecycle: { spawned: true, exitBeforeReady: false } }), CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED);
});

test("COV-08 sanitizer handles null input and ANSI without leaking values", () => {
  assert.equal(sanitizeDiagnosticText(null), "");
  const sanitized = sanitizeDiagnosticText("\u001b[31mhttps://private.invalid/path\u001b[0m TOKEN_VALUE=synthetic");
  assert.equal(sanitized.includes("private.invalid"), false);
  assert.equal(sanitized.includes("synthetic"), false);
  assert.equal(sanitized.includes("<url>"), true);
});
