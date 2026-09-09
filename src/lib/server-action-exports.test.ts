import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}

function isServerActionModule(source: ts.SourceFile) {
  // Directive 必須出現在檔案開頭的字串指令序列，函式內的 use server 不算。
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function invalidRuntimeExports(source: ts.SourceFile, checker?: () => ts.TypeChecker) {
  const invalid: string[] = [];
  const asyncModifier = (node: ts.Node) => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  const asyncValue = (node: ts.Node, seen = new Set<ts.Node>()): boolean => {
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return Boolean(asyncModifier(node));
    if (ts.isVariableDeclaration(node)) return Boolean(node.initializer && asyncValue(node.initializer, seen));
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return asyncValue(node.expression, seen);
    if (ts.isIdentifier(node) && checker) {
      const symbol = checker().getSymbolAtLocation(node);
      return Boolean(symbol && asyncSymbol(symbol, seen));
    }
    return false;
  };
  const asyncSymbol = (symbol: ts.Symbol, seen = new Set<ts.Node>()): boolean => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker!().getAliasedSymbol(symbol) : symbol;
    // 未標記 type 的型別 re-export 也不會產生 runtime 值。
    if (!(target.flags & ts.SymbolFlags.Value)) return true;
    return Boolean(target.declarations?.some((declaration) => asyncValue(declaration, seen)));
  };
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (statement.exportClause && ts.isNamespaceExport(statement.exportClause)) {
        invalid.push(statement.exportClause.name.text);
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) {
          if (item.isTypeOnly) continue;
          const symbol = checker?.().getSymbolAtLocation(item.name);
          if (!symbol || !asyncSymbol(symbol)) invalid.push(item.name.text);
        }
      } else {
        const moduleSymbol = statement.moduleSpecifier && checker?.().getSymbolAtLocation(statement.moduleSpecifier);
        if (!moduleSymbol) invalid.push("*");
        else for (const symbol of checker!().getExportsOfModule(moduleSymbol)) if (!asyncSymbol(symbol)) invalid.push(symbol.name);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (!asyncValue(statement.expression)) invalid.push("default");
      continue;
    }
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (!asyncValue(declaration)) invalid.push(declaration.name.getText(source));
    } else if (!asyncValue(statement)) invalid.push(statement.getText(source).split("\n")[0]!);
  }
  return invalid;
}

describe("Server Action runtime export contract", () => {
  it("allows async functions and type exports while rejecting object constants and synchronous functions", () => {
    const source = ts.createSourceFile("contract.ts", '"use server"; export type State = { status: string }; export interface Input {} export { type State }; export async function save() {} export const arrow = async () => {}; export const state = {}; export function sync() {}', ts.ScriptTarget.Latest, true);
    expect(isServerActionModule(source)).toBe(true);
    expect(invalidRuntimeExports(source)).toEqual(["state", "export function sync() {}"]);
  });

  it("keeps every top-level use server module limited to async runtime exports", () => {
    const parsed = sourceFiles(resolve("src")).map((file) => ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true));
    const modules = parsed.filter(isServerActionModule);
    expect(modules.length).toBeGreaterThan(0);
    // 只有遇到 runtime 別名或 re-export 才建立語意解析，日常直接 async exports 不需載入全專案型別。
    let program: ts.Program | undefined;
    const checker = () => {
      if (!program) {
        const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json")!;
        const config = ts.readConfigFile(configPath, ts.sys.readFile);
        const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
        program = ts.createProgram(modules.map((source) => source.fileName), options);
      }
      return program.getTypeChecker();
    };
    const failures = modules.flatMap((source) => {
      const requiresSymbols = source.statements.some((statement) => {
        if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
        if (ts.isExportAssignment(statement)) return true;
        return ts.isVariableStatement(statement) && Boolean(ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
      });
      const checkedSource = requiresSymbols ? (checker(), program!.getSourceFile(source.fileName)!) : source;
      return invalidRuntimeExports(checkedSource, checker).map((name) => `${source.fileName}: ${name}`);
    });
    expect(failures).toEqual([]);
  });
});
