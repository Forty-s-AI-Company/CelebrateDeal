import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { BETA_GATED_FEATURES } from "@/lib/vendor-feature-toggles";

describe("live registration attendance schema contract (Q-11)", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const migration = fs.readFileSync(
    "prisma/migrations/20261117110000_live_registration_attendance/migration.sql",
    "utf8",
  );
  const model = /model LiveRegistrationAttendance \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";

  it("keeps the Prisma model and the additive migration aligned", () => {
    expect(model).not.toBe("");
    for (const field of ["vendorId", "liveId", "formSubmissionId", "firstAdmittedAt", "lastAdmittedAt"]) {
      expect(model).toContain(field);
      expect(migration).toContain(`"${field}"`);
    }
    expect(model).toContain("@@unique([vendorId, formSubmissionId])");
    expect(model).toContain("@@index([liveId, formSubmissionId])");
    // Additive only: no statement changes or removes existing rows or objects.
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b/mu);
    expect(migration).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
  });

  it("binds every row to its tenant's Live and to a registration of that Live", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("liveId", "formSubmissionId") REFERENCES "FormSubmission"("liveId", "id") ON DELETE CASCADE',
    );
    expect(migration).toContain('ALTER TABLE "LiveRegistrationAttendance" ENABLE ROW LEVEL SECURITY;');
    expect(migration).not.toMatch(/\bGRANT\b/iu);
  });

  it("allows the automation_form_no_show grant in its own migration, as a superset of every earlier grant (review M-1)", () => {
    const grant = fs.readFileSync("prisma/migrations/20261117110200_automation_form_no_show_grant/migration.sql", "utf8");
    expect(BETA_GATED_FEATURES).toContain("automation_form_no_show");
    // Every grant that existed at Q-11 form_no_show; later grants rebuild the CHECK in their own migration (live-watch-progress-schema-contract.test.ts).
    for (const feature of BETA_GATED_FEATURES.filter((value) => value !== "automation_watch_progress" && value !== "automation_watch_duration")) expect(grant).toContain(`'${feature}'`);
    expect(grant.match(/\bDROP CONSTRAINT\b/gu)).toEqual(["DROP CONSTRAINT"]);
    expect(grant).not.toMatch(/^\s*(UPDATE|DELETE|INSERT|CREATE)\b/mu);
    expect(grant).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
  });

  it("stores no personal data or token", () => {
    for (const forbidden of ["email", "name", "phone", "token", "cookie", "ip"]) {
      expect(model.toLowerCase()).not.toMatch(new RegExp(`^\\s+${forbidden}\\w*\\s`, "mu"));
    }
  });
});
