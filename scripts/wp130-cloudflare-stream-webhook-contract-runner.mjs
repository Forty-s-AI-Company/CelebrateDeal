import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const manifestPath = "scripts/wp130-cloudflare-stream-webhook-contract-manifest.json";
const manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
const receiptPath = ".ai-team/reports/wp130-cloudflare-stream-webhook-contract-receipt.json";
const sourcePaths = [manifest.source_route, ...manifest.read_only_imports];
const ownedPaths = new Set(manifest.owned_paths);
const forbiddenSegment = /(^|[\\/])\.env(?:\.|$)/i;

function sha256File(relativePath) {
  const value = readFileSync(join(root, relativePath));
  return createHash("sha256").update(value).digest("hex");
}

function command(file, args, env = {}) {
  const result = spawnSync(file, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      CI: "1",
      NPM_CONFIG_OFFLINE: "true",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=wp130",
      DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_ci?schema=wp130",
      ...env,
    },
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const summary = lines.filter((line) => /(?:pass|fail|skip|test|error|warning|exit)/i.test(line)).slice(-8);
  return {
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    outputFingerprint: createHash("sha256").update(output).digest("hex"),
    sanitizedSummary: summary.join(" ").replace(/(?:secret|token|password|cookie|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]"),
  };
}

function git(args) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).stdout ?? "";
}

function dirtyPaths() {
  const output = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  return output.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).replaceAll("\\", "/"));
}

function preserveInventory() {
  return dirtyPaths().filter((path) => !ownedPaths.has(path)).sort();
}

function safePathPreflight() {
  const paths = dirtyPaths();
  const envNames = paths.filter((path) => forbiddenSegment.test(path));
  if (envNames.length) throw new Error("Sensitive .env* dirty path detected; stopped before content read.");
  for (const path of sourcePaths) {
    if (!existsSync(join(root, path))) throw new Error(`Missing read-only source input: ${path}`);
  }
  const requiredOwnedInputs = manifest.owned_paths.filter((path) => ![receiptPath, "docs/ai-team/evidence/wp-130-cloudflare-stream-webhook-contract.md"].includes(path));
  for (const path of requiredOwnedInputs) {
    if (!existsSync(join(root, path))) throw new Error(`Missing WP-130 owned input: ${path}`);
  }
  return { dirtyCount: paths.length, envPathCount: envNames.length };
}

safePathPreflight();
const before = preserveInventory();
const sourceDigestsBefore = Object.fromEntries(sourcePaths.map((path) => [path, sha256File(path)]));
const exportSource = readFileSync(join(root, manifest.source_route), "utf8");
const expectedExportsPresent = manifest.expected_exports.every((name) => new RegExp(`export(?: function| const)\\s+${name}\\b`).test(exportSource));
const commands = {};
let status = "PASS";
let failure = null;

try {
  commands.targetedTests = command("node", ["node_modules/vitest/vitest.mjs", "run", "tests/unit/wp130-cloudflare-stream-webhook-contract.test.ts", "--reporter=dot"]);
  commands.scopedEslint = command("node", ["node_modules/eslint/bin/eslint.js", "tests/unit/wp130-cloudflare-stream-webhook-contract.test.ts"]);
  commands.typecheck = command("node", ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"]);
  if (commands.targetedTests.exitCode !== 0) throw new Error("WP-130 targeted contract tests failed.");
  if (commands.scopedEslint.exitCode !== 0) throw new Error("WP-130 scoped ESLint failed.");
  if (commands.typecheck.exitCode !== 0) throw new Error("TypeScript no-emit failed.");
} catch (error) {
  status = "BLOCKED_OR_FAILED";
  failure = error instanceof Error ? error.message : String(error);
}

const sourceDigestsAfter = Object.fromEntries(sourcePaths.map((path) => [path, sha256File(path)]));
const after = preserveInventory();
const stagedEmpty = git(["diff", "--cached", "--name-only"]).trim() === "";
const receipt = {
  schema_version: "wp130-cloudflare-stream-webhook-contract-receipt/v1",
  work_package: "WP-130",
  status,
  failure,
  contract: {
    expected_exports: manifest.expected_exports,
    expected_exports_present: expectedExportsPresent,
    source_paths: sourcePaths,
    source_digests_before: sourceDigestsBefore,
    source_digests_after: sourceDigestsAfter,
    source_unchanged: JSON.stringify(sourceDigestsBefore) === JSON.stringify(sourceDigestsAfter),
  },
  commands,
  ownership: {
    preserve_only_unchanged: JSON.stringify(before) === JSON.stringify(after),
    preserve_count_before: before.length,
    preserve_count_after: after.length,
    staged_index_empty: stagedEmpty,
    owned_paths: manifest.owned_paths,
  },
  safety: {
    raw_output_persisted: false,
    raw_payload_persisted: false,
    secret_or_signature_persisted: false,
    dotenv_content_read: false,
    network: false,
    database: false,
    provider: false,
    deployment: false,
    production: false,
  },
  score_impact: { CAT01_before: 7.0, CAT01_after: 7.0, total_before: 70.5, total_after: 70.5 },
};

mkdirSync(join(root, ".ai-team/reports"), { recursive: true });
writeFileSync(join(root, receiptPath), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  workPackage: "WP-130",
  status,
  failure,
  expectedExportsPresent,
  sourceUnchanged: receipt.contract.source_unchanged,
  preserveOnlyUnchanged: receipt.ownership.preserve_only_unchanged,
  stagedIndexEmpty: stagedEmpty,
  targetedTestsExitCode: commands.targetedTests?.exitCode ?? null,
  eslintExitCode: commands.scopedEslint?.exitCode ?? null,
  typecheckExitCode: commands.typecheck?.exitCode ?? null,
  receipt: receiptPath,
}, null, 2));

process.exitCode = status === "PASS" ? 0 : 1;
