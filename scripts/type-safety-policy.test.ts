import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const sourceRoot = path.join(repositoryRoot, "src");

function normalize(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function listProductionSource(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "generated" ? [] : listProductionSource(absolutePath);
    }

    return entry.isFile()
      && /\.(?:ts|tsx)$/.test(entry.name)
      && !/\.test\.(?:ts|tsx)$/.test(entry.name)
      && !entry.name.endsWith(".d.ts")
      ? [absolutePath]
      : [];
  });
}

describe("type safety policy", () => {
  const productionFiles = listProductionSource(sourceRoot);

  it("keeps strict compiler and no-emit safety enabled", () => {
    const tsconfig = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "tsconfig.json"), "utf8"));
    const strictIndexConfig = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "tsconfig.strict-index.json"), "utf8"),
    );

    expect(tsconfig.compilerOptions).toMatchObject({
      strict: true,
      noEmit: true,
      isolatedModules: true,
    });
    expect(strictIndexConfig.compilerOptions).toMatchObject({
      noUncheckedIndexedAccess: true,
    });
  });

  it("does not suppress TypeScript diagnostics in production source", () => {
    const suppressions = productionFiles.flatMap((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return /@ts-(?:ignore|nocheck)/.test(source)
        ? [normalize(path.relative(repositoryRoot, filePath))]
        : [];
    });

    expect(suppressions).toEqual([]);
  });

  it("does not use explicit any in production source", () => {
    const findings: string[] = [];

    for (const filePath of productionFiles) {
      const sourceText = fs.readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      function visit(node: ts.Node) {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          findings.push(
            `${normalize(path.relative(repositoryRoot, filePath))}:${position.line + 1}`,
          );
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(findings).toEqual([]);
  }, 30_000);
});
