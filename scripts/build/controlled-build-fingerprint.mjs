import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createControlledChildEnvironment,
  createNoEnvMirror,
  loadControlledEnvironment,
} from "./controlled-production-build.mjs";
import { spawn } from "node:child_process";

const MAX_CAPTURE_BYTES = 64 * 1024;
const defaultReceiptPath = join(process.cwd(), ".ai-team", "reports", "wp99-controlled-build-fingerprint.json");

function normalizeSourceFile(candidate) {
  if (typeof candidate !== "string") return null;
  const normalized = candidate.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.includes("..") || normalized.includes("?") || normalized.includes("#")) {
    return null;
  }
  const withoutLocation = normalized.replace(/:\d+(?::\d+)?$/, "");
  if (!/^(?:src|app|pages|components|lib|scripts)\/[A-Za-z0-9_./-]+\.(?:[cm]?[jt]sx?|json)$/.test(withoutLocation)) {
    return null;
  }
  return withoutLocation;
}

function firstSourceFile(output) {
  const matcher = /(?:^|\n)\s*(?:\.\/)?((?:src|app|pages|components|lib|scripts)[\\/][^\s]+)/gm;
  for (const match of output.matchAll(matcher)) {
    const sourceFile = normalizeSourceFile(match[1]);
    if (sourceFile) return sourceFile;
  }
  return "<none>";
}

function fixedErrorCode(output) {
  const typeScriptCode = /\bTS(\d{4,5})\b/.exec(output);
  if (typeScriptCode?.[1]) return `TS_${typeScriptCode[1]}`;
  if (/module not found/i.test(output)) return "WEBPACK_MODULE_NOT_FOUND";
  if (/type error/i.test(output)) return "TYPESCRIPT_TYPE_ERROR";
  if (/eslint/i.test(output)) return "ESLINT_ERROR";
  return "WEBPACK_COMPILE_ERROR";
}

export function createFailureFingerprint({ output, exitCode, category = "SOURCE_QUALITY_FAILURE" }) {
  const sourceFile = firstSourceFile(output);
  const errorCode = fixedErrorCode(output);
  const owner = sourceFile === "<none>" ? "UNRESOLVED" : "REPOSITORY_SOURCE";
  return {
    category,
    error_code: errorCode,
    source_file: sourceFile,
    failure_fingerprint: `v1|${category}|${errorCode}|${sourceFile}|exit=${exitCode}`,
    owner,
  };
}

export function captureBoundedChild({ executable, args, cwd, environment, maxBytes = MAX_CAPTURE_BYTES }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let captured = "";
    let capturedBytes = 0;
    let truncated = false;
    const absorb = (chunk) => {
      if (capturedBytes >= maxBytes) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      const available = maxBytes - capturedBytes;
      const bounded = Buffer.byteLength(text, "utf8") <= available
        ? text
        : Buffer.from(text, "utf8").subarray(0, available).toString("utf8");
      captured += bounded;
      capturedBytes += Buffer.byteLength(bounded, "utf8");
      if (bounded.length !== text.length) truncated = true;
    };
    child.stdout.on("data", absorb);
    child.stderr.on("data", absorb);
    child.once("error", rejectRun);
    child.once("close", (code, signal) => resolveRun({
      exitCode: code ?? 1,
      signal,
      output: captured,
      outputTruncated: truncated,
    }));
  });
}

export async function runSingleFingerprintBuild({
  sourceRoot = process.cwd(),
  loadEnvironment = loadControlledEnvironment,
  createMirror = createNoEnvMirror,
  runChild = captureBoundedChild,
  cleanupMirror = (path) => rm(path, { recursive: true, force: true }),
  attempts = { count: 0 },
} = {}) {
  if (attempts.count !== 0) throw new Error("controlled build attempt limit reached");
  attempts.count += 1;
  const controlledEnvironment = await loadEnvironment();
  const environment = createControlledChildEnvironment(controlledEnvironment);
  const mirrorRoot = await createMirror(sourceRoot);
  try {
    const result = await runChild({
      executable: process.execPath,
      args: [join(mirrorRoot, "node_modules", "next", "dist", "bin", "next"), "build", "--webpack"],
      cwd: mirrorRoot,
      environment,
    });
    const fingerprint = result.exitCode === 0
      ? null
      : createFailureFingerprint({ output: result.output, exitCode: result.exitCode });
    return {
      build_kind: "controlled_no_env_webpack",
      attempt_count: attempts.count,
      exit_code: result.exitCode,
      category: fingerprint?.category ?? "BUILD_SUCCEEDED",
      error_code: fingerprint?.error_code ?? "NOT_APPLICABLE",
      source_file: fingerprint?.source_file ?? "<none>",
      failure_fingerprint: fingerprint?.failure_fingerprint ?? "<none>",
      owner: fingerprint?.owner ?? "NOT_APPLICABLE",
      raw_output_saved: false,
      output_truncated: result.outputTruncated,
      mirror_cleanup: "PENDING",
    };
  } finally {
    await cleanupMirror(mirrorRoot);
  }
}

export async function writeSanitizedEvidence(receipt, receiptPath = defaultReceiptPath) {
  const allowedKeys = new Set([
    "schema_version",
    "build_kind",
    "attempt_count",
    "exit_code",
    "category",
    "error_code",
    "source_file",
    "failure_fingerprint",
    "owner",
    "raw_output_saved",
    "output_truncated",
    "mirror_cleanup",
  ]);
  const evidence = Object.fromEntries(Object.entries({ schema_version: 1, ...receipt })
    .filter(([key]) => allowedKeys.has(key)));
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return evidence;
}

async function main() {
  try {
    const result = await runSingleFingerprintBuild();
    result.mirror_cleanup = "PASS";
    await writeSanitizedEvidence(result);
    console.log(result.exit_code === 0 ? "controlled fingerprint build: PASS" : "controlled fingerprint build: FAIL");
    process.exitCode = result.exit_code;
  } catch {
    await writeSanitizedEvidence({
      build_kind: "controlled_no_env_webpack",
      attempt_count: 0,
      exit_code: 1,
      category: "DIAGNOSTIC_HARNESS_FAILURE",
      error_code: "HARNESS_BLOCKED",
      source_file: "<none>",
      failure_fingerprint: "v1|DIAGNOSTIC_HARNESS_FAILURE|HARNESS_BLOCKED|<none>|exit=1",
      owner: "DIAGNOSTIC_HARNESS",
      raw_output_saved: false,
      output_truncated: false,
      mirror_cleanup: "NOT_CONFIRMED",
    });
    console.error("controlled fingerprint build: BLOCKED");
    process.exitCode = 1;
  }
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("/controlled-build-fingerprint.mjs")) {
  await main();
}
