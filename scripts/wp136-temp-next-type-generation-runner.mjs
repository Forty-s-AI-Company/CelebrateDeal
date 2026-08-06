import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, ".ai-team", "reports", "wp136-temp-next-type-generation-receipt.json");
const routePath = "src/app/api/cloudflare/stream-webhook/route.ts";
const generatedValidatorPath = ".next/types/validator.ts";
const generatedRoutesPath = ".next/types/routes.d.ts";
const requiredInputs = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", routePath];
const expectedRouteDigest = "7b9d506c01c9c19a7d76eaccf81b1d362e0ea8d1a0e78b1f0f869774a8bf04b2";
const expectedGeneratedBoundary = ".next/types/app/api/cloudflare/stream-webhook/route.ts";

const ts = createRequire(import.meta.url)("typescript");

export const CLASSIFICATIONS = Object.freeze({
  CLEAN_SEPARABLE_CANDIDATE: "CLEAN_SEPARABLE_CANDIDATE",
  EXACT_PRESERVE_ONLY_NO_GO: "EXACT_PRESERVE_ONLY_NO_GO",
  GENERATED_CONTRACT_SCOPE_MISMATCH: "GENERATED_CONTRACT_SCOPE_MISMATCH",
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

export function sanitizeText(value) {
  return String(value ?? "")
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/[A-Za-z]:\\[^\r\n\s'"`]+/g, "<path>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, "<env>=<value>")
    .replaceAll(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "<database-url>")
    .replaceAll(/https?:\/\/[^\s]+/gi, "<url>");
}

function sourceIntegrity() {
  return Object.fromEntries(requiredInputs.map((relative) => [relative, digest(path.join(root, relative))]));
}

function dirtyInventory() {
  const output = run("git", ["status", "--porcelain=v1"], process.env).stdout;
  return { count: output ? output.split(/\r?\n/).filter(Boolean).length : 0, fingerprint: crypto.createHash("sha256").update(output).digest("hex") };
}

function parseExportedSymbols(sourceText, fileName = routePath) {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const symbols = [];
  const hasExport = (node) => Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const span = (node) => {
    const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1;
    const end = ts.getLineAndCharacterOfPosition(sourceFile, node.end).line + 1;
    return { startLine: start, endLine: end };
  };
  const add = (name, kind, node, normalizedSignature) => symbols.push({ name, kind, ...span(node), signatureFingerprint: crypto.createHash("sha256").update(normalizedSignature).digest("hex") });
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExport(statement) && statement.name) {
      add(statement.name.text, "function", statement, `function|${statement.name.text}|params=${statement.parameters.length}|async=${hasExport(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "1" : "0"}`);
    } else if (ts.isVariableStatement(statement) && hasExport(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text, "const", statement, `const|${declaration.name.text}|initializer=${declaration.initializer?.kind ?? "none"}`);
      }
    } else if (ts.isClassDeclaration(statement) && hasExport(statement) && statement.name) add(statement.name.text, "class", statement, `class|${statement.name.text}`);
    else if (ts.isTypeAliasDeclaration(statement) && hasExport(statement)) add(statement.name.text, "type", statement, `type|${statement.name.text}|${statement.type.kind}`);
    else if (ts.isInterfaceDeclaration(statement) && hasExport(statement)) add(statement.name.text, "interface", statement, `interface|${statement.name.text}`);
    else if (ts.isEnumDeclaration(statement) && hasExport(statement)) add(statement.name.text, "enum", statement, `enum|${statement.name.text}`);
    else if (ts.isExportDeclaration(statement)) {
      for (const element of statement.exportClause?.elements ?? []) add(element.name.text, "re-export", statement, `re-export|${element.name.text}`);
    } else if (ts.isExportAssignment(statement)) add("default", "default", statement, `default|${statement.expression.kind}`);
  }
  return symbols;
}

export function extractAllowedRouteExports(validatorText, route = routePath) {
  const marker = `// Validate ${route}`;
  const markerIndex = validatorText.indexOf(marker);
  if (markerIndex < 0) return { markerFound: false, routeContract: null, allowed: [] };
  const block = validatorText.slice(Math.max(0, validatorText.indexOf("type RouteHandlerConfig", 0)), markerIndex + 1000);
  const typeBlock = /type RouteHandlerConfig[^=]*=\s*\{([\s\S]*?)\n\}/m.exec(block)?.[1] ?? "";
  const allowed = [...typeBlock.matchAll(/^\s*([A-Z]+)\?/gm)].map((match) => match[1]);
  const contract = /handler\s+satisfies\s+RouteHandlerConfig<([^>]+)>/.exec(validatorText.slice(markerIndex, markerIndex + 1000))?.[1] ?? null;
  return { markerFound: true, routeContract: contract?.replaceAll('"', "") ?? null, allowed: [...new Set(allowed)].sort() };
}

