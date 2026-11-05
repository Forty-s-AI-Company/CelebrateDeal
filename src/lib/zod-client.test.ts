import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { globalConfig } from "zod/v4/core";
import { z } from "./zod-client";

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx)$/u.test(entry.name) && !/\.test\.(?:ts|tsx)$/u.test(entry.name) ? [full] : [];
  });
}

describe("client zod (F-156)", () => {
  it("parses without compiling code, so the CSP needs no 'unsafe-eval'", () => {
    expect(globalConfig.jitless).toBe(true);
    expect(z.object({ a: z.string() }).parse({ a: "x" })).toEqual({ a: "x" });
  });

  it("client components import zod only through @/lib/zod-client, and client instrumentation not at all", () => {
    const offenders = sourceFiles(path.resolve("src")).filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /^\s*["']use client["']/u.test(source) && /from\s+["']zod(?:\/[^"']*)?["']/u.test(source);
    });
    expect(offenders).toEqual([]);
    expect(fs.readFileSync(path.resolve("src/instrumentation-client.ts"), "utf8")).not.toMatch(/["']zod|zod-client/u);
  });
});
