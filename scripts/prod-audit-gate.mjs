// Production dependency audit gate: `npm audit --omit=dev --audit-level=high`
// with one dated, evidence-backed exception. Every other high or critical
// advisory still fails. The exception and its removal condition are recorded
// in SECURITY.md ("正式環境相依的已知例外").
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export const exceptions = [
  {
    ghsa: "GHSA-fc5q-39xc-vjpf",
    // The gate fails again from this day on, so the exception cannot be forgotten.
    expires: "2027-01-01",
    // Only these packages may be flagged high through the advisory. The chain
    // exists solely because the build-time webpack wrapping loader of
    // @sentry/nextjs requires @rollup/plugin-commonjs.
    packages: new Set([
      "picomatch",
      "fdir",
      "@rollup/pluginutils",
      "@rollup/plugin-commonjs",
      "@sentry/nextjs",
    ]),
  },
];

const advisoryId = (via) => String(via.url ?? "").split("/").pop();
const ownAdvisories = (vuln) =>
  vuln.via.filter((via) => typeof via === "object" && rank[via.severity] >= rank.high);

/** Returns the list of problems; an empty list means the gate passes. */
export function evaluateAudit(report, now = new Date()) {
  if (!report?.vulnerabilities || !report?.metadata?.vulnerabilities) {
    return ["npm audit did not return vulnerability metadata."];
  }
  const problems = [];
  const today = now.toISOString().slice(0, 10);
  const allowed = new Map(exceptions.map((entry) => [entry.ghsa, entry]));
  const high = Object.entries(report.vulnerabilities).filter(([, vuln]) => rank[vuln.severity] >= rank.high);

  const reported = new Set();
  for (const [name, vuln] of high) {
    for (const via of ownAdvisories(vuln)) {
      const id = advisoryId(via);
      const entry = allowed.get(id);
      if (!entry) {
        problems.push(`${id} (${name}) is a high or critical advisory without an exception.`);
      } else if (today >= entry.expires && !reported.has(id)) {
        reported.add(id);
        problems.push(`The exception for ${id} expired on ${entry.expires}.`);
      } else if (!entry.packages.has(name)) {
        problems.push(`${name} is flagged by ${id} outside the documented exception chain.`);
      }
    }
  }
  // A package that is high only because of a dependency must also be in the chain.
  const chain = new Set(exceptions.flatMap((entry) => [...entry.packages]));
  for (const [name] of high) {
    if (!chain.has(name)) problems.push(`${name} is flagged high outside the documented exception chain.`);
  }
  return [...new Set(problems)];
}

function main() {
  const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error("npm audit did not produce JSON output.");
    console.error(result.stderr);
    process.exit(1);
  }
  const problems = evaluateAudit(report);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL: ${problem}`);
    process.exit(1);
  }
  const { high, critical } = report.metadata.vulnerabilities;
  const listed = exceptions.map((entry) => `${entry.ghsa} until ${entry.expires}`).join(", ");
  console.log(`Production audit passed: ${high} high / ${critical} critical node(s), all covered by an unexpired exception (${listed}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
