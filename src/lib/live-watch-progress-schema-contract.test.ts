import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { LIVE_WATCH_PROGRESS_MAX_SECONDS } from "@/lib/live-watch-progress";
import { BETA_GATED_FEATURES } from "@/lib/vendor-feature-toggles";

describe("live watch progress schema contract (Q-11 viewer_watch_progress)", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const migration = fs.readFileSync("prisma/migrations/20261118090000_live_watch_progress/migration.sql", "utf8");
  const model = /model LiveWatchProgress \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";

  it("keeps the Prisma model and the additive migration aligned", () => {
    expect(model).not.toBe("");
    for (const field of ["vendorId", "liveId", "formSubmissionId", "watchedSeconds", "firstCreditedAt", "lastCreditedAt"]) {
      expect(model).toContain(field);
      expect(migration).toContain(`"${field}"`);
    }
    expect(model).toContain("@@unique([vendorId, formSubmissionId])");
    expect(model).toContain("@@index([liveId, formSubmissionId])");
    expect(model).toContain("@@index([vendorId, lastCreditedAt])");
    // The database ceiling is the writer's ceiling.
    expect(migration).toContain(`CHECK ("watchedSeconds" BETWEEN 0 AND ${LIVE_WATCH_PROGRESS_MAX_SECONDS})`);
    expect(migration).toContain(`CHECK ("lastCreditedAt" >= "firstCreditedAt")`);
    // Additive only: no statement changes or removes existing rows or objects.
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b/mu);
    expect(migration).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
  });

  it("binds every row to its tenant's Live and to a registration of that Live", () => {
    expect(migration).toContain('FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("liveId", "formSubmissionId") REFERENCES "FormSubmission"("liveId", "id") ON DELETE CASCADE');
    expect(migration).toContain('ALTER TABLE "LiveWatchProgress" ENABLE ROW LEVEL SECURITY;');
    expect(migration).not.toMatch(/\bGRANT\b/iu);
  });

  it("allows the automation_watch_progress grant in its own migration, as a superset of every earlier grant", () => {
    const grant = fs.readFileSync("prisma/migrations/20261118090200_automation_watch_progress_grant/migration.sql", "utf8");
    expect(BETA_GATED_FEATURES).toContain("automation_watch_progress");
    // Later grants (automation_watch_duration, 20261118100100) are added in their own migrations.
    for (const feature of BETA_GATED_FEATURES.filter((value) => value !== "automation_watch_duration")) expect(grant).toContain(`'${feature}'`);
    expect(grant.match(/\bDROP CONSTRAINT\b/gu)).toEqual(["DROP CONSTRAINT"]);
    expect(grant).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|CREATE)\b/mu);
    expect(grant).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
  });

  it("allows the automation_watch_duration grant in its own migration, as a superset of every earlier grant", () => {
    const grant = fs.readFileSync("prisma/migrations/20261118100100_automation_watch_duration_grant/migration.sql", "utf8");
    expect(BETA_GATED_FEATURES).toContain("automation_watch_duration");
    for (const feature of BETA_GATED_FEATURES) expect(grant).toContain(`'${feature}'`);
    expect(grant.match(/\bDROP CONSTRAINT\b/gu)).toEqual(["DROP CONSTRAINT"]);
    expect(grant).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|CREATE)\b/mu);
    expect(grant).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
  });

  it("switches off only active webinar_attended_duration_gte rules, without touching the schema", () => {
    const pause = fs.readFileSync("prisma/migrations/20261118100000_pause_webinar_attended_duration_rules/migration.sql", "utf8");
    const statements = pause.replace(/--.*$/gmu, "").split(";").map((statement) => statement.trim()).filter(Boolean);
    expect(statements.filter((statement) => /^UPDATE\b/u.test(statement))).toEqual([expect.stringMatching(/"trigger" = 'webinar_attended_duration_gte'\s+AND "isActive" = true$/u)]);
    expect(pause.replace(/--.*$/gmu, "")).not.toMatch(/\b(ALTER|DROP|DELETE|INSERT|CREATE)\b/u);
    expect(pause).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
  });

  it("stores no personal data or token", () => {
    for (const forbidden of ["email", "name", "phone", "token", "cookie", "ip"]) {
      expect(model.toLowerCase()).not.toMatch(new RegExp(`^\\s+${forbidden}\\w*\\s`, "mu"));
    }
  });
});
