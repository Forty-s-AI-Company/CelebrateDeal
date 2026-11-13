import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

/**
 * Contract for the build-time type check (docs/operations/build-typecheck-memory.md).
 * `next build` type-checks tsconfig.build.json, which must cover every
 * application file and leave out only test files and test runners; the full
 * project, tests included, stays checked by `npm run typecheck`.
 */
const root = path.resolve(__dirname, "..");
const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");

function rootFiles(configName: string) {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, configName), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  if (!parsed) throw new Error(`${configName} could not be parsed`);
  expect(parsed.errors.filter((error) => error.category === ts.DiagnosticCategory.Error)).toEqual([]);
  return { parsed, files: new Set(parsed.fileNames.map(relative)) };
}

/** The only files the build check may leave out. */
function isTestOnly(file: string) {
  return /\.test\.(ts|tsx|mts)$/u.test(file)
    || file.startsWith("tests/")
    || file.startsWith("src/test/")
    || /^(vitest|playwright)(\.[a-z0-9-]+)?\.config\.ts$/u.test(file)
    || file === "prisma.playwright.config.ts";
}

describe("build-time type check configuration", () => {
  it("next.config.ts points the build at tsconfig.build.json and never skips the check", async () => {
    vi.doMock("@sentry/nextjs/config", () => ({ withSentryConfig: (config: unknown) => config }));
    const { default: config } = await import("../next.config");
    expect(config.typescript).toEqual({ tsconfigPath: "tsconfig.build.json" });
    expect(config.typescript).not.toHaveProperty("ignoreBuildErrors");
    vi.doUnmock("@sentry/nextjs/config");
  });

  it("tsconfig.build.json only narrows the file set: same compiler options and includes as tsconfig.json", () => {
    const raw = JSON.parse(readFileSync(path.join(root, "tsconfig.build.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["exclude", "extends"]);
    expect(raw.extends).toBe("./tsconfig.json");
    const full = rootFiles("tsconfig.json").parsed;
    const build = rootFiles("tsconfig.build.json").parsed;
    // Next's generated route types are still checked (inherited include).
    const buildSpecs = (build.raw as { include?: string[] }).include ?? (full.raw as { include: string[] }).include;
    expect(buildSpecs).toEqual(expect.arrayContaining([".next/types/**/*.ts", ".next/dev/types/**/*.ts"]));
    expect(build.options.strict).toBe(true);
    expect(build.options.strict).toBe(full.options.strict);
  });

  it("leaves out test files and test runners only, and keeps every application file", () => {
    const full = rootFiles("tsconfig.json").files;
    const build = rootFiles("tsconfig.build.json").files;
    const left = [...full].filter((file) => !build.has(file));
    expect(left.filter((file) => !isTestOnly(file))).toEqual([]);
    expect([...build].filter((file) => !full.has(file))).toEqual([]);
    expect([...build].filter(isTestOnly)).toEqual([]);
    // Sanity: the exclusion is in effect and real application code is kept.
    expect(left.length).toBeGreaterThan(500);
    for (const file of ["src/app/layout.tsx", "src/lib/auth.ts", "src/proxy.ts", "next.config.ts", "sentry.server.config.ts"]) expect(build).toContain(file);
  });

  it("no application file imports src/test, so leaving it out hides nothing the app uses", () => {
    const build = rootFiles("tsconfig.build.json").files;
    const importers = [...build]
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .filter((file) => /from\s+["'](@\/test\/|(\.\.?\/)+test\/)/u.test(readFileSync(path.join(root, file), "utf8")));
    expect(importers).toEqual([]);
  });

  it("the full type check scripts still cover every file, tests included, with an explicit heap", () => {
    const scripts = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts.typecheck).toBe("node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit");
    expect(scripts["typecheck:strict-index"]).toBe("node --max-old-space-size=6144 node_modules/typescript/bin/tsc --project tsconfig.strict-index.json --noEmit");
  });
});
