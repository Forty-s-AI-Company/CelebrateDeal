import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.resolve("src/app/globals.css"), "utf8");
const token = (name: string) => new RegExp(`--${name}: *(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? "";

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("F-121 design tokens", () => {
  it("keeps form control borders and the focus ring at 3:1 against white", () => {
    expect(contrast(token("border-control"), "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast(token("focus-ring"), "#ffffff")).toBeGreaterThanOrEqual(3);
  });
  it("uses the focus-ring token for the global :focus-visible outline", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus-ring\)/);
  });
  it("does not use text-slate-400 for light-surface text in the shared shell and form components", () => {
    for (const file of ["src/components/app-shell.tsx", "src/components/ui.tsx"]) {
      expect(fs.readFileSync(path.resolve(file), "utf8")).not.toContain("text-slate-400");
    }
  });
});
