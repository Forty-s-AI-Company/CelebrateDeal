import fs from "node:fs";
import path from "node:path";

/** Static import graph helpers for source-level contract tests (src/ only; packages are leaves). */
export const SRC_ROOT = path.resolve(__dirname, "..");

const IMPORT = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/gu;

export function resolveSourceImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(SRC_ROOT, specifier.slice(2))
    : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function sourceFiles(directory: string, name: RegExp = /\.(ts|tsx)$/u): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, name);
    return name.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [full] : [];
  });
}

const specifierCache = new Map<string, string[]>();

/** Every module reachable from the entries, with the raw specifiers each one imports. */
export function walkImports(entries: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop()!;
    if (graph.has(file)) continue;
    let specifiers = specifierCache.get(file);
    if (!specifiers) {
      specifiers = [...fs.readFileSync(file, "utf8").matchAll(IMPORT)].map((match) => match[1] ?? match[2]!);
      specifierCache.set(file, specifiers);
    }
    graph.set(file, specifiers);
    for (const specifier of specifiers) {
      const resolved = resolveSourceImport(file, specifier);
      if (resolved) stack.push(resolved);
    }
  }
  return graph;
}

export function relativeSource(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join("/");
}
