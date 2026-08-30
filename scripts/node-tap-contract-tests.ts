import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const nodeTapImportPattern = /(?:from\s+["']node:test["']|require\(["']node:test["']\))/;

function collectTestFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".test.mjs") ? [entryPath] : [];
  });
}

/**
 * Node TAP contract tests deliberately use Node's built-in runner instead of
 * Vitest. Detect the import rather than keeping a fragile hand-maintained
 * filename list, while restricting discovery to the repository's scripts.
 */
export function findNodeTapContractTests(workspaceRoot = process.cwd()): string[] {
  const scriptsDirectory = path.join(workspaceRoot, "scripts");

  return collectTestFiles(scriptsDirectory)
    .filter((filePath) => nodeTapImportPattern.test(readFileSync(filePath, "utf8")))
    .sort();
}
