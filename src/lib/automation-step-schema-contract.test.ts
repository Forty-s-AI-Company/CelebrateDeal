import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTOMATION_STEP_MAX_DELAY_MINUTES,
  AUTOMATION_STEP_MIN_DELAY_MINUTES,
  MAX_AUTOMATION_RULE_STEPS,
} from "@/lib/automation-delayed-steps";
import { AUTOMATION_STEP_EMAIL_TRIGGER } from "@/lib/automation-email-trigger";
import { DELAYED_STEP_EMAIL_TRIGGERS, SEQUENCE_EMAIL_TRIGGER } from "@/lib/delayed-step-runs";
import { BETA_GATED_FEATURES } from "@/lib/vendor-feature-toggles";
import { MAX_EMAIL_SEQUENCE_STEPS, SEQUENCE_STEP_MAX_DELAY_MINUTES, SEQUENCE_STEP_MIN_DELAY_MINUTES } from "@/lib/email-sequence-rules";

describe("F-4 PR 2 automation step schema contract", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const migration = fs.readFileSync("prisma/migrations/20261114090000_automation_rule_steps/migration.sql", "utf8");
  const validate = fs.readFileSync("prisma/migrations/20261114090100_automation_rule_steps_validate/migration.sql", "utf8");
  const grant = fs.readFileSync("prisma/migrations/20261114090200_automation_delayed_steps_grant/migration.sql", "utf8");
  /** The SQL without its comment lines. */
  const statementsOf = (sql: string) => sql.replace(/^\s*--.*$/gmu, "");
  const modelOf = (name: string) => new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, "u").exec(schema)?.[0] ?? "";

  it("keeps the Prisma model, the run columns and the migration aligned", () => {
    const step = modelOf("AutomationRuleStep");
    for (const field of ["vendorId", "ruleId", "delayMinutes", "condition", "actions", "isActive"]) {
      expect(step, field).toMatch(new RegExp(`^\\s+${field}\\s`, "mu"));
    }
    expect(step).toContain("@relation(fields: [vendorId, ruleId], references: [vendorId, id], onDelete: Cascade)");
    expect(step).toContain("@@unique([vendorId, ruleId, delayMinutes])");
    expect(migration).toContain('CREATE TABLE "AutomationRuleStep"');
    expect(migration).toContain('ALTER TABLE "AutomationRuleStep" ENABLE ROW LEVEL SECURITY;');
    const run = modelOf("DelayedStepRun");
    for (const field of ["automationRuleId", "sourceExecutionLogId", "consultationBookingId"]) {
      expect(run, field).toMatch(new RegExp(`^\\s+${field}\\s+String\\?`, "mu"));
      expect(migration).toContain(`ADD COLUMN     "${field}" TEXT`);
    }
    expect(run).toContain("@@unique([vendorId, automationRuleId, sourceExecutionLogId])");
    expect(migration).toContain('CREATE UNIQUE INDEX "DelayedStepRun_vendorId_automationRuleId_sourceExecutionLog_key"');
  });

  it("binds every new reference to its tenant and replaces the F-3 CHECK only after validating", () => {
    expect(migration).toContain('FOREIGN KEY ("vendorId", "ruleId") REFERENCES "AutomationRule"("vendorId", "id") ON DELETE CASCADE');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "automationRuleId") REFERENCES "AutomationRule"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "sourceExecutionLogId") REFERENCES "AutomationExecutionLog"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID');
    expect(migration).toContain('FOREIGN KEY ("vendorId", "consultationBookingId") REFERENCES "ConsultationBooking"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID');
    expect(migration).toContain('CHECK (num_nonnulls("emailSequenceId", "automationRuleId") = 1) NOT VALID');
    // The first file never drops anything; the second drops only the old CHECK, last.
    expect(statementsOf(migration)).not.toMatch(/\bDROP\b/u);
    expect(statementsOf(validate).match(/\bDROP\b/gu)).toEqual(["DROP"]);
    expect(validate.trim().endsWith('ALTER TABLE "DelayedStepRun" DROP CONSTRAINT "DelayedStepRun_definition_check";')).toBe(true);
    expect(statementsOf(validate)).not.toMatch(/\b(CREATE|INSERT|UPDATE|DELETE|ADD)\b/u);
    for (const sql of [migration, validate]) {
      expect(sql).toContain("pg_catalog.set_config('lock_timeout', '5s', true)");
      expect(sql).not.toMatch(/^\s*GRANT\b/imu);
      expect(sql).not.toContain('ALTER TABLE "Vendor"');
    }
  });

  it("keeps the database limits equal to the application constants and to e-mail sequences", () => {
    expect(migration).toContain(`CHECK ("delayMinutes" BETWEEN ${AUTOMATION_STEP_MIN_DELAY_MINUTES} AND ${AUTOMATION_STEP_MAX_DELAY_MINUTES})`);
    expect([AUTOMATION_STEP_MIN_DELAY_MINUTES, AUTOMATION_STEP_MAX_DELAY_MINUTES]).toEqual([SEQUENCE_STEP_MIN_DELAY_MINUTES, SEQUENCE_STEP_MAX_DELAY_MINUTES]);
    expect(MAX_AUTOMATION_RULE_STEPS).toBe(MAX_EMAIL_SEQUENCE_STEPS);
    // parseAutomationRule accepts 1 to 10 actions.
    expect(migration).toContain('jsonb_array_length("actions") BETWEEN 1 AND 10');
    expect(DELAYED_STEP_EMAIL_TRIGGERS).toEqual([SEQUENCE_EMAIL_TRIGGER, AUTOMATION_STEP_EMAIL_TRIGGER]);
  });

  it("allows the automation_delayed_steps grant in its own migration, as a superset of every earlier grant (review M3)", () => {
    for (const feature of BETA_GATED_FEATURES) expect(grant).toContain(`'${feature}'`);
    expect(BETA_GATED_FEATURES).toContain("automation_delayed_steps");
    expect(statementsOf(grant).match(/^ALTER TABLE "Vendor"/gmu)).toHaveLength(2);
    expect(statementsOf(grant).match(/\bDROP CONSTRAINT\b/gu)).toEqual(["DROP CONSTRAINT"]);
    expect(statementsOf(grant)).not.toMatch(/\b(CREATE|INSERT|UPDATE|DELETE)\b/u);
    expect(grant).toContain("pg_catalog.set_config('lock_timeout', '5s', true)");
  });

  it("stores no address, name or token on a step or a run", () => {
    for (const model of ["AutomationRuleStep", "DelayedStepRun"]) {
      const block = modelOf(model).toLowerCase();
      for (const forbidden of ["email", "recipientemail", "name", "phone", "token", "cookie"]) {
        expect(block).not.toMatch(new RegExp(`^\\s+${forbidden}\\s`, "mu"));
      }
    }
  });
});
