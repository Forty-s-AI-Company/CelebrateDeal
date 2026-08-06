import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, ".ai-team", "reports", "wp135-temp-route-lineage-recovery-receipt.json");
const routePath = "src/app/api/cloudflare/stream-webhook/route.ts";
const routeImportSuffix = "src/app/api/cloudflare/stream-webhook/route.js";
const routeUrl = "/api/cloudflare/stream-webhook";
const generatedTypesRoot = ".next/types";
const requiredInputs = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", routePath];
const expectedRouteDigest = "7b9d506c01c9c19a7d76eaccf81b1d362e0ea8d1a0e78b1f0f869774a8bf04b2";
const ownedPaths = [
  "scripts/wp135-temp-route-lineage-runner.mjs",
  "scripts/wp135-temp-route-lineage-runner.test.mjs",
  ".ai-team/reports/wp135-temp-route-lineage-recovery-receipt.json",
  "docs/ai-team/evidence/wp-135-temp-route-lineage-recovery.md",
];
const ts = createRequire(import.meta.url)("typescript");

export const CLASSIFICATIONS = Object.freeze({
  CLEAN_SEPARABLE_CANDIDATE: "CLEAN_SEPARABLE_CANDIDATE",
  EXACT_PRESERVE_ONLY_NO_GO: "EXACT_PRESERVE_ONLY_NO_GO",
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function sanitizeText(value) {
  return String(value ?? "")
    .replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(/[A-Za-z]:\\[^\r\n\s'"`]+/g, "<path>")
    .replaceAll(/\b[A-Z][A-Z0-9_]{2,}=([^\s]+)/g, "<env>=<value>")
    .replaceAll(/(?:postgres(?:ql)?:\/\/)[^\s]+/gi, "<database-url>")
    .replaceAll(/https?:\/\/[^\s]+/gi, "<url>");
}

function normalize(relative) {
  return String(relative ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function isForbiddenPath(relative) {
  const normalized = normalize(relative).toLowerCase();
  const segments = normalized.split("/");
  return segments.some((segment) => segment.startsWith(".env"))
    || normalized.startsWith(".next/")
    || segments.some((segment) => /(?:secret|credential|token|cookie|private)/i.test(segment))
    || /\.(?:db|sqlite|sqlite3|pem|key|crt)$/i.test(normalized);
}

function mirrorFilter(source) {
  const relative = normalize(path.relative(root, source));
  if (!relative) return true;
  if ([".git", ".next", "node_modules", ".ai-team"].includes(relative)) return false;
  return !isForbiddenPath(relative);
}

function inspectMirror(tempRoot) {
  const missing = requiredInputs.filter((relative) => !fs.existsSync(path.join(tempRoot, relative)));
  const forbiddenCopied = [];
  for (const entry of fs.readdirSync(tempRoot, { recursive: true })) {
    const relative = normalize(String(entry));
    if (relative === "node_modules" || relative.startsWith("node_modules/")) continue;
    if (isForbiddenPath(relative)) forbiddenCopied.push(relative);
  }
  return { missing, forbiddenCopied: forbiddenCopied.sort() };
}

function sourceIntegrity() {
  return Object.fromEntries(requiredInputs.map((relative) => [relative, digest(path.join(root, relative))]));
}

function parseStatusPath(line) {
  const raw = String(line).slice(3).trim();
  return normalize(raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw);
}

function isOwnedStatusLine(line) {
  const pathName = parseStatusPath(line);
  return ownedPaths.some((owned) => pathName === owned);
}

function dirtyInventory() {
  const output = run("git", ["status", "--porcelain=v1", "--untracked-files=all"], process.env).stdout;
  const lines = output.split(/\r?\n/).filter(Boolean).filter((line) => !isOwnedStatusLine(line));
  const normalized = `${lines.join("\n")}\n`;
  return { count: lines.length, fingerprint: sha256(normalized) };
}

function stagedIndexEmpty() {
  return !run("git", ["diff", "--cached", "--name-only"], process.env).stdout.trim();
}

export function parseSourceExports(sourceText, fileName = routePath) {
  const sourceFile = ts.createSourceFile(fileName, String(sourceText ?? ""), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const symbols = [];
  const isExported = (node) => Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const span = (node) => ({
    startLine: ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1,
    endLine: ts.getLineAndCharacterOfPosition(sourceFile, node.end).line + 1,
  });
  const add = (name, kind, node, signature) => symbols.push({ name, kind, ...span(node), signatureFingerprint: sha256(signature) });

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement) && statement.name) {
      add(statement.name.text, "function", statement, `function|${statement.name.text}|params=${statement.parameters.length}`);
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name.text, "const", statement, `const|${declaration.name.text}|initializer=${declaration.initializer?.kind ?? "none"}`);
      }
    } else if (ts.isClassDeclaration(statement) && isExported(statement) && statement.name) add(statement.name.text, "class", statement, `class|${statement.name.text}`);
    else if (ts.isTypeAliasDeclaration(statement) && isExported(statement)) add(statement.name.text, "type", statement, `type|${statement.name.text}`);
    else if (ts.isInterfaceDeclaration(statement) && isExported(statement)) add(statement.name.text, "interface", statement, `interface|${statement.name.text}`);
    else if (ts.isEnumDeclaration(statement) && isExported(statement)) add(statement.name.text, "enum", statement, `enum|${statement.name.text}`);
    else if (ts.isExportDeclaration(statement)) {
      for (const element of statement.exportClause?.elements ?? []) add(element.name.text, "re-export", statement, `re-export|${element.name.text}`);
    } else if (ts.isExportAssignment(statement)) add("default", "default", statement, `default|${statement.expression.kind}`);
  }
  return symbols.sort((left, right) => left.name.localeCompare(right.name));
}

function generatedTargetHit(text) {
  const sourceTs = routeImportSuffix.replace(/\.js$/u, ".ts");
  return text.includes(routeUrl) || text.includes(routeImportSuffix) || text.includes(sourceTs) || text.includes(`./${routeImportSuffix}`);
}

export function extractGeneratedInventory(tempRoot) {
  const typesRoot = path.join(tempRoot, generatedTypesRoot);
  const files = [];
  if (!fs.existsSync(typesRoot)) return { files, targetReferences: [], inventoryComplete: false, requiredFilesPresent: false };
  for (const entry of fs.readdirSync(typesRoot, { recursive: true })) {
    const relative = normalize(String(entry));
    if (!/\.(?:ts|d\.ts)$/u.test(relative)) continue;
    const absolute = path.join(typesRoot, relative);
    if (!fs.statSync(absolute).isFile()) continue;
    const text = fs.readFileSync(absolute, "utf8");
    files.push({
      path: `${generatedTypesRoot}/${relative}`,
      digest: digest(absolute),
      targetHit: generatedTargetHit(text),
      routeUrlHit: text.includes(routeUrl),
      sourceImportHit: text.includes(routeImportSuffix) || text.includes(routeImportSuffix.replace(/\.js$/u, ".ts")),
      routeHandlerConfig: text.includes("RouteHandlerConfig"),
    });
  }
  const requiredFilesPresent = files.some((file) => file.path.endsWith("routes.d.ts")) && files.some((file) => file.path.endsWith("validator.ts"));
  const targetReferences = files.filter((file) => file.targetHit);
  return {
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    targetReferences,
    inventoryComplete: files.length > 0 && requiredFilesPresent,
    requiredFilesPresent,
  };
}

export function extractAllowedRouteExports(validatorText) {
  const match = /type\s+RouteHandlerConfig(?:<[^>]+>)?\s*=\s*\{([\s\S]*?)\n\}/m.exec(String(validatorText ?? ""));
  if (!match) return { found: false, allowed: [] };
  const allowed = [...match[1].matchAll(/^\s*([A-Z]+)\?/gm)].map((item) => item[1]);
  return { found: allowed.length > 0, allowed: [...new Set(allowed)].sort() };
}

export function mapGeneratedRouteContract(validatorText) {
  const sourceImport = /typeof\s+import\(\s*(['"])([^'"]+)\1\s*\)/g;
  const candidates = [];
  for (const match of String(validatorText ?? "").matchAll(sourceImport)) {
    if (!normalize(match[2]).endsWith(routeImportSuffix)) continue;
    const start = Math.max(0, match.index - 120);
    const block = String(validatorText).slice(start, match.index + 520);
    const routeMatch = /handler\s+satisfies\s+RouteHandlerConfig<\s*(["'])([^"']+)\1\s*>/.exec(block);
    candidates.push({ importSpecifierSuffix: routeImportSuffix, route: routeMatch?.[2] ?? null, contract: routeMatch ? "RouteHandlerConfig" : null });
  }
  if (candidates.length !== 1 || candidates[0].contract !== "RouteHandlerConfig" || candidates[0].route !== routeUrl) {
    return { mapped: false, reason: candidates.length === 0 ? "TARGET_ROUTE_CONTRACT_NOT_FOUND" : "AMBIGUOUS_OR_WRONG_ROUTE", candidates };
  }
  const allowed = extractAllowedRouteExports(validatorText);
  if (!allowed.found) return { mapped: false, reason: "ROUTE_HANDLER_EXPORT_CONTRACT_NOT_FOUND", candidates, allowed: [] };
  return { mapped: true, reason: "EXACT_ROUTE_CONTRACT", candidates, allowed: allowed.allowed };
}

function hunkRanges(relative) {
  const diff = run("git", ["diff", "--unified=0", "--", relative], process.env).stdout;
  return [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => ({ startLine: Number(match[1]), endLine: Number(match[1]) + Math.max(Number(match[2] ?? 1), 1) - 1 }));
}

export function ownershipFor(symbol) {
  const status = run("git", ["status", "--short", "--", routePath], process.env).stdout.trim();
  const ranges = hunkRanges(routePath);
  const overlap = ranges.some((range) => symbol.startLine <= range.endLine && symbol.endLine >= range.startLine);
  return { ownership: status.startsWith("??") ? "UNTRACKED" : status ? "PRESERVE_ONLY_DIRTY" : "TRACKED_CLEAN", statusCode: status.slice(0, 2) || "", dirtyHunkCount: ranges.length, symbolSpanOverlapsDirtyHunk: overlap };
}

export function classifyResult({ generated, mapping, sourceExports, ownership }) {
  if (!generated.inventoryComplete) return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  if (!generated.targetReferences.length) return CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO;
  if (!mapping?.mapped || !ownership) return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
  const disallowed = sourceExports.filter((symbol) => !mapping.allowed.includes(symbol.name));
  if (disallowed.length !== 1) return CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
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
    DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp135_typegen",
    DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:54329/wp135_typegen",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:32135",
    PAYMENT_PROVIDER: "demo",
    RATE_LIMIT_PROVIDER: "memory",
    CSRF_SECRET: "wp135-local-csrf-synthetic-value",
    JOB_SECRET: "wp135-local-job-synthetic-value",
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
  const tempRoot = path.join(os.tmpdir(), `celebratedeal-wp135-${runId}`);
  const receipt = {
    workPackage: "WP-135",
    status: "BLOCKED_OR_FAILED",
    classification: CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED,
    scope: "LOCAL_TEMP_ONLY_NEXT_ROUTE_CONTRACT_LINEAGE_RECOVERY",
    preflight: null,
    typegen: { attempts: 0, exitCode: null, outputFingerprint: null, rawOutputPersisted: false },
    mirror: null,
    generatedInventory: null,
    routeMapping: null,
    sourceExports: [],
    disallowedExports: [],
    ownership: null,
    sourceIntegrity: { before: null, after: null, unchanged: false },
    dirtyInventory: { before: null, after: null, unchanged: false },
    cleanup: { mirror: "NOT_STARTED" },
    repositoryNext: { beforePresent: fs.existsSync(path.join(root, ".next")), afterPresent: null },
    stagedIndexEmpty: false,
    serverLaunches: 0,
    browserRuns: 0,
    externalOperations: false,
    databaseOperations: false,
    dotenvContentRead: false,
    sourceSnippetsPersisted: false,
    generatedContentPersisted: false,
    scoreImpact: { CAT06_before: 7.0, CAT06_after: 7.0, CAT09_before: 6.5, CAT09_after: 6.5, total_before: 71.0, total_after: 71.0 },
    startedAt,
    finishedAt: null,
  };
  let tempCreated = false;
  try {
    const preflight = {
      inputsPresent: requiredInputs.every((relative) => fs.existsSync(path.join(root, relative))),
      sourceIntegrity: sourceIntegrity(),
      dirtyInventory: dirtyInventory(),
      stagedIndexEmpty: stagedIndexEmpty(),
      nextVersion: createRequire(import.meta.url)("next/package.json").version,
      expectedRouteDigest,
    };
    receipt.preflight = preflight;
    receipt.sourceIntegrity.before = preflight.sourceIntegrity;
    receipt.dirtyInventory.before = preflight.dirtyInventory;
    receipt.stagedIndexEmpty = preflight.stagedIndexEmpty;
    if (receipt.repositoryNext.beforePresent || !preflight.inputsPresent || !preflight.stagedIndexEmpty || preflight.sourceIntegrity[routePath] !== expectedRouteDigest) {
      receipt.classification = CLASSIFICATIONS.PREFLIGHT_FAILURE;
    } else {
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
        receipt.typegen.outputFingerprint = sha256(sanitizeText(`${result.stdout}\n${result.stderr}`));
        const generated = extractGeneratedInventory(tempRoot);
        receipt.generatedInventory = generated;
        if (result.exitCode === 0 && generated.inventoryComplete) {
          const validator = generated.files.find((file) => file.path.endsWith("validator.ts"));
          const validatorText = validator ? fs.readFileSync(path.join(tempRoot, validator.path), "utf8") : "";
          const routeSourceText = fs.readFileSync(path.join(root, routePath), "utf8");
          receipt.routeMapping = mapGeneratedRouteContract(validatorText);
          receipt.sourceExports = parseSourceExports(routeSourceText);
          receipt.disallowedExports = receipt.routeMapping.mapped ? receipt.sourceExports.filter((symbol) => !receipt.routeMapping.allowed.includes(symbol.name)) : [];
          const candidate = receipt.disallowedExports.length === 1 ? receipt.disallowedExports[0] : null;
          receipt.ownership = candidate ? ownershipFor(candidate) : null;
          receipt.classification = classifyResult({ generated, mapping: receipt.routeMapping, sourceExports: receipt.sourceExports, ownership: receipt.ownership });
        } else if (result.exitCode === 0 && generated.inventoryComplete && !generated.targetReferences.length) {
          receipt.classification = CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO;
        } else receipt.classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
      }
    }
  } catch (error) {
    receipt.failureCode = error?.code ?? "WP135_RUNNER_EXCEPTION";
  } finally {
    if (tempCreated) {
      try { receipt.cleanup.mirror = cleanupTemp(tempRoot) ? "PASS" : "FAIL"; } catch { receipt.cleanup.mirror = "FAIL"; }
    } else receipt.cleanup.mirror = "NOT_REQUIRED";
    receipt.repositoryNext.afterPresent = fs.existsSync(path.join(root, ".next"));
    receipt.sourceIntegrity.after = sourceIntegrity();
    receipt.sourceIntegrity.unchanged = JSON.stringify(receipt.sourceIntegrity.before) === JSON.stringify(receipt.sourceIntegrity.after);
    receipt.dirtyInventory.after = dirtyInventory();
    receipt.dirtyInventory.unchanged = JSON.stringify(receipt.dirtyInventory.before) === JSON.stringify(receipt.dirtyInventory.after);
    receipt.stagedIndexEmpty = stagedIndexEmpty();
    receipt.workspacePreserved = receipt.sourceIntegrity.unchanged && receipt.dirtyInventory.unchanged && receipt.stagedIndexEmpty && !receipt.repositoryNext.afterPresent;
    receipt.finishedAt = new Date().toISOString();
    if (!receipt.workspacePreserved || receipt.cleanup.mirror === "FAIL") receipt.classification = CLASSIFICATIONS.UNKNOWN_FAIL_CLOSED;
    receipt.status = [CLASSIFICATIONS.CLEAN_SEPARABLE_CANDIDATE, CLASSIFICATIONS.EXACT_PRESERVE_ONLY_NO_GO, CLASSIFICATIONS.TARGET_ROUTE_OMITTED_EXACT_NO_GO].includes(receipt.classification) ? "PASS" : "BLOCKED_OR_FAILED";
    fs.writeFileSync(reportPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
  if (receipt.status !== "PASS") process.exitCode = 1;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
