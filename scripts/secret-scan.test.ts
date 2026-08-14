import { describe, expect, it } from "vitest";

import { isRuntimeArchive, scanContent } from "./secret-scan";

describe("secret scanner", () => {
  it("allows loopback test databases with a safe database name", () => {
    const url = ["postgresql", "://synthetic:synthetic@127.0.0.1:54329/celebratedeal_test"].join("");
    expect(scanContent("fixture.ts", url)).toEqual([]);
  });

  it("flags non-loopback and unsafe loopback database URLs", () => {
    const external = ["postgresql", "://synthetic:synthetic@db.projectref.supabase.co:5432/test"].join("");
    const unsafeLoopback = ["postgresql", "://synthetic:synthetic@127.0.0.1:54329/synthetic"].join("");

    expect(scanContent("external-fixture.ts", external)).toEqual([
      { file: "external-fixture.ts", line: 1, category: "external_database_url" },
    ]);
    expect(scanContent("unsafe-loopback-fixture.ts", unsafeLoopback)).toEqual([
      { file: "unsafe-loopback-fixture.ts", line: 1, category: "external_database_url" },
    ]);
  });

  it("keeps an explicitly marked test fixture out of the scan", () => {
    const url = ["postgresql", "://synthetic:synthetic@db.projectref.supabase.co:5432/test"].join("");
    expect(scanContent("marked-fixture.ts", `${url} // secret-scan: allow-test-fixture`)).toEqual([]);
  });

  it("detects private key and live payment material without returning source text", () => {
    const privateKey = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    const paymentKey = ["sk", "_live_", "a".repeat(20)].join("");
    const findings = scanContent("sensitive-fixture.ts", `${privateKey}\n${paymentKey}`);

    expect(findings).toEqual([
      { file: "sensitive-fixture.ts", line: 1, category: "private_key" },
      { file: "sensitive-fixture.ts", line: 2, category: "live_payment_key" },
    ]);
    expect(JSON.stringify(findings)).not.toContain(privateKey);
    expect(JSON.stringify(findings)).not.toContain(paymentKey);
  });

  it("classifies runtime archives by extension", () => {
    expect(isRuntimeArchive("snapshot.pgdump")).toBe(true);
    expect(isRuntimeArchive("backup.BAK")).toBe(true);
    expect(isRuntimeArchive("evidence.json")).toBe(false);
  });
});
