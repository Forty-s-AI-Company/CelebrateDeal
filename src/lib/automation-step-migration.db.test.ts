import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

/**
 * F-4 PR 2 migrations on the disposable PostgreSQL database built by
 * `prisma migrate deploy`: 20261114090000_automation_rule_steps adds the
 * DelayedStepRun constraints NOT VALID and 20261114090100_automation_rule_steps_validate
 * validates them and drops the F-3 CHECK.
 *
 * Prisma neither declares nor diffs CHECK constraints, so each one is asserted
 * by its catalog definition and by writes. The compatibility test replays the
 * constraint statements of both files, read from the files themselves, over
 * e-mail sequence runs written the F-3 way, inside a transaction that is
 * rolled back.
 */
const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const ADD = readFileSync(path.join(MIGRATIONS, "20261114090000_automation_rule_steps/migration.sql"), "utf8");
const VALIDATE = readFileSync(path.join(MIGRATIONS, "20261114090100_automation_rule_steps_validate/migration.sql"), "utf8");
const ADD_STATEMENTS = ADD.match(/^ALTER TABLE "DelayedStepRun" ADD CONSTRAINT[\s\S]*?;$/gmu) ?? [];
const VALIDATE_STATEMENTS = VALIDATE.match(/^ALTER TABLE "DelayedStepRun" (?:VALIDATE|DROP) CONSTRAINT [^;]+;$/gmu) ?? [];
const NEW_CONSTRAINTS = [
  "DelayedStepRun_vendorId_automationRuleId_fkey",
  "DelayedStepRun_vendorId_sourceExecutionLogId_fkey",
  "DelayedStepRun_vendorId_consultationBookingId_fkey",
  "DelayedStepRun_definition_exactly_one_check",
  "DelayedStepRun_automation_reference_check",
];

const db = getDb();
const vendorIds: string[] = [];

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function currentSchema() {
  const [row] = await db.$queryRaw<Array<{ schema: string }>>`SELECT pg_catalog.current_schema() AS schema`;
  return row!.schema;
}

async function constraints(names: string[], client: Pick<Prisma.TransactionClient, "$queryRaw"> = db) {
  const schema = await currentSchema();
  return client.$queryRaw<Array<{ name: string; definition: string; validated: boolean }>>`
    SELECT c.conname AS name, pg_catalog.pg_get_constraintdef(c.oid) AS definition, c.convalidated AS validated
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = ${schema} AND c.conname = ANY(${names}::text[])
     ORDER BY c.conname
  `;
}

