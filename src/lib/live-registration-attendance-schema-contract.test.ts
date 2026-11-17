import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("live registration attendance schema contract (Q-11)", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const migration = fs.readFileSync(
    "prisma/migrations/20261117090000_live_registration_attendance/migration.sql",
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

  it("stores no personal data or token", () => {
    for (const forbidden of ["email", "name", "phone", "token", "cookie", "ip"]) {
      expect(model.toLowerCase()).not.toMatch(new RegExp(`^\\s+${forbidden}\\w*\\s`, "mu"));
    }
  });
});
