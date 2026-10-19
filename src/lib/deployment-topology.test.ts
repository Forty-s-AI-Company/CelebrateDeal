import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  configuredVercelRegion,
  getDatabasePoolerChecks,
  getDeploymentTopologyChecks,
  getRegionAlignmentChecks,
  supabasePoolerAwsRegion,
} from "./deployment-topology";

// Synthetic, non-routable values only.
const tokyoPooler = "postgresql://user.ref:synthetic-password@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5";
const mumbaiPooler = "postgresql://user.ref:synthetic-password@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5";
const directUrl = "postgresql://postgres:synthetic-password@db.synthetic-ref.supabase.co:5432/postgres";

function byKey(checks: ReturnType<typeof getDeploymentTopologyChecks>) {
  return Object.fromEntries(checks.map((check) => [check.key, check]));
}

describe("deployment topology checks (F-090)", () => {
  it("only applies to Vercel production and preview builds", () => {
    expect(getDeploymentTopologyChecks({ DATABASE_URL: directUrl }, { regions: ["hnd1"] })).toEqual([]);
    expect(getDeploymentTopologyChecks({ VERCEL_ENV: "development", DATABASE_URL: directUrl }, { regions: ["hnd1"] })).toEqual([]);
    expect(getDeploymentTopologyChecks({ VERCEL_ENV: "preview", DATABASE_URL: tokyoPooler }, { regions: ["hnd1"] }).length).toBeGreaterThan(0);
  });

  it("passes a Tokyo function with a Tokyo transaction pooler that carries pool parameters", () => {
    const checks = byKey(getDeploymentTopologyChecks({ VERCEL_ENV: "preview", DATABASE_URL: tokyoPooler }, { regions: ["hnd1"] }));
    expect(Object.values(checks).every((check) => check.status === "pass")).toBe(true);
    expect(checks.DATABASE_REGION.message).toContain("hnd1");
    expect(checks.DATABASE_REGION.message).toContain("ap-northeast-1");
  });

  it("warns about a cross-region Production database without failing", () => {
    const checks = byKey(getDeploymentTopologyChecks({ VERCEL_ENV: "production", DATABASE_URL: mumbaiPooler }, { regions: ["hnd1"] }));
    expect(checks.DATABASE_REGION).toMatchObject({ status: "warning" });
    expect(checks.DATABASE_REGION.message).toContain("ap-south-1");
  });

  it("lets configuration choose the function region instead of hard-coding hnd1", () => {
    const checks = byKey(getDeploymentTopologyChecks(
      { VERCEL_ENV: "production", DATABASE_URL: mumbaiPooler, EXPECTED_FUNCTION_REGION: "bom1" },
      { regions: ["hnd1"] },
    ));
    expect(checks.FUNCTION_REGION.message).toContain("bom1");
    expect(checks.DATABASE_REGION.status).toBe("pass");
  });

  it("prefers the runtime VERCEL_REGION and flags a drift from the expected region", () => {
    const checks = byKey(getRegionAlignmentChecks({ VERCEL_REGION: "iad1", DATABASE_URL: tokyoPooler }, "hnd1"));
    expect(checks.VERCEL_REGION).toMatchObject({ status: "warning" });
    expect(checks.DATABASE_REGION).toMatchObject({ status: "warning" });
  });

  it("warns when no region or database region can be determined", () => {
    const checks = byKey(getRegionAlignmentChecks({ DATABASE_URL: directUrl }, null));
    expect(checks.FUNCTION_REGION.status).toBe("warning");
    expect(checks.DATABASE_REGION.status).toBe("warning");
    expect(byKey(getRegionAlignmentChecks({ DATABASE_URL: directUrl, DATABASE_REGION: "ap-northeast-1" }, "hnd1")).DATABASE_REGION.status).toBe("pass");
    expect(byKey(getRegionAlignmentChecks({ DATABASE_URL: directUrl, DATABASE_REGION: "not a region" }, "hnd1")).DATABASE_REGION.status).toBe("warning");
  });

  it("warns about missing pooler, pgbouncer and connection_limit parameters", () => {
    expect(byKey(getDatabasePoolerChecks(directUrl))).toMatchObject({
      DATABASE_POOLER: { status: "warning" },
      DATABASE_CONNECTION_LIMIT: { status: "warning" },
    });
    const noPgbouncer = byKey(getDatabasePoolerChecks("postgresql://u:p@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?connection_limit=0"));
    expect(noPgbouncer.DATABASE_POOLER_PGBOUNCER.status).toBe("warning");
    expect(noPgbouncer.DATABASE_CONNECTION_LIMIT.status).toBe("warning");
    expect(getDatabasePoolerChecks(undefined)).toEqual([]);
    expect(getDatabasePoolerChecks("not a url")).toEqual([]);
  });

  it("never echoes database hosts or credentials", () => {
    const output = JSON.stringify(getDeploymentTopologyChecks(
      { VERCEL_ENV: "production", DATABASE_URL: mumbaiPooler, VERCEL_REGION: "hnd1" },
      { regions: ["hnd1"] },
    ));
    expect(output).not.toContain("synthetic-password");
    expect(output).not.toContain("pooler.supabase.com");
    expect(output).not.toContain("user.ref");
  });

  it("parses region and pooler identifiers strictly", () => {
    expect(configuredVercelRegion({ regions: ["HND1"] })).toBe("hnd1");
    expect(configuredVercelRegion({ regions: ["hnd1", "iad1"] })).toBeNull();
    expect(configuredVercelRegion({ regions: ["../x"] })).toBeNull();
    expect(configuredVercelRegion(undefined)).toBeNull();
    expect(supabasePoolerAwsRegion(tokyoPooler)).toBe("ap-northeast-1");
    expect(supabasePoolerAwsRegion("postgresql://u:p@aws-0-ap-northeast-1.pooler.supabase.com.evil.test:6543/db")).toBeNull();
    expect(supabasePoolerAwsRegion(directUrl)).toBeNull();
  });

  it("pins both checked-in Vercel configs to the same single function region", () => {
    const read = (file: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8")) as unknown;
    expect(configuredVercelRegion(read("vercel.json"))).toBe("hnd1");
    expect(configuredVercelRegion(read("vercel.staging.json"))).toBe("hnd1");
  });
});
