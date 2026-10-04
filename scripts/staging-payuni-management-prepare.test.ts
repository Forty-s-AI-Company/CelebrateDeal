import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertLinkedStagingProject,
  assertPrepareEnvironment,
  buildPrepareSql,
  runPrepare,
  sanitizedCliEnvironment,
  type PrepareInput,
} from "./staging-payuni-management-prepare";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
  "00000000-0000-4000-8000-000000000006",
  "00000000-0000-4000-8000-000000000007",
  "00000000-0000-4000-8000-000000000008",
];

function fixture(): PrepareInput {
  return {
    vendorId: ids[0], userId: ids[1], trackingId: ids[2], memberId: ids[3], auditId: ids[4],
    planIds: {
      "staging-payuni-starter": ids[5],
      "staging-payuni-growth": ids[6],
      "staging-payuni-team-pro": ids[7],
    },
    vendorPasswordHash: `scrypt:${"a".repeat(32)}:${"b".repeat(128)}`,
    userPasswordHash: `scrypt:${"c".repeat(32)}:${"d".repeat(128)}`,
  };
}

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED: "true",
    STAGING_PAYUNI_TEST_CHANGE_APPROVED: "true",
    STAGING_PAYUNI_TEST_ACCOUNT_EMAIL: "zeroyuanbrothers@gmail.com",
    PAYUNI_STAGING_PLAN_TEST_ENABLED: "false",
    VERCEL_ENV: "preview",
    VERCEL_PROJECT_ID: "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn",
    VERCEL_GIT_COMMIT_REF: "codex/prelaunch-engineering-20260929",
    NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
    NEXT_PUBLIC_SUPABASE_URL: "https://ocbugvgojrunvenozsbx.supabase.co",
  };
}

describe("fixed staging PAYUNi Management API prepare", () => {
  it("requires the exact local staging gates before any CLI call", async () => {
    const env = environment();
    expect(() => assertPrepareEnvironment(env)).not.toThrow();
    for (const [key, value] of [
      ["STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED", "false"],
      ["STAGING_PAYUNI_TEST_CHANGE_APPROVED", "false"],
      ["PAYUNI_STAGING_PLAN_TEST_ENABLED", "true"],
      ["VERCEL_PROJECT_ID", "prj_other"],
      ["VERCEL_GIT_COMMIT_REF", "other-branch"],
      ["NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co"],
      ["STAGING_PAYUNI_TEST_ACCOUNT_EMAIL", "other@example.test"],
    ] as const) {
      expect(() => assertPrepareEnvironment({ ...env, [key]: value })).toThrow("PREPARE_ENVIRONMENT_INVALID");
    }
    await expect(runPrepare(["--inspect"], env)).rejects.toThrow("PREPARE_MODE_INVALID");
  });

  it("accepts only the exact linked project ref", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "staging-ref-test-"));
    const refDir = path.join(root, "supabase", ".temp");
    mkdirSync(refDir, { recursive: true });
    try {
      writeFileSync(path.join(refDir, "project-ref"), "ocbugvgojrunvenozsbx\n");
      expect(() => assertLinkedStagingProject(root)).not.toThrow();
      writeFileSync(path.join(refDir, "project-ref"), "awigitueyqdqaqwbjdgu\n");
      expect(() => assertLinkedStagingProject(root)).toThrow("LINKED_PROJECT_INVALID");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not pass inherited CLI target and database overrides to the child", () => {
    const sanitized = sanitizedCliEnvironment({
      NODE_ENV: "test", PATH: "synthetic-path", SUPABASE_WORKDIR: "other-project",
      SUPABASE_ACCESS_TOKEN: "unavailable", PGHOST: "other-host", PGSERVICEFILE: "other-file",
      DATABASE_URL: "unavailable", DIRECT_URL: "unavailable", STAGING_DATABASE_URL: "unavailable",
      NODE_OPTIONS: "--require other-code",
    });
    expect(sanitized).toEqual({ NODE_ENV: "test", PATH: "synthetic-path" });
  });

  it("builds one serializable transaction with exact rows and no activation", () => {
    const sql = buildPrepareSql(fixture());
    expect(sql).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;/u);
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("lock_timeout = '3s'");
    expect(sql).toContain("statement_timeout = '20s'");
    expect(sql).toContain("PREPARE_VENDOR_EXISTS");
    expect(sql).toContain("PREPARE_USER_EXISTS");
    expect(sql).toContain("PREPARE_TEST_PLANS_EXIST");
    expect(sql).toContain("IF affected <> 3 THEN RAISE EXCEPTION 'PREPARE_PLAN_COUNT'");
    expect(sql).toContain("IF matched <> 3 THEN RAISE EXCEPTION 'PREPARE_PLAN_VERIFICATION_FAILED'");
    for (const table of ["Vendor", "TrackingSetting", "User", "VendorMember", "AuditLog", "BillingPlan"]) {
      expect(sql).toContain(`INSERT INTO public."${table}"`);
    }
    for (const [code, price] of [["staging-payuni-starter", 100], ["staging-payuni-growth", 200], ["staging-payuni-team-pro", 300]] as const) {
      expect(sql).toContain(`'${code}', ${price},`);
    }
    expect(sql).toContain("false, NULL, CURRENT_TIMESTAMP");
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|ON CONFLICT)\b/iu);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/u);
  });

  it("rejects reused IDs, malformed hashes, and equal hashes", () => {
    const input = fixture();
    expect(() => buildPrepareSql({ ...input, userId: input.vendorId })).toThrow("PREPARE_INPUT_INVALID");
    expect(() => buildPrepareSql({ ...input, vendorPasswordHash: "plaintext" })).toThrow("PREPARE_INPUT_INVALID");
    expect(() => buildPrepareSql({ ...input, userPasswordHash: input.vendorPasswordHash })).toThrow("PREPARE_INPUT_INVALID");
  });
});
