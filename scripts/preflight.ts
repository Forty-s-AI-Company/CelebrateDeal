import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { getDeploymentTopologyChecks } from "../src/lib/deployment-topology";
import { getEnvCheckReport } from "../src/lib/env";
import { getStagingPreviewBuildIdentityCheck, getStagingPreviewMediaIsolationCheck } from "../src/lib/database-identity";

config({ path: ".env.local" });
config({ path: ".env" });

// `next build` always runs the application in production mode afterwards.
// Make that contract explicit so an unset production-only secret is caught
// before a build artifact that would serve a 500 response can be produced.
const forceProduction = process.argv.includes("--production");
const report = getEnvCheckReport(
  forceProduction ? { ...process.env, NODE_ENV: "production" } : process.env,
);

for (const check of report.checks) {
  const prefix = check.status === "pass" ? "PASS" : check.status === "warning" ? "WARN" : "FAIL";
  console.log(`[${prefix}] ${check.key}: ${check.message}`);
}

if (!report.ok) {
  process.exitCode = 1;
}

// This runs with Vercel's injected variables. Only a boolean result is logged;
// database URLs and credentials never enter the build output.
const stagingIdentity = getStagingPreviewBuildIdentityCheck(process.env);
if (stagingIdentity.applicable) {
  console.log(`[${stagingIdentity.passed ? "PASS" : "FAIL"}] STAGING_PREVIEW_DATA_IDENTITY`);
  if (!stagingIdentity.passed) process.exitCode = 1;
}


// A live-money plan test cannot inherit write access to shared Stream media.
// This logs only PASS/FAIL; bucket names and credentials never enter build logs.
const stagingMedia = getStagingPreviewMediaIsolationCheck(process.env);
if (stagingMedia.applicable) {
  console.log(`[${stagingMedia.passed ? "PASS" : "FAIL"}] STAGING_PREVIEW_MEDIA_ISOLATION`);
  if (!stagingMedia.passed) process.exitCode = 1;
}

// F-090: function region, database region and pooler parameters. Advisory only:
// these lines never change the exit code. Only region IDs and fixed words are
// printed; database hosts and credentials never enter the build output.
function readVercelConfig(): unknown {
  try {
    return JSON.parse(readFileSync("vercel.json", "utf8"));
  } catch {
    return undefined;
  }
}

for (const check of getDeploymentTopologyChecks(process.env, readVercelConfig())) {
  console.log(`[${check.status === "pass" ? "PASS" : "WARN"}] ${check.key}: ${check.message}`);
}
