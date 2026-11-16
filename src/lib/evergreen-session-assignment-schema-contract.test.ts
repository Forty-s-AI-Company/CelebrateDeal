import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("evergreen session assignment schema contract", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const migration = fs.readFileSync(
    "prisma/migrations/20261113090000_evergreen_session_assignment/migration.sql",
    "utf8",
  );
  const model = /model EvergreenSessionAssignment \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";

  it("keeps the Prisma model and the additive migration aligned", () => {
    expect(model).not.toBe("");
    for (const field of ["vendorId", "liveId", "formSubmissionId", "sessionStartAt", "scheduleFingerprint", "assignedAt", "updatedAt"]) {
      expect(model).toContain(field);
      expect(migration).toContain(`"${field}"`);
    }
    expect(model).toContain("@@unique([vendorId, formSubmissionId])");
    expect(model).toContain("@@index([vendorId, liveId, sessionStartAt])");
  });

  it("binds every row to its tenant's Live and to a registration of that Live", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE',
    );
    expect(migration).toContain(
      'FOREIGN KEY ("liveId", "formSubmissionId") REFERENCES "FormSubmission"("liveId", "id") ON DELETE CASCADE',
    );
    expect(migration).toContain('ALTER TABLE "EvergreenSessionAssignment" ENABLE ROW LEVEL SECURITY;');
    expect(migration).not.toMatch(/\bGRANT\b/iu);
  });

  it("stores no personal data or token", () => {
    for (const forbidden of ["email", "name", "phone", "token", "cookie"]) {
      expect(model.toLowerCase()).not.toMatch(new RegExp(`^\\s+${forbidden}\\w*\\s`, "mu"));
    }
  });
});
