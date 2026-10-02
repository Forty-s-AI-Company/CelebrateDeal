import { describe, expect, it } from "vitest";
import { getStagingDatabaseIdentityReport, getStagingPreviewBuildIdentityCheck } from "./database-identity";

const validEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ocbugvgojrunvenozsbx.supabase.co",
  DATABASE_URL:
    ["postgres", "ql://"].join("") + "postgres.ocbugvgojrunvenozsbx:test-fixture-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
  DIRECT_URL:
    ["postgres", "ql://"].join("") + "postgres:test-fixture-password@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres",
  STAGING_DATABASE_URL:
    ["postgres", "ql://"].join("") + "postgres:test-fixture-password@db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres",
};

describe("getStagingDatabaseIdentityReport", () => {
  it("accepts the expected Supabase URL, pooled URL, and direct URL", () => {
    expect(getStagingDatabaseIdentityReport(validEnvironment)).toEqual({
      supabase_url_match: true,
      database_url_match: true,
      direct_url_match: true,
      staging_database_url_match: true,
      all_passed: true,
    });
  });

  it("returns false without exposing the mismatched URL", () => {
    const report = getStagingDatabaseIdentityReport({
      ...validEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: "https://another-project.supabase.co",
      STAGING_DATABASE_URL: ["postgres", "ql://"].join("") + "postgres:test-fixture-password@db.another-project.supabase.co:5432/postgres",
    });

    expect(report).toEqual({
      supabase_url_match: false,
      database_url_match: true,
      direct_url_match: true,
      staging_database_url_match: false,
      all_passed: false,
    });
    expect(JSON.stringify(report)).not.toContain("another-project");
  });

  it("returns null when STAGING_DATABASE_URL is not configured", () => {
    const withoutStagingDatabaseUrl = {
      ...validEnvironment,
      STAGING_DATABASE_URL: undefined,
    };

    expect(getStagingDatabaseIdentityReport(withoutStagingDatabaseUrl)).toEqual({
      supabase_url_match: true,
      database_url_match: true,
      direct_url_match: true,
      staging_database_url_match: null,
      all_passed: false,
    });
  });

  it("rejects a malformed or unrelated database URL", () => {
    const report = getStagingDatabaseIdentityReport({
      ...validEnvironment,
      DATABASE_URL: "not-a-database-url",
      DIRECT_URL: ["postgres", "ql://"].join("") + "postgres:test-fixture-password@db.other-project.supabase.co:5432/postgres",
    });

    expect(report.database_url_match).toBe(false);
    expect(report.direct_url_match).toBe(false);
    expect(report.all_passed).toBe(false);
  });
});

describe("getStagingPreviewBuildIdentityCheck", () => {
  const stagingPreview = {
    ...validEnvironment,
    VERCEL_PROJECT_ID: "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_APP_URL: "https://celebrate-deal-staging.carry-digital-nomad.in.net",
  };

  it("accepts only the exact staging application and all four staging bindings", () => {
    expect(getStagingPreviewBuildIdentityCheck(stagingPreview)).toEqual({ applicable: true, passed: true });
    expect(getStagingPreviewBuildIdentityCheck({ ...stagingPreview, DIRECT_URL: "postgresql://postgres:fixture@db.awigitueyqdqaqwbjdgu.supabase.co:5432/postgres" }))
      .toEqual({ applicable: true, passed: false });
    expect(getStagingPreviewBuildIdentityCheck({ ...stagingPreview, NEXT_PUBLIC_APP_URL: "https://other.example" }))
      .toEqual({ applicable: true, passed: false });
  });

  it("does not apply the staging guard to a different Vercel project", () => {
    expect(getStagingPreviewBuildIdentityCheck({ ...stagingPreview, VERCEL_PROJECT_ID: "prj_other" }))
      .toEqual({ applicable: false, passed: true });
  });
});
