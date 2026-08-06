import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseTypeScript } from "@babel/parser";
import { mergeProcessCovs } from "@bcoe/v8-coverage";
import astV8ToIstanbul from "ast-v8-to-istanbul";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { parseAstAsync } from "vitest/node";

const workspaceRoot = process.cwd();
const reportsDirectory = path.join(workspaceRoot, "coverage");
const nodeTapCoverageDirectory = path.join(reportsDirectory, "node-tap-v8");
const coverageFinalPath = path.join(reportsDirectory, "coverage-final.json");
const coverageThresholds = { statements: 63, branches: 57, functions: 60, lines: 65 };
const libThresholds = { statements: 86, branches: 80, functions: 88, lines: 88 };

function run(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function isProductionScriptCoverage(result, root = workspaceRoot) {
  if (!result.url.startsWith("file:")) return false;
  const filename = fileURLToPath(result.url.split("?")[0]);
  const relativePath = path.relative(root, filename).split(path.sep).join("/");
  return relativePath.startsWith("scripts/")
    && /\.(?:mjs|ts)$/.test(relativePath)
    && !relativePath.endsWith(".test.mjs")
    && !relativePath.endsWith(".test.ts");
}

async function collectNodeTapCoverage() {
  const coverageFiles = await fs.readdir(nodeTapCoverageDirectory);
  let merged = { result: [] };
  for (const filename of coverageFiles) {
    const raw = JSON.parse(await fs.readFile(path.join(nodeTapCoverageDirectory, filename), "utf8"));
    merged = mergeProcessCovs([merged, raw]);
  }

  const coverageMap = libCoverage.createCoverageMap({});
  const nodeTapScripts = merged.result.filter((result) => isProductionScriptCoverage(result, workspaceRoot));
  if (nodeTapScripts.length === 0) throw new Error("Node TAP did not produce coverage for any production scripts.");

  for (const script of nodeTapScripts) {
    const url = script.url.split("?")[0];
    const filename = fileURLToPath(url);
    const source = await fs.readFile(filename, "utf8");
    const ast = filename.endsWith(".ts")
      ? parseTypeScript(source, { sourceType: "unambiguous", plugins: ["typescript"] }).program
      : await parseAstAsync(source);
    const converted = await astV8ToIstanbul({ code: source, ast, coverage: { functions: script.functions, url } });
    coverageMap.merge(converted);
  }
  return coverageMap;
}

function percentage(summary, metric) {
  return summary.data[metric].pct;
}

function enforceThresholds(coverageMap) {
  const checks = [
    { label: "global", thresholds: coverageThresholds, files: coverageMap.files() },
    { label: "src/lib/**.ts", thresholds: libThresholds, files: coverageMap.files().filter((filename) => filename.replace(/\\/g, "/").includes("/src/lib/") && filename.endsWith(".ts")) },
  ];
  const failures = [];
  for (const check of checks) {
    const map = libCoverage.createCoverageMap({});
    for (const filename of check.files) map.addFileCoverage(coverageMap.fileCoverageFor(filename));
    const summary = map.getCoverageSummary();
    for (const [metric, threshold] of Object.entries(check.thresholds)) {
      const actual = percentage(summary, metric);
      if (actual < threshold) failures.push(`${check.label} ${metric}: ${actual}% < ${threshold}%`);
    }
  }
  if (failures.length > 0) throw new Error(`Coverage threshold failure: ${failures.join("; ")}`);
}

async function main() {
  await fs.rm(nodeTapCoverageDirectory, { recursive: true, force: true });
  await fs.mkdir(nodeTapCoverageDirectory, { recursive: true });
  // Vitest transforms its own modules; thresholds are enforced after the map
  // is merged with Node TAP's V8 coverage below.
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  run(npxCommand, ["vitest", "run", "--coverage"], { ...process.env, COMBINED_COVERAGE_COLLECTION: "true" });
  run(process.execPath, ["--import", "tsx", "scripts/run-node-tap-contracts.ts"], { ...process.env, NODE_V8_COVERAGE: nodeTapCoverageDirectory });
  if (!existsSync(coverageFinalPath)) throw new Error("Vitest did not write coverage-final.json.");

  const vitestCoverage = JSON.parse(await fs.readFile(coverageFinalPath, "utf8"));
  const coverageMap = libCoverage.createCoverageMap(vitestCoverage);
  coverageMap.merge(await collectNodeTapCoverage());
  const context = libReport.createContext({ dir: reportsDirectory, coverageMap });
  reports.create("text-summary").execute(context);
  reports.create("json-summary").execute(context);
  reports.create("json").execute(context);
  enforceThresholds(coverageMap);
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = fileURLToPath(import.meta.url);

if (invokedScript === currentScript) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
