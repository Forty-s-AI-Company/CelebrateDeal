import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("evergreen webinar schema contract", () => {
  it("keeps the Prisma model and additive migration aligned", () => {
    const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
    const migration = fs.readFileSync(
      "prisma/migrations/20260908230000_evergreen_webinar_vendor_settings/migration.sql",
      "utf8",
    );

    for (const field of [
      "isEvergreen",
      "evergreenScheduleMode",
      "evergreenIntervalMinutes",
      "evergreenDailyTimes",
      "evergreenSessionStartAt",
      "evergreenPitchAtSeconds",
      "evergreenConsultationAtSeconds",
      "evergreenPreviewEnabled",
      "evergreenPreviewRate",
    ]) {
      expect(schema).toContain(field);
      expect(migration).toContain(`\"${field}\"`);
    }
  });
});
