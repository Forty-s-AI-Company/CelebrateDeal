import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const sourceRoot = path.join(repositoryRoot, "src");

function normalize(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "generated" ? [] : listSourceFiles(absolutePath);
    }

    if (
      entry.isFile()
      && /\.(?:ts|tsx)$/.test(entry.name)
      && !/\.test\.(?:ts|tsx)$/.test(entry.name)
      && !entry.name.endsWith(".d.ts")
    ) {
      return [absolutePath];
    }

    return [];
  });
}

const sourceFiles = listSourceFiles(sourceRoot);
const sourceFileSet = new Set(sourceFiles.map((filePath) => path.resolve(filePath)));

function resolveSourceImport(importer: string, specifier: string) {
  let basePath: string;

  if (specifier.startsWith("@/")) {
    basePath = path.join(sourceRoot, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    basePath = path.resolve(path.dirname(importer), specifier);
  } else {
    return null;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];

  return candidates.find((candidate) => sourceFileSet.has(path.resolve(candidate))) ?? null;
}

function runtimeImports(filePath: string) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) {
        continue;
      }

      if (ts.isStringLiteral(statement.moduleSpecifier)) {
        imports.push(statement.moduleSpecifier.text);
      }
      continue;
    }

    if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push(statement.moduleSpecifier.text);
    }
  }

  return imports;
}

function buildRuntimeGraph() {
  return new Map(
    sourceFiles.map((filePath) => [
      path.resolve(filePath),
      runtimeImports(filePath)
        .map((specifier) => resolveSourceImport(filePath, specifier))
        .filter((resolved): resolved is string => Boolean(resolved))
        .map((resolved) => path.resolve(resolved)),
    ]),
  );
}

function findRuntimeCycles(graph: Map<string, string[]>) {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const cycles = new Set<string>();

  function visit(node: string) {
    if (active.has(node)) {
      const cycleStart = stack.indexOf(node);
      const cycle = [...stack.slice(cycleStart), node]
        .map((filePath) => normalize(path.relative(repositoryRoot, filePath)))
        .join(" -> ");
      cycles.add(cycle);
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    active.add(node);
    stack.push(node);

    for (const dependency of graph.get(node) ?? []) {
      visit(dependency);
    }

    stack.pop();
    active.delete(node);
  }

  for (const node of graph.keys()) {
    visit(node);
  }

  return [...cycles].sort();
}

describe("architecture boundaries", () => {
  it("keeps domain libraries independent from Next app and UI layers", () => {
    const violations = sourceFiles.flatMap((filePath) => {
      const relativePath = normalize(path.relative(repositoryRoot, filePath));
      if (!relativePath.startsWith("src/lib/")) {
        return [];
      }

      return runtimeImports(filePath)
        .filter((specifier) => specifier.startsWith("@/app") || specifier.startsWith("@/components"))
        .map((specifier) => `${relativePath} -> ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps API route handlers independent from browser components", () => {
    const violations = sourceFiles.flatMap((filePath) => {
      const relativePath = normalize(path.relative(repositoryRoot, filePath));
      if (!relativePath.startsWith("src/app/api/") || !relativePath.endsWith("/route.ts")) {
        return [];
      }

      return runtimeImports(filePath)
        .filter((specifier) => specifier.startsWith("@/components"))
        .map((specifier) => `${relativePath} -> ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it("has no runtime import cycles inside src", () => {
    expect(findRuntimeCycles(buildRuntimeGraph())).toEqual([]);
  });

  it("ratchets the legacy root server-action module while new domains are extracted", () => {
    const rootActions = path.join(sourceRoot, "app", "actions.ts");
    const lineCount = fs.readFileSync(rootActions, "utf8").split(/\r?\n/).length;

    // This is a debt ceiling, not a claim that the module is small. New action
    // domains belong in src/app/actions/* until the legacy surface is split.
    // The current one-stop webinar action surface adds lifecycle and
    // reconciliation guards to this legacy module. Keep the ratchet explicit
    // so future extractions still have a fixed ceiling.
    expect(lineCount).toBeLessThanOrEqual(2_500);
  });
});
