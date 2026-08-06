import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const productionRoots = ["src", "scripts", "ops"];
const sourceExtensions = new Set([".ts", ".tsx", ".mjs", ".ps1"]);
const productionDebtComment = /(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME|HACK|XXX)\b/;

function normalize(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function listFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(absolutePath);
    }
    return entry.isFile() ? [absolutePath] : [];
  });
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map(normalize);
}

describe("repository hygiene", () => {
  it("does not track generated runtime, credential, or backup artifacts", () => {
    const forbidden = trackedFiles().filter((filePath) => (
      /(^|\/)(?:node_modules|\.next|coverage|test-results|playwright-report|runtime|logs)\//.test(filePath)
      || /\.(?:dump|age|sha256|agekey|pem|rclone\.conf)$/i.test(filePath)
      || /(^|\/)cookies?\.txt$/i.test(filePath)
      || (
        /(^|\/)\.env(?:\.|$)/i.test(filePath)
        && !/\.env(?:\.[^/]+)?\.example$/i.test(filePath)
      )
    ));

    expect(forbidden).toEqual([]);
  });

  it("keeps production debt markers out of source without an owned ledger entry", () => {
    const findings = productionRoots.flatMap((root) => (
      listFiles(path.join(repositoryRoot, root))
        .filter((filePath) => sourceExtensions.has(path.extname(filePath)))
        .filter((filePath) => !/\.test\.(?:ts|tsx|mjs)$/.test(filePath))
        .flatMap((filePath) => {
          const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
          return lines.flatMap((line, index) => (
            productionDebtComment.test(line)
              ? [`${normalize(path.relative(repositoryRoot, filePath))}:${index + 1}`]
              : []
          ));
        })
    ));

    expect(findings).toEqual([]);
  });

  it("does not commit focused tests", () => {
    const focusedTests = trackedFiles()
      .filter((filePath) => /\.(?:test|spec)\.(?:ts|tsx|mjs)$/.test(filePath))
      .flatMap((filePath) => {
        const source = fs.readFileSync(path.join(repositoryRoot, filePath), "utf8");
        return /\b(?:describe|it|test)\.only\s*\(/.test(source) ? [filePath] : [];
      });

    expect(focusedTests).toEqual([]);
  });

  it("keeps generated test and coverage directories ignored", () => {
    const gitignore = fs.readFileSync(path.join(repositoryRoot, ".gitignore"), "utf8");

    expect(gitignore).toContain("/coverage");
    expect(gitignore).toContain("/test-results");
    expect(gitignore).toContain("/playwright-report");
    expect(gitignore).toContain("/ops/backup/runtime/");
    expect(gitignore).toContain("/ops/backup/logs/");
  });
});
