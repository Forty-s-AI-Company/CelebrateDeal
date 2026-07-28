import { describe, expect, it } from "vitest";

import { isRuntimeArchive, scanContent } from "./secret-scan";

describe("repository secret scanner", () => {
  it("detects high-confidence private credentials without returning their values", () => {
    const privateKey = ["-----BEGIN PRIVATE", " KEY-----\nprivate-material\n-----END PRIVATE KEY-----"].join("");
    const ageIdentity = ["AGE", "SECRET", "KEY", "1EXAMPLE0123456789"].join("-");
    const findings = scanContent("unsafe.txt", `${privateKey}\n${ageIdentity}`);

    expect(findings.map((finding) => finding.category)).toEqual([
      "private_key",
      "age_identity",
    ]);
    expect(JSON.stringify(findings)).not.toContain("private-material");
    expect(JSON.stringify(findings)).not.toContain(ageIdentity);
  });

  it("rejects credential-bearing external database URLs but permits isolated loopback fixtures", () => {
    const external = ["postgresql://service:credential", "db.example.invalid:5432/production"].join("@");
    const local = ["postgresql://postgres:postgres", "localhost:54329/celebratedeal_test?schema=public"].join("@");

    expect(scanContent("external.txt", external)).toEqual([
      { file: "external.txt", line: 1, category: "external_database_url" },
    ]);
    expect(scanContent("local.txt", local)).toEqual([]);
  });

  it("classifies runtime backup artifacts without rejecting public recipient files", () => {
    expect(isRuntimeArchive("backup/production.dump")).toBe(true);
    expect(isRuntimeArchive("keys/offline.agekey")).toBe(true);
    expect(isRuntimeArchive("keys/recipient.agepub")).toBe(false);
    expect(isRuntimeArchive("prisma/migrations/migration.sql")).toBe(false);
  });

  it("requires an explicit marker for source-controlled rejection fixtures", () => {
    const fixture = ["postgresql://fixture:fixture", "external.example/production"].join("@");
    expect(scanContent("fixture.test.ts", fixture)).toHaveLength(1);
    expect(scanContent("fixture.test.ts", `${fixture} // secret-scan: allow-test-fixture`)).toEqual([]);
  });
});
