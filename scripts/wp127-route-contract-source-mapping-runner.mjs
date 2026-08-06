import path from "node:path";
import { analyzeRouteContract, CONTRACT } from "./wp127-route-contract-source-mapper.mjs";

const workspaceRoot = process.cwd();
const result = analyzeRouteContract({
  workspaceRoot,
  generatedPath: CONTRACT.EXPECTED_GENERATED_PATH,
  sourcePath: CONTRACT.EXPECTED_SOURCE_PATH,
  generatedArtifactPresent: false,
});

const receipt = {
  work_package: "WP-127",
  status: result.status,
  reason: result.reason,
  mapping: {
    generatedPath: result.generatedPath ?? CONTRACT.EXPECTED_GENERATED_PATH,
    sourcePath: result.sourcePath ?? CONTRACT.EXPECTED_SOURCE_PATH,
    mappedSourcePath: result.mappedSourcePath ?? null,
    generatedArtifactState: result.generatedArtifactState ?? "NOT_READ",
  },
  routeContract: {
    expectedExportsPresent: result.expectedExportsPresent ?? false,
    exportedSymbols: result.exportedSymbols ?? [],
    exportKinds: result.exportKinds ?? [],
    importCount: result.importCount ?? 0,
    importPathDigest: result.importPathDigest ?? null,
  },
  ownership: result.ownership ?? null,
  evidence: {
    sourceDigest: result.sourceDigest ?? null,
    rawSourcePersisted: false,
    sourceSnippetsPersisted: false,
    generatedArtifactRegenerated: false,
    dotenvContentRead: false,
    rawLogsPersisted: false,
    networkRequested: false,
    databaseContacted: false,
    providerContacted: false,
    deploymentAttempted: false,
    stagedIndexModified: false,
  },
  scoreImpact: {
    CAT09_before: 6.5,
    CAT09_after: 6.5,
    total_before: 70.5,
    total_after: 70.5,
  },
};

process.stdout.write(`${JSON.stringify({ ...receipt, workspaceRoot: path.basename(workspaceRoot) }, null, 2)}\n`);
