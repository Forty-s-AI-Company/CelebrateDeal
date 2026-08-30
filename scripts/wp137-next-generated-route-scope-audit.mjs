import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, ".ai-team", "reports", "wp137-next-generated-route-scope-receipt.json");
const routePath = "src/app/api/cloudflare/stream-webhook/route.ts";
const routeUrl = "/api/cloudflare/stream-webhook";
const requiredInputs = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", routePath];
const expectedRouteDigest = "7b9d506c01c9c19a7d76eaccf81b1d362e0ea8d1a0e78b1f0f869774a8bf04b2";
const ts = createRequire(import.meta.url)("typescript");

export const CLASSIFICATIONS = Object.freeze({
  TARGET_ROUTE_CONTRACT_MAPPED: "TARGET_ROUTE_CONTRACT_MAPPED",
  TARGET_ROUTE_OMITTED_EXACT_NO_GO: "TARGET_ROUTE_OMITTED_EXACT_NO_GO",
  UNKNOWN_FAIL_CLOSED: "UNKNOWN_FAIL_CLOSED",
  PREFLIGHT_FAILURE: "PREFLIGHT_FAILURE",
});

function run(command, args, environment, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function digest(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function sanitizeText(value) {
  return String(value ?? "")
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/[A-Za-z]:\\[^\r\n\s'"`]+/g, "<path>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, "<env>=<value>")
    .replaceAll(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "<database-url>")
    .replaceAll(/https?:\/\/[^\s]+/gi, "<url>");
}

function isForbiddenPath(relative) {
  const normalized = relative.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  return segments.some((segment) => segment.startsWith(".env"))
    || normalized.startsWith(".next/")
    || segments.some((segment) => /(?:secret|credential|token|cookie|private)/i.test(segment))
    || /\.(?:db|sqlite|sqlite3|pem|key|crt)$/i.test(normalized);
}

function mirrorFilter(source) {
  const relative = path.relative(root, source).replaceAll("\\", "/");
  if (!relative) return true;
  if ([".git", ".next", "node_modules", ".ai-team"].includes(relative)) return false;
  return !isForbiddenPath(relative);
}

function sourceIntegrity() {
  return Object.fromEntries(requiredInputs.map((relative) => [relative, digest(path.join(root, relative))]));
}

function dirtyInventory() {
  const output = run("git", ["status", "--porcelain=v1"], process.env).stdout;
  return { count: output ? output.split(/\r?\n/).filter(Boolean).length : 0, fingerprint: crypto.createHash("sha256").update(output).digest("hex") };
}

function inspectMirror(tempRoot) {
  const missing = requiredInputs.filter((relative) => !fs.existsSync(path.join(tempRoot, relative)));
  const forbiddenCopied = [];
  for (const entry of fs.readdirSync(tempRoot, { recursive: true })) {
    const relative = String(entry).replaceAll("\\", "/");
    if (relative === "node_modules" || relative.startsWith("node_modules/")) continue;
    if (isForbiddenPath(relative)) forbiddenCopied.push(relative);
  }
  return { missing, forbiddenCopied: forbiddenCopied.sort() };
}

function parseSourceExports(sourceText) {
  const sourceFile = ts.createSourceFile(routePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const symbols = [];
  const exported = (node) => Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && exported(statement) && statement.name) symbols.push({ name: statement.name.text, kind: "function", startLine: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1, endLine: sourceFile.getLineAndCharacterOfPosition(statement.end).line + 1 });
    else if (ts.isVariableStatement(statement) && exported(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) symbols.push({ name: declaration.name.text, kind: "const", startLine: sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1, endLine: sourceFile.getLineAndCharacterOfPosition(statement.end).line + 1 });
  }
  return symbols;
}

function hunkOverlap(symbol) {
  const status = run("git", ["status", "--short", "--", routePath], process.env).stdout.trim();
  const diff = run("git", ["diff", "--unified=0", "--", routePath], process.env).stdout;
  const ranges = [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({ start: Number(match[1]), count: Number(match[2] ?? 1) }));
  const overlap = ranges.some((range) => symbol.startLine <= range.start + Math.max(range.count, 1) - 1 && symbol.endLine >= range.start);
  return { ownership: status.startsWith("??") ? "UNTRACKED" : status ? "PRESERVE_ONLY_DIRTY" : "TRACKED_CLEAN", statusCode: status.slice(0, 2) || "", dirtyHunkCount: ranges.length, symbolSpanOverlapsDirtyHunk: overlap };
}

function extractGeneratedReferences(tempRoot) {
  const typesRoot = path.join(tempRoot, ".next", "types");
  const files = [];
  if (!fs.existsSync(typesRoot)) return { files, targetReferences: [], inventoryComplete: false };
  for (const entry of fs.readdirSync(typesRoot, { recursive: true })) {
    const relative = String(entry).replaceAll("\\", "/");
    if (!/\.(?:ts|d\.ts)$/u.test(relative)) continue;
    const absolute = path.join(typesRoot, relative);
    if (!fs.statSync(absolute).isFile()) continue;
    const text = fs.readFileSync(absolute, "utf8");
    const targetHit = text.includes("stream-webhook") || text.includes(routeUrl);
    files.push({ path: `.next/types/${relative}`, digest: digest(absolute), targetHit, routeHandlerConfig: text.includes("RouteHandlerConfig") });
  }
  const targetReferences = files.filter((file) => file.targetHit);
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), targetReferences, inventoryComplete: files.length > 0 };
}

export function mapGeneratedRouteContract(generatedFiles, sourceExports) {
  const validator = generatedFiles.find((file) => file.path.endsWith("validator.ts") && file.targetHit && file.routeHandlerConfig);
  if (!validator) return { mapped: false, reason: "TARGET_VALIDATOR_REFERENCE_NOT_FOUND", allowedExports: [], candidate: null };
  const allowedExports = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const disallowed = sourceExports.filter((symbol) => !allowedExports.includes(symbol.name));
  return { mapped: disallowed.length === 1, reason: disallowed.length === 1 ? "EXACT_ONE_DISALLOWED_EXPORT" : "AMBIGUOUS_EXPORT_SET", allowedExports, candidate: disallowed.length === 1 ? disallowed[0] : null, validatorPath: validator.path };
}

export function detectDisallowedExports(sourceExports, allowedExports) {
  const allowed = new Set(allowedExports);
  return sourceExports.filter((symbol) => !allowed.has(symbol.name));
}

export function classifyResult({ generated, mapping, ownership }) {
  if (!generated.inventoryComplete) return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  if (!generated.targetReferences.length) return CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO;
  if (!mapping.mapped || !mapping.candidate || !ownership) return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  if (ownership.ownership === "PRESERVE_ONLY_DIRTY" && ownership.symbolSpanOverlapsDirtyHunk) return CLASSIFICATIONS.TARGET_ROUTE_CONTRACT_MAPPED;
  if (ownership.ownership === "TRACKED_CLEAN" && !ownership.symbolSpanOverlapsDirtyHunk) return CLASSIFICATIONS.TARGET_ROUTE_CONTRACT_MAPPED;
  return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
}

function environment(tempRoot) {
  return {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "",
    ComSpec: process.env.ComSpec ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    TEMP: path.join(tempRoot, "tmp"),
    TMP: path.join(tempRoot, "tmp"),
    HOME: path.join(tempRoot, "home"),
    USERPROFILE: path.join(tempRoot, "home"),
    NODE_ENV: "production",
    CI: "true",
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp137_test",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp137_test",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:32137",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    CSRF_SECRET: "wp137-local-csrf-synthetic-value",
    JOB_SECRET: "wp137-local-job-synthetic-value",
    NEXT_TELEMETRY_DISABLED: "1",
    SENTRY_DISABLE_AUTO_UPLOAD: "true",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
}

function cleanupTemp(tempRoot) {
  const base = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  if (!resolved.startsWith(`${base}${path.sep}`)) throw new Error("TEMP_ROOT_OUTSIDE_OS_TEMP");
  const junction = path.join(resolved, "node_modules");
  if (fs.existsSync(junction)) fs.rmSync(junction, { recursive: false, force: true });
  for (let attempt = 0; attempt < 3 && fs.existsSync(resolved); attempt += 1) {
    try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); } catch { /* retry */ }
  }
  if (fs.existsSync(resolved) && process.platform === "win32") run("cmd.exe", ["/d", "/c", "rmdir", "/s", "/q", resolved], process.env);
  return !fs.existsSync(resolved);
}

