import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NETWORK_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "ENOAUDIT"]);

// Only emit fixed categories/counts, never npm's raw error body or stderr.
export function summarizeAudit(result) {
  let report;
  try { report = JSON.parse(result.stdout); } catch { /* Fail closed below. */ }
  const counts = report?.metadata?.vulnerabilities;
  const validCounts = counts && ["high", "critical"].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0);
  const code = report?.error?.code ?? result.error?.code;
  const valid = Boolean(validCounts && !report?.error && !result.error && !result.signal);
  const pass = valid && result.status === 0 && counts.high === 0 && counts.critical === 0;
  return {
    exitCode: pass ? 0 : 1,
    summary: {
      status: pass ? "PASS" : "FAIL",
      category: valid
        ? (counts.high + counts.critical > 0 ? "HIGH_OR_CRITICAL_VULNERABILITY" : pass ? "AUDIT_COMPLETE" : "AUDIT_COMMAND_FAILED")
        : NETWORK_CODES.has(code) ? "AUDIT_ENDPOINT_UNAVAILABLE" : "AUDIT_RESULT_UNAVAILABLE",
      high: valid ? counts.high : null,
      critical: valid ? counts.critical : null,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // CI runs on Ubuntu. Preserve the existing production-only High threshold.
  // Capture output in process memory, print only the summary, and do not retry.
  const result = spawnSync("npm", ["audit", "--omit=dev", "--audit-level=high", "--json"], {
    encoding: "utf8", shell: false, timeout: 240_000, maxBuffer: 4 * 1024 * 1024,
  });
  const { exitCode, summary } = summarizeAudit(result);
  console.log(JSON.stringify(summary));
  if (exitCode !== 0) console.error(`::error title=Production dependency audit::${JSON.stringify(summary)}`);
  process.exitCode = exitCode;
}