/** A vendor with one Live, one active sequence and `count` registrations, written the way F-3 did. */
async function sequenceFixture(client: Prisma.TransactionClient, count: number) {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await client.vendor.create({ data: { name: "Migration", slug: `f4-migration-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const form = await client.registrationForm.create({ data: { vendorId: vendor.id, name: "F", slug: `f4-migration-form-${suffix}`, headline: "H", fields: [] } });
  const live = await client.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "L", slug: `f4-migration-live-${suffix}`, scheduledAt: new Date() } });
  const sequence = await client.emailSequence.create({ data: { vendorId: vendor.id, liveId: live.id, name: "Q", status: "active", activatedAt: new Date() } });
  const runIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const submission = await client.formSubmission.create({ data: { formId: form.id, liveId: live.id, name: "A", email: `a${index}-${suffix}@example.test` } });
    const id = `f4_migration_${suffix}_${index}`;
    const finished = index % 3;
    await client.$executeRaw`
      INSERT INTO "DelayedStepRun" ("id", "vendorId", "emailSequenceId", "formSubmissionId", "anchorAt", "nextRunAt", "status", "cancelReason", "cursorDelayMinutes", "updatedAt")
      VALUES (${id}, ${vendor.id}, ${sequence.id}, ${submission.id}, now(),
              ${finished === 0 ? new Date() : null}, ${["active", "completed", "cancelled"][finished]!},
              ${finished === 2 ? "duplicate" : null}, ${finished === 1 ? 60 : -1}, now())
    `;
    runIds.push(id);
  }
  return { vendor, sequence, runIds };
}

/** Puts DelayedStepRun's constraints back to the F-3 state (the new columns stay, all NULL for sequence runs). */
async function backToF3(tx: Prisma.TransactionClient) {
  for (const name of NEW_CONSTRAINTS) await tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" DROP CONSTRAINT "${name}"`);
  await tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_definition_check" CHECK ("emailSequenceId" IS NOT NULL)`);
}

class Rollback extends Error {}

async function rolledBack(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(db.$transaction(async (tx) => {
    await work(tx);
    throw new Rollback("rollback");
  }, { timeout: 60_000, maxWait: 10_000 })).rejects.toBeInstanceOf(Rollback);
}

describe("F-4 PR 2 DelayedStepRun constraints", () => {
  it("reads the constraint statements from both migrations", () => {
    expect(ADD_STATEMENTS).toHaveLength(NEW_CONSTRAINTS.length);
    expect(ADD_STATEMENTS.every((statement) => statement.includes("NOT VALID"))).toBe(true);
    expect(VALIDATE_STATEMENTS.map((statement) => statement.replace(/^ALTER TABLE "DelayedStepRun" /u, ""))).toEqual([
      ...NEW_CONSTRAINTS.map((name) => `VALIDATE CONSTRAINT "${name}";`),
      'DROP CONSTRAINT "DelayedStepRun_definition_check";',
    ]);
  });

  it("keeps every new constraint validated with its exact definition and the F-3 CHECK dropped", async () => {
    const rows = await constraints([...NEW_CONSTRAINTS, "DelayedStepRun_definition_check"]);
    expect(rows).toEqual([
      { name: "DelayedStepRun_automation_reference_check", validated: true, definition: `CHECK (((("automationRuleId" IS NULL) = ("sourceExecutionLogId" IS NULL)) AND (("automationRuleId" IS NULL) OR (("subjectKeyHash" IS NOT NULL) AND (num_nonnulls("formSubmissionId", "consultationBookingId") = 1))) AND (("consultationBookingId" IS NULL) OR ("automationRuleId" IS NOT NULL))))` },
      { name: "DelayedStepRun_definition_exactly_one_check", validated: true, definition: `CHECK ((num_nonnulls("emailSequenceId", "automationRuleId") = 1))` },
      { name: "DelayedStepRun_vendorId_automationRuleId_fkey", validated: true, definition: `FOREIGN KEY ("vendorId", "automationRuleId") REFERENCES "AutomationRule"("vendorId", id) ON UPDATE CASCADE ON DELETE CASCADE` },
      { name: "DelayedStepRun_vendorId_consultationBookingId_fkey", validated: true, definition: `FOREIGN KEY ("vendorId", "consultationBookingId") REFERENCES "ConsultationBooking"("vendorId", id) ON UPDATE CASCADE ON DELETE CASCADE` },
      { name: "DelayedStepRun_vendorId_sourceExecutionLogId_fkey", validated: true, definition: `FOREIGN KEY ("vendorId", "sourceExecutionLogId") REFERENCES "AutomationExecutionLog"("vendorId", id) ON UPDATE CASCADE ON DELETE CASCADE` },
    ]);
    const steps = await constraints(["AutomationRuleStep_delayMinutes_check", "AutomationRuleStep_condition_check", "AutomationRuleStep_actions_check", "AutomationRuleStep_vendorId_ruleId_fkey"]);
    expect(steps.map((row) => [row.name, row.validated])).toEqual([
      ["AutomationRuleStep_actions_check", true],
      ["AutomationRuleStep_condition_check", true],
      ["AutomationRuleStep_delayMinutes_check", true],
      ["AutomationRuleStep_vendorId_ruleId_fkey", true],
    ]);
  });

  it("validates over existing e-mail sequence runs, which keep every value", async () => {
    await rolledBack(async (tx) => {
      await backToF3(tx);
      const fixture = await sequenceFixture(tx, 6);
      const before = await tx.delayedStepRun.findMany({ where: { id: { in: fixture.runIds } }, orderBy: { id: "asc" } });
      for (const statement of [...ADD_STATEMENTS, ...VALIDATE_STATEMENTS]) await tx.$executeRawUnsafe(statement);
      const rows = await constraints([...NEW_CONSTRAINTS, "DelayedStepRun_definition_check"], tx);
      expect(rows.map((row) => [row.name, row.validated])).toEqual([...NEW_CONSTRAINTS].sort().map((name) => [name, true]));
      await expect(tx.delayedStepRun.findMany({ where: { id: { in: fixture.runIds } }, orderBy: { id: "asc" } })).resolves.toEqual(before);
      expect(before.every((run) => run.emailSequenceId === fixture.sequence.id && run.automationRuleId === null && run.sourceExecutionLogId === null && run.consultationBookingId === null)).toBe(true);
    });
  });

  it("fails the validation migration on a row that breaks a new rule, leaving the constraint NOT VALID", async () => {
    await rolledBack(async (tx) => {
      await backToF3(tx);
      const fixture = await sequenceFixture(tx, 1);
      // Possible only before the new constraints exist: a sequence run naming a booking.
      await tx.$executeRaw`UPDATE "DelayedStepRun" SET "consultationBookingId" = 'not-an-automation-run' WHERE "id" = ${fixture.runIds[0]!}`;
      for (const statement of ADD_STATEMENTS) {
        // The foreign key would not validate either; only the CHECK is under test here.
        if (statement.includes("consultationBookingId_fkey")) continue;
        await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_definition_exactly_one_check"`);
      await expect(tx.$executeRawUnsafe(`SAVEPOINT before_validate`)).resolves.toBe(0);
      await expect(tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "DelayedStepRun_automation_reference_check"`)).rejects.toThrow(/automation_reference_check/u);
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT before_validate`);
      const [row] = await constraints(["DelayedStepRun_automation_reference_check"], tx);
      expect(row).toMatchObject({ validated: false });
    });
  });

  it("rejects runs that name no definition or an incomplete automation reference", async () => {
    const suffix = randomUUID().slice(0, 12);
    const vendor = await db.vendor.create({ data: { name: "Checks", slug: `f4-checks-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
    vendorIds.push(vendor.id);
    const base = { vendorId: vendor.id, anchorAt: new Date(), nextRunAt: new Date() };
    await expect(db.delayedStepRun.create({ data: base })).rejects.toThrow(/DelayedStepRun_definition_exactly_one_check/u);
    const rule = await db.automationRule.create({ data: { vendorId: vendor.id, name: "R", trigger: "form_registered", condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "t" }] } });
    // Without its execution log, subject key or subject.
    await expect(db.delayedStepRun.create({ data: { ...base, automationRuleId: rule.id, subjectKeyHash: "k" } })).rejects.toThrow(/DelayedStepRun_automation_reference_check/u);
  });
});
