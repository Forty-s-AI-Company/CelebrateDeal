import { config } from "dotenv";
import { getEnvCheckReport } from "../src/lib/env";

config({ path: ".env.local" });
config({ path: ".env" });

const report = getEnvCheckReport();

for (const check of report.checks) {
  const prefix = check.status === "pass" ? "PASS" : check.status === "warning" ? "WARN" : "FAIL";
  console.log(`[${prefix}] ${check.key}: ${check.message}`);
}

if (!report.ok) {
  process.exitCode = 1;
}
