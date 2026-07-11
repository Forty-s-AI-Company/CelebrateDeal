import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const stagedMode = process.argv.includes("--staged");
const tracked = execFileSync(
  "git",
  stagedMode
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const ignored = [
  /^package-lock\.json$/,
  /\.(?:png|jpg|jpeg|gif|webp|zip|webm|woff2?|ico)$/i,
];
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bre_[A-Za-z0-9_-]{20,}\b/,
  /\bsntrys_[A-Za-z0-9_-]{20,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
];
const sensitiveAssignment = /^\s*([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|HASH_KEY|HASH_IV|PRIVATE_KEY|SERVICE_ROLE_KEY|DATABASE_URL|DIRECT_URL))\s*[:=]\s*(.+?)\s*$/;

function isPlaceholder(value: string) {
  const normalized = value.replace(/^['"]|['"]$/g, "").trim();
  if (!normalized) return true;
  return /^(?:\.{3}|dev-|ci-|e2e-|staging-gate-|dummy-|local-)|\$\{\{|process\.env|your[-_]|replace|placeholder|change[-_]?me|example|sentry\.invalid|localhost|postgres:postgres|<[^>]+>|x{3,}|\*{3,}/i.test(normalized);
}

const findings: string[] = [];
for (const file of tracked) {
  if (ignored.some((pattern) => pattern.test(file))) continue;
  let content: string;
  try {
    content = stagedMode
      ? execFileSync("git", ["show", `:${file}`], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
      : readFileSync(file, "utf8");
  } catch (error) {
    findings.push(`${file}:unreadable:${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  content.split(/\r?\n/).forEach((line, index) => {
    const assignment = /\.(?:ts|tsx|js|mjs|cjs)$/.test(file) ? null : line.match(sensitiveAssignment);
    const hasSensitiveAssignment = Boolean(assignment && !isPlaceholder(assignment[2]));
    if (hasSensitiveAssignment || patterns.some((pattern) => pattern.test(line))) {
      findings.push(`${file}:${index + 1}`);
    }
  });
}

if (findings.length > 0) {
  console.error(`Potential secrets found:\n${findings.join("\n")}`);
  process.exit(1);
}

console.log(
  `Pattern-based secret scan passed for ${tracked.length} ${stagedMode ? "staged" : "tracked and untracked"} files. `
  + "This baseline does not replace GitHub secret scanning or provider-side rotation.",
);
