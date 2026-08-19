import { config } from "dotenv";
import { getEnvCheckReport } from "../src/lib/env";

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
