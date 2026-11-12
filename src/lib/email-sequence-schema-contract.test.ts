import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR,
  MAX_EMAIL_SEQUENCE_STEPS,
  SEQUENCE_STEP_MAX_DELAY_MINUTES,
  SEQUENCE_STEP_MIN_DELAY_MINUTES,
} from "@/lib/email-sequence-rules";
import { DELAYED_STEP_CANCEL_REASONS } from "@/lib/delayed-step-runs";
import { BETA_GATED_FEATURES } from "@/lib/vendor-feature-toggles";

describe("F-3 email sequence schema contract", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const migration = fs.readFileSync("prisma/migrations/20261113150000_email_sequences/migration.sql", "utf8");
  const modelOf = (name: string) => new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, "u").exec(schema)?.[0] ?? "";

  it("keeps the three Prisma models and the additive migration aligned", () => {
    const fields: Record<string, string[]> = {
      EmailSequence: ["vendorId", "liveId", "name", "status", "activatedAt", "stopOnPurchase", "version"],
      EmailSequenceStep: ["vendorId", "emailSequenceId", "delayMinutes", "messageTemplateId", "isActive"],
      DelayedStepRun: ["vendorId", "emailSequenceId", "formSubmissionId", "subjectKeyHash", "recipientHash", "anchorAt", "cursorDelayMinutes", "nextRunAt", "status", "cancelReason", "claimedAt", "attemptCount"],
    };
    for (const [model, names] of Object.entries(fields)) {
      const block = modelOf(model);
      expect(block, model).not.toBe("");
      expect(migration).toContain(`CREATE TABLE "${model}"`);
      for (const field of names) expect(block, `${model}.${field}`).toMatch(new RegExp(`^\\s+${field}\\s`, "mu"));
      expect(migration).toContain(`ALTER TABLE "${model}" ENABLE ROW LEVEL SECURITY;`);
    }
    expect(modelOf("EmailSequenceStep")).toContain("@@unique([vendorId, emailSequenceId, delayMinutes])");
    expect(modelOf("DelayedStepRun")).toContain("@@unique([vendorId, emailSequenceId, formSubmissionId])");
    expect(modelOf("DelayedStepRun")).toContain("@@index([status, nextRunAt])");
    // One place per recipient and sequence (M3); the backfill's index (M4).
    expect(modelOf("DelayedStepRun")).toContain("@@unique([vendorId, emailSequenceId, recipientHash])");
    expect(migration).toContain('CREATE UNIQUE INDEX "DelayedStepRun_vendorId_emailSequenceId_recipientHash_key"');
    expect(modelOf("FormSubmission")).toContain("@@index([liveId, verificationStatus, verifiedAt])");
    expect(migration).toContain('CREATE INDEX "FormSubmission_liveId_verificationStatus_verifiedAt_idx"');
    // The Vendor CHECK is rebuilt last, so its ACCESS EXCLUSIVE lock is held briefly.
    expect(migration.trimEnd().endsWith(");")).toBe(true);
    expect(migration.lastIndexOf('ALTER TABLE "Vendor"')).toBeGreaterThan(migration.lastIndexOf("ENABLE ROW LEVEL SECURITY"));
    // F-4 adds automationRuleId with its own migration; PR 1 has only e-mail sequences.
    expect(modelOf("DelayedStepRun")).not.toMatch(/^\s+automationRuleId\s/mu);
    expect(migration).toContain('CHECK ("emailSequenceId" IS NOT NULL)');
  });

  it("binds children to their tenant with composite foreign keys", () => {
    expect(migration).toContain('FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "emailSequenceId") REFERENCES "EmailSequence"("vendorId", "id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "messageTemplateId") REFERENCES "MessageTemplate"("vendorId", "id") ON DELETE RESTRICT');
    expect(migration).toContain('FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE');
    expect(migration).not.toMatch(/^\s*GRANT\b/imu);
    expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/iu);
    // The only DROP is the beta-grant CHECK, re-added in the same migration as a superset.
    expect(migration.match(/\bDROP CONSTRAINT\b/gu)).toEqual(["DROP CONSTRAINT"]);
    expect(migration).toContain("pg_catalog.set_config('lock_timeout', '5s', true)");
  });

  it("keeps the database limits and values equal to the application constants", () => {
    expect(migration).toContain(`CHECK ("delayMinutes" BETWEEN ${SEQUENCE_STEP_MIN_DELAY_MINUTES} AND ${SEQUENCE_STEP_MAX_DELAY_MINUTES})`);
    for (const reason of DELAYED_STEP_CANCEL_REASONS) expect(migration).toContain(`'${reason}'`);
    for (const feature of BETA_GATED_FEATURES) expect(migration).toContain(`'${feature}'`);
    expect(MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR).toBe(5);
    expect(MAX_EMAIL_SEQUENCE_STEPS).toBe(10);
  });

  it("stores no address, name or token on a run", () => {
    const run = modelOf("DelayedStepRun").toLowerCase();
    for (const forbidden of ["email", "recipientemail", "name", "phone", "token", "cookie"]) {
      expect(run).not.toMatch(new RegExp(`^\\s+${forbidden}\\s`, "mu"));
    }
  });
});