export function detectDisallowedExports(sourceExports, allowedExports) {
  const allowed = new Set(allowedExports);
  return sourceExports.filter((entry) => !allowed.has(entry.name));
}

function hunkRanges(relative) {
  const diff = run("git", ["diff", "--unified=0", "--", relative], process.env).stdout;
  return [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({ start: Number(match[1]), count: Number(match[2] ?? 1) }));
}

function ownershipFor(symbol) {
  const status = run("git", ["status", "--short", "--", routePath], process.env).stdout.trim();
  const ranges = hunkRanges(routePath);
  const overlap = ranges.some((range) => symbol.startLine <= range.start + Math.max(range.count, 1) - 1 && symbol.endLine >= range.start);
  return { ownership: status.startsWith("??") ? "UNTRACKED" : status ? "PRESERVE_ONLY_DIRTY" : "TRACKED_CLEAN", statusCode: status.slice(0, 2) || "", dirtyHunkCount: ranges.length, symbolSpanOverlapsDirtyHunk: overlap };
}

export function classifyOutcome({ generatedPresent, generatedContract, disallowed, ownership }) {
  if (!generatedPresent || !generatedContract?.markerFound) return CLASSIFICATIONS.GENERATED_CONTRACT_SCOPE_MISMATCH;
  if (disallowed.length !== 1 || !ownership) return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  if (ownership.ownership === "PRESERVE_ONLY_DIRTY" && ownership.symbolSpanOverlapsDirtyHunk) return CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO;
  if (ownership.ownership === "TRACKED_CLEAN" && !ownership.symbolSpanOverlapsDirtyHunk) return CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE;
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
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp136_typegen",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp136_typegen",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:32136",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    CSRF_SECRET: "wp136-local-csrf-synthetic-value",
    JOB_SECRET: "wp136-local-job-synthetic-value",
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
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp136-${runId}`);
  const receipt = {
    workPackage: "WP-136",
    status: "BLOCKED_OR_FAILED",
    classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
    scope: "LOCAL_TEMP_ONLY_NEXT_TYPEGEN_ROUTE_CONTRACT",
    typegen: { attempts: 0, command: "next typegen", exitCode: null, outputFingerprint: null, rawOutputPersisted: false },
    preflight: null,
    mirror: null,
    generated: { validatorPresent: false, routesPresent: false, validatorDigest: null, routesDigest: null, knownHistoricalPath: expectedGeneratedBoundary },
    routeContract: null,
    sourceExports: [],
    disallowedExports: [],
    ownership: null,
    sourceIntegrity: { before: null, after: null, unchanged: false },
    dirtyInventory: { before: null, after: null, unchanged: false },
    cleanup: { mirror: "NOT_STARTED" },
    stagedIndexEmpty: false,
    noEmit: true,
    compilerWriteAttempts: 0,
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
        const validatorFile = path.join(tempRoot, generatedValidatorPath);
        const routesFile = path.join(tempRoot, generatedRoutesPath);
        receipt.generated.validatorPresent = fs.existsSync(validatorFile);
        receipt.generated.routesPresent = fs.existsSync(routesFile);
        if (receipt.generated.validatorPresent) receipt.generated.validatorDigest = digest(validatorFile);
        if (receipt.generated.routesPresent) receipt.generated.routesDigest = digest(routesFile);
        if (result.exitCode === 0 && receipt.generated.validatorPresent && receipt.generated.routesPresent) {
          const validatorText = fs.readFileSync(validatorFile, "utf8");
          const routeSourceText = fs.readFileSync(path.join(root, routePath), "utf8");
          receipt.routeContract = extractAllowedRouteExports(validatorText, routePath);
          receipt.sourceExports = parseExportedSymbols(routeSourceText);
          receipt.disallowedExports = detectDisallowedExports(receipt.sourceExports, receipt.routeContract.allowed);
          const candidate = receipt.disallowedExports.length === 1 ? receipt.disallowedExports[0] : null;
          receipt.ownership = candidate ? ownershipFor(candidate) : null;
          receipt.classification = classifyOutcome({ generatedPresent: true, generatedContract: receipt.routeContract, disallowed: receipt.disallowedExports, ownership: receipt.ownership });
        } else receipt.classification = CLASSIFICATIONS.GENERATED_CONTRACT_SCOPE_MISMATCH;
      }
    }
  } catch (error) {
    receipt.failureCode = error?.code ?? "TYPEGEN_RUNNER_EXCEPTION";
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
    receipt.status = receipt.classification === CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE || receipt.classification === CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO ? "PASS" : "BLOCKED_OR_FAILED";
    fs.writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
