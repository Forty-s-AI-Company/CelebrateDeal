import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type SecretFinding = {
  file: string;
  line: number;
  category:
    | "private_key"
    | "age_identity"
    | "github_token"
    | "slack_token"
    | "google_oauth_token"
    | "aws_access_key"
    | "live_payment_key"
    | "external_database_url"
    | "runtime_archive";
};

const MAX_TEXT_FILE_BYTES = 1_000_000;
const TEST_FIXTURE_ALLOW_MARKER = "secret-scan: allow-test-fixture";
const RUNTIME_ARCHIVE_EXTENSIONS = new Set([
  ".age",
  ".agekey",
  ".backup",
  ".bak",
  ".dump",
  ".enc",
  ".pgdump",
]);

const detectors: Array<{
  category: SecretFinding["category"];
  pattern: RegExp;
}> = [
  {
    category: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    category: "age_identity",
    pattern: /\bAGE-SECRET-KEY-[A-Z0-9]+\b/g,
  },
  {
    category: "github_token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  },
  {
    category: "slack_token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    category: "google_oauth_token",
    pattern: /\bya29\.[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    category: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    category: "live_payment_key",
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g,
  },
];

function lineNumberAt(content: string, index: number) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function databaseUrlFindings(file: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const pattern = /postgres(?:ql)?:\/\/[^:\s"'`]+:[^@\s"'`]+@([^/\s"'`]+)\/([^?\s"'`]+)/gi;

  for (const match of content.matchAll(pattern)) {
    const authority = match[1] ?? "";
    const database = match[2] ?? "";
    const host = authority.replace(/^\[/, "").replace(/\]?(?::\d+)?$/, "").toLowerCase();
    const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const isSafeDatabase = /(?:^|[_-])(ci|dev|test|e2e|isolated)(?:$|[_-])/i.test(database);

    if (!isLoopback || !isSafeDatabase) {
      findings.push({
        file,
        line: lineNumberAt(content, match.index ?? 0),
        category: "external_database_url",
      });
    }
  }

  return findings;
}

export function scanContent(file: string, content: string): SecretFinding[] {
  const scanTarget = content
    .split(/\r?\n/)
    .map((line) => line.includes(TEST_FIXTURE_ALLOW_MARKER) ? "" : line)
    .join("\n");
  const findings = databaseUrlFindings(file, scanTarget);

  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of scanTarget.matchAll(detector.pattern)) {
      findings.push({
        file,
        line: lineNumberAt(scanTarget, match.index ?? 0),
        category: detector.category,
      });
    }
  }

  return findings;
}

export function isRuntimeArchive(file: string) {
  return RUNTIME_ARCHIVE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function repositoryFiles(root: string) {
  const output = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return output.split("\0").filter(Boolean);
}

export function scanRepository(root: string) {
  const findings: SecretFinding[] = [];

  for (const relativeFile of repositoryFiles(root)) {
    const normalizedFile = relativeFile.replaceAll("\\", "/");
    if (isRuntimeArchive(normalizedFile)) {
      findings.push({ file: normalizedFile, line: 0, category: "runtime_archive" });
      continue;
    }

    const absoluteFile = path.join(root, relativeFile);
    let stats;
    try {
      stats = statSync(absoluteFile);
    } catch {
      continue;
    }
    if (!stats.isFile() || stats.size > MAX_TEXT_FILE_BYTES) continue;

    const buffer = readFileSync(absoluteFile);
    if (buffer.includes(0)) continue;
    findings.push(...scanContent(normalizedFile, buffer.toString("utf8")));
  }

  return findings;
}

function main() {
  const findings = scanRepository(process.cwd());
  if (findings.length > 0) {
    // Never print the matching source text. File, line and category are enough
    // for a maintainer to inspect the source without copying a secret to CI.
    console.error(JSON.stringify({
      status: "failed",
      findingCount: findings.length,
      findings,
    }));
    process.exitCode = 1;
    return;
  }

  console.log("secret_scan_passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