export async function main() {
  const startedAt = new Date().toISOString();
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp137-${runId}`);
  const receipt = {
    workPackage: "WP-137",
    status: "BLOCKED_OR_FAILED",
    classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
    scope: "LOCAL_TEMP_NEXT_GENERATED_ROUTE_SCOPE_AUDIT",
    preflight: null,
    typegen: { attempts: 0, exitCode: null, outputFingerprint: null, rawOutputPersisted: false },
    mirror: null,
    generatedInventory: null,
    routeMapping: null,
    sourceExports: [],
    ownership: null,
    sourceIntegrity: { before: null, after: null, unchanged: false },
    dirtyInventory: { before: null, after: null, unchanged: false },
    cleanup: { mirror: "NOT_STARTED" },
    stagedIndexEmpty: false,
    serverLaunches: 0,
    browserRuns: 0,
    externalOperations: false,
    databaseOperations: false,
    dotenvContentRead: false,
    sourceSnippetsPersisted: false,
    scoreImpact: { CAT06_before: 7.0, CAT06_after: 7.0, CAT09_before: 6.5, CAT09_after: 6.5, total_before: 71.0, total_after: 71.0 },
    startedAt,
    finishedAt: null,
  };
  let tempCreated = false;
  try {
    const preflight = { inputsPresent: requiredInputs.every((relative) => fs.existsSync(path.join(root, relative))), sourceIntegrity: sourceIntegrity(), dirtyInventory: dirtyInventory(), stagedIndexEmpty: !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim(), nextVersion: createRequire(import.meta.url)("next/package.json").version };
    receipt.preflight = preflight;
    receipt.sourceIntegrity.before = preflight.sourceIntegrity;
    receipt.dirtyInventory.before = preflight.dirtyInventory;
    receipt.stagedIndexEmpty = preflight.stagedIndexEmpty;
    if (!preflight.inputsPresent || !preflight.stagedIndexEmpty || preflight.sourceIntegrity[routePath] !== expectedRouteDigest) receipt.classification = CLASSIFICATIONS.PREFLIGHT_FAILURE;
    else {
      fs.mkdirSync(tempRoot, { recursive: true });
      tempCreated = true;
      fs.cpSync(root, tempRoot, { recursive: true, filter: mirrorFilter });
      fs.symlinkSync(path.join(root, "node_modules"), path.join(tempRoot, "node_modules"), "junction");
      fs.mkdirSync(path.join(tempRoot, "tmp"), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, "home"), { recursive: true });
      const mirror = inspectMirror(tempRoot);
      receipt.mirror = { missing: mirror.missing, forbiddenCopied: mirror.forbiddenCopied, forbiddenCopiedCount: mirror.forbiddenCopied.length };
      if (mirror.missing.length === 0 && mirror.forbiddenCopied.length === 0) {
        const env = environment(tempRoot);
        const nextBin = path.join(tempRoot, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
        const result = run(nextBin, ["typegen", tempRoot], env, tempRoot);
        receipt.typegen.attempts = 1;
        receipt.typegen.exitCode = result.exitCode;
        receipt.typegen.outputFingerprint = crypto.createHash("sha256").update(sanitizeText(`${result.stdout}\n${result.stderr}`)).digest("hex");
        const generated = extractGeneratedReferences(tempRoot);
        receipt.generatedInventory = generated;
        if (result.exitCode === 0 && generated.inventoryComplete) {
          const sourceText = fs.readFileSync(path.join(root, routePath), "utf8");
          receipt.sourceExports = parseSourceExports(sourceText);
          receipt.routeMapping = mapGeneratedRouteContract(generated, receipt.sourceExports);
          const candidate = receipt.routeMapping.candidate;
          receipt.ownership = candidate ? hunkOverlap(candidate) : null;
          receipt.classification = classifyResult({ generated, mapping: receipt.routeMapping, ownership: receipt.ownership });
        } else receipt.classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
      }
    }
  } catch (error) {
    receipt.failureCode = error?.code ?? "WP137_RUNNER_EXCEPTION";
  } finally {
    if (tempCreated) {
      try { receipt.cleanup.mirror = cleanupTemp(tempRoot) ? "PASS" : "FAIL"; } catch { receipt.cleanup.mirror = "FAIL"; }
    } else receipt.cleanup.mirror = "NOT_REQUIRED";
    receipt.sourceIntegrity.after = sourceIntegrity();
    receipt.sourceIntegrity.unchanged = JSON.stringify(receipt.sourceIntegrity.before) === JSON.stringify(receipt.sourceIntegrity.after);
    receipt.dirtyInventory.after = dirtyInventory();
    receipt.dirtyInventory.unchanged = JSON.stringify(receipt.dirtyInventory.before) === JSON.stringify(receipt.dirtyInventory.after);
    receipt.stagedIndexEmpty = !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
    receipt.workspacePreserved = receipt.sourceIntegrity.unchanged && receipt.dirtyInventory.unchanged && receipt.stagedIndexEmpty;
    receipt.finishedAt = new Date().toISOString();
    if (!receipt.workspacePreserved || receipt.cleanup.mirror === "FAIL") receipt.classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
    receipt.status = receipt.classification === CLASSIFICATIONS.TARGET_ROUTE_CONTRACT_MAPPED || receipt.classification === CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO ? "PASS" : "BLOCKED_OR_FAILED";
    fs.writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
