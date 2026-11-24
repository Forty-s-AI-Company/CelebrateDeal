import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// Every workflow step that runs a TypeScript script through tsx gets CommonJS output (the package is
// not "type": "module"). Two things then fail at load time, before the script can even refuse its
// configuration (2026-11-24 run 45340752525, payuni-lost-callback-proof.ts):
// - top-level await in the .ts entry point itself (esbuild cannot emit it as CommonJS);
// - a static import of a local .mjs/.js module whose import graph has top-level await (require() of
//   an async ES module). Such modules must be loaded with `await import()` inside a function.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { transformSync } = createRequire(fileURLToPath(import.meta.resolve("tsx")))("esbuild");
// `node --import tsx`, `npx tsx`, `tsx` and `./node_modules/.bin/tsx`.
const TSX_ENTRY = /(?:node\s+(?:--\S+\s+)*--import[ =]tsx(?:\s+--\S+)*|npx\s+tsx|(?:\.\/node_modules\/\.bin\/)?(?<![\w.-])tsx)\s+(scripts\/[\w./-]+\.ts)\b/gu;

function workflowTsxEntrypoints() {
  const directory = path.join(ROOT, ".github", "workflows");
  const entries = new Map();
  for (const name of fs.readdirSync(directory).filter((file) => /\.ya?ml$/u.test(file)).sort()) {
    const workflow = yaml.load(fs.readFileSync(path.join(directory, name), "utf8"));
    for (const job of Object.values(workflow?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step?.run !== "string") continue;
        for (const match of step.run.matchAll(TSX_ENTRY)) entries.set(match[1], `${name}: ${step.name ?? step.run}`);
      }
    }
  }
  return entries;
}

function topLevelAwaitErrors(source, loader) {
  try {
    transformSync(source, { loader, format: "cjs", logLevel: "silent" });
    return [];
  } catch (error) {
    return (error.errors ?? []).filter((item) => /top-level await/iu.test(item.text)).map((item) => `${item.location?.line ?? "?"}: ${item.text}`);
  }
}

const STATIC_LOCAL_IMPORT = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']|^\s*import\s*["'](\.{1,2}\/[^"']+)["']/gmu;

function resolveLocal(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** First chain from `file` (static local imports only) to a JavaScript module with top-level await. */
function asyncEsmChain(file, seen = new Set()) {
  if (seen.has(file)) return null;
  seen.add(file);
  const source = fs.readFileSync(file, "utf8");
  if (/\.(?:mjs|js)$/u.test(file) && topLevelAwaitErrors(source, "js").length > 0) return [file];
  for (const match of source.matchAll(STATIC_LOCAL_IMPORT)) {
    const target = resolveLocal(file, match[1] ?? match[2]);
    const chain = target ? asyncEsmChain(target, seen) : null;
    if (chain) return [file, ...chain];
  }
  return null;
}

test("workflow tsx entry points are discovered, including the lost-callback proof", () => {
  const entries = workflowTsxEntrypoints();
  assert.ok(entries.has("scripts/payuni-lost-callback-proof.ts"));
  assert.ok(entries.size >= 5, [...entries.keys()].join(", "));
  for (const entry of entries.keys()) assert.ok(fs.existsSync(path.join(ROOT, entry)), `${entry} is missing`);
});

test("no workflow tsx entry point uses top-level await or statically imports an async ES module", () => {
  const failures = [];
  for (const [entry, where] of workflowTsxEntrypoints()) {
    const file = path.join(ROOT, entry);
    const own = topLevelAwaitErrors(fs.readFileSync(file, "utf8"), "ts");
    if (own.length > 0) failures.push(`${entry} (${where}): ${own.join("; ")}`);
    const chain = asyncEsmChain(file);
    if (chain) failures.push(`${entry} (${where}): static import of an async ES module: ${chain.map((item) => path.relative(ROOT, item)).join(" -> ")}`);
  }
  assert.deepEqual(failures, []);
});
