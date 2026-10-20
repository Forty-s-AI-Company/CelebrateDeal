import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function collect(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/^(global-)?error\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

// Next 16.3.8 的 ErrorBoundary 只傳 { error, reset, retry }。
// 這個測試直接掃描原始碼，避免元件 prop 名稱與 runtime 實際傳入者脫節（F-077／F-078）。
describe("error boundary props", () => {
  const files = collect(join(process.cwd(), "src", "app"));

  it("finds the error boundaries", () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  for (const file of files) {
    it(`${file.split("src")[1]} 使用 retry 而非 unstable_retry／reset`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/unstable_retry/);
      expect(source).not.toMatch(/\breset\b/);
      expect(source).toMatch(/\bretry\b/);
    });
  }

  it("runtime ErrorBoundary 確實傳入 retry 而不是 unstable_retry", () => {
    const runtime = readFileSync(
      join(process.cwd(), "node_modules", "next", "dist", "client", "components", "error-boundary.js"),
      "utf8",
    );
    expect(runtime).toMatch(/retry:\s*this\.retry/);
    expect(runtime).not.toMatch(/unstable_retry/);
  });
});
