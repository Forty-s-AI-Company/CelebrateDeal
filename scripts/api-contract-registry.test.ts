import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve("src/app");
const REGISTRY_PATH = path.resolve("docs/codex-goal/API_CONTRACT_REGISTRY.md");

function routeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolutePath);
    return entry.isFile() && entry.name === "route.ts" ? [absolutePath] : [];
  });
}

function routePath(filename: string) {
  return `/${path.relative(APP_ROOT, filename).replaceAll("\\", "/").replace(/\/route\.ts$/, "")}`;
}

function exportedMethods(source: string) {
  return Array.from(
    source.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g),
    (match) => match[1],
  );
}

describe("API contract registry", () => {
  it("registers every route method and keeps a same-path route test", () => {
    const registry = fs.readFileSync(REGISTRY_PATH, "utf8");
    const missingContracts: string[] = [];
    const missingTests: string[] = [];

    for (const filename of routeFiles(APP_ROOT)) {
      const source = fs.readFileSync(filename, "utf8");
      const endpoint = routePath(filename);
      const methods = exportedMethods(source);

      if (methods.length === 0) {
        missingContracts.push(`${endpoint} has no statically inventoried method`);
      }
      for (const method of methods) {
        if (!registry.includes(`\`${method} ${endpoint}\``)) {
          missingContracts.push(`${method} ${endpoint}`);
        }
      }

      const siblingTest = filename.replace(/route\.ts$/, "route.test.ts");
      if (!fs.existsSync(siblingTest)) {
        missingTests.push(path.relative(process.cwd(), siblingTest));
      }
    }

    expect(missingContracts).toEqual([]);
    expect(missingTests).toEqual([]);
  });
});

