import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import * as sensitiveData from "@/lib/sensitive-data";

const SRC = join(process.cwd(), "src");

function collect(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = collect(SRC).map((full) => ({
  path: relative(SRC, full).split(sep).join("/"),
  source: readFileSync(full, "utf8"),
}));

// 根金鑰（CSRF_SECRET／JOB_SECRET）只能進 KDF。直接拿根金鑰 HMAC 攻擊者可控的輸入，
// 會讓輸出成為衍生金鑰的 oracle（見 docs/staging-production-env-vars.md §7 第 6 點）。
describe("sensitive-data root key boundary", () => {
  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.path === "lib/csrf.ts")).toBe(true);
  });

  it("keeps the generic raw-root KDF helper module-private", () => {
    const exported = Object.keys(sensitiveData);
    expect(exported).not.toContain("deriveKeyFromRootSecret");
    expect(exported.filter((name) => /root/i.test(name))).toEqual([]);
  });

  it("lets only csrf.ts import deriveCsrfMacKey", () => {
    const importers = files
      .filter((file) => file.path !== "lib/sensitive-data.ts" && /\bderiveCsrfMacKey\b/.test(file.source))
      .map((file) => file.path);
    expect(importers).toEqual(["lib/csrf.ts"]);
  });

  it("never pairs createHmac with the raw CSRF_SECRET outside the KDF and CSRF modules", () => {
    const offenders = files
      .filter((file) => !["lib/sensitive-data.ts", "lib/csrf.ts"].includes(file.path))
      .filter((file) => /\bcreateHmac\b/.test(file.source) && /\bCSRF_SECRET\b/.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("does not reference the raw-root KDF helper anywhere else", () => {
    const offenders = files
      .filter((file) => file.path !== "lib/sensitive-data.ts" && /\bderiveKeyFromRootSecret\b/.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});
