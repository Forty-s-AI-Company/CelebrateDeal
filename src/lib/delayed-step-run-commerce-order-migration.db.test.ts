import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import { getDb } from "@/lib/db";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";

/**
 * Q-09 migrations on the disposable PostgreSQL database built by
 * `prisma migrate deploy`: 20261117170000_delayed_step_run_commerce_order adds
 * DelayedStepRun.commerceOrderId with its foreign key and the new subject
 * CHECK NOT VALID; 20261117170100_delayed_step_run_commerce_order_validate
 * validates them, drops the F-4 subject CHECK and renames the new one to its
 * name.
 *
 * Prisma neither declares nor diffs CHECK constraints, so each one is asserted
 * by its catalog definition and by writes. The compatibility test replays the
 * constraint statements of both files, read from the files themselves, over
 * e-mail sequence runs and automation runs of a registration and a booking
 * written the F-4 way, inside a transaction that is rolled back.
 */
const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const ADD = readFileSync(path.join(MIGRATIONS, "20261117170000_delayed_step_run_commerce_order/migration.sql"), "utf8");
const VALIDATE = readFileSync(path.join(MIGRATIONS, "20261117170100_delayed_step_run_commerce_order_validate/migration.sql"), "utf8");
const F4_ADD = readFileSync(path.join(MIGRATIONS, "20261114090000_automation_rule_steps/migration.sql"), "utf8");
const ADD_STATEMENTS = ADD.match(/^ALTER TABLE "DelayedStepRun" ADD CONSTRAINT[\s\S]*?;$/gmu) ?? [];
const VALIDATE_STATEMENTS = VALIDATE.match(/^ALTER TABLE "DelayedStepRun" (?:VALIDATE|DROP|RENAME) CONSTRAINT [^;]+;$/gmu) ?? [];
/** The F-4 subject CHECK as F-4 wrote it (registration or booking), to put the table back to the state before Q-09. */
const F4_SUBJECT_CHECK = (F4_ADD.match(/^ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_automation_reference_check"[\s\S]*?;$/mu) ?? [""])[0];
const FK = "DelayedStepRun_vendorId_commerceOrderId_fkey";
const NEW_CHECK = "DelayedStepRun_automation_subject_check";
const SUBJECT_CHECK = "DelayedStepRun_automation_reference_check";
const SUBJECT_CHECK_DEFINITION = `CHECK (((("automationRuleId" IS NULL) = ("sourceExecutionLogId" IS NULL)) AND (("automationRuleId" IS NULL) OR (("subjectKeyHash" IS NOT NULL) AND (num_nonnulls("formSubmissionId", "consultationBookingId", "commerceOrderId") = 1))) AND (("automationRuleId" IS NOT NULL) OR (num_nonnulls("consultationBookingId", "commerceOrderId") = 0))))`;

const db = getDb();
const vendorIds: string[] = [];

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function currentSchema(client: Pick<Prisma.TransactionClient, "$queryRaw"> = db) {
  const [row] = await client.$queryRaw<Array<{ schema: string }>>`SELECT pg_catalog.current_schema() AS schema`;
  return row!.schema;
}

async function constraints(names: string[], client: Pick<Prisma.TransactionClient, "$queryRaw"> = db) {
  const schema = await currentSchema(client);
  return client.$queryRaw<Array<{ name: string; definition: string; validated: boolean }>>`
    SELECT c.conname AS name, pg_catalog.pg_get_constraintdef(c.oid) AS definition, c.convalidated AS validated
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = ${schema} AND t.relname = 'DelayedStepRun' AND c.conname = ANY(${names}::text[])
     ORDER BY c.conname
  `;
}

/** A vendor with a paid-shaped order (through the checkout path, so its envelopes are real). */
async function vendorWithOrder(label: string) {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({ data: { name: `Q-09 ${label}`, slug: `q09-migration-${key}`, email: `${key}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "商品", slug: `q09-product-${key}`, priceCents: 1_000, currency: "TWD", inventory: 10, isActive: true, fulfillmentTypeConfirmed: true } });
  const orderNumber = `Q09-${randomUUID()}`;
  const checkoutIdempotencyKey = randomUUID();
  const transaction = await createReservedPaymentTransaction({
    vendorId: vendor.id,
    productId: product.id,
    checkoutIdempotencyKey,
    transactionData: {
      vendorId: vendor.id, checkoutIdempotencyKey, providerName: "payuni", orderNumber, paymentMode: "platform",
      grossAmountCents: 1_000, netAmountCents: 1_000, currency: "TWD", status: "pending", metadata: { productId: product.id },
    },
    createCommerceOrder: async (tx, payment) => {
      await createCommerceOrderForCheckout(tx, {
        vendorId: vendor.id, productId: product.id, orderNumber, checkoutIdempotencyKey, paymentTransactionId: payment.id,
        totalAmountCents: 1_000, currency: "TWD", buyer: { name: "合成買家", email: `buyer-${key}@example.test`, phone: "0912345678" }, shipping: null,
      });
    },
  });
  const order = await db.commerceOrder.findFirstOrThrow({ where: { vendorId: vendor.id, primaryPaymentTransactionId: transaction.id } });
  const rule = await db.automationRule.create({ data: { vendorId: vendor.id, name: "付款", trigger: "payment_paid", condition: { type: "order_amount_gte", amountCents: 1 }, actions: [{ type: "add_customer_tag", tag: "t" }] } });
  const log = await db.automationExecutionLog.create({
    data: { vendorId: vendor.id, ruleId: rule.id, idempotencyKey: `q09-${randomUUID()}`, eventId: `payment-paid:${order.id}`, trigger: "payment_paid", subjectType: "buyer_order", subjectKeyHash: "k", status: "completed" },
  });
  return { vendor, order, rule, log };
}

/** Sequence runs and automation runs of a registration and a booking, written the way F-4 did (SQL, no order column). */
async function f4Runs(client: Prisma.TransactionClient) {
  const suffix = randomUUID().slice(0, 12);
  const vendor = await client.vendor.create({ data: { name: "F-4", slug: `q09-f4-${suffix}`, email: `f4-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const form = await client.registrationForm.create({ data: { vendorId: vendor.id, name: "F", slug: `q09-f4-form-${suffix}`, headline: "H", fields: [] } });
  const live = await client.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "L", slug: `q09-f4-live-${suffix}`, scheduledAt: new Date() } });
  const sequence = await client.emailSequence.create({ data: { vendorId: vendor.id, liveId: live.id, name: "Q", status: "active", activatedAt: new Date() } });
  const submission = await client.formSubmission.create({ data: { formId: form.id, liveId: live.id, name: "A", email: `a-${suffix}@example.test` } });
  const consultation = await client.consultationEvent.create({ data: { vendorId: vendor.id, title: "C", weeklySchedule: {}, intakeFormFields: [] } });
  const start = new Date(Date.now() + 86_400_000);
  const booking = await client.consultationBooking.create({ data: { vendorId: vendor.id, eventId: consultation.id, startTime: start, endTime: new Date(start.getTime() + 1_800_000), clientName: "C", clientEmail: `c-${suffix}@example.test`, clientPhone: "0912000000" } });
  const ids: string[] = [];
  for (const [index, trigger] of (["form_registered", "consultation_booked"] as const).entries()) {
    const rule = await client.automationRule.create({ data: { vendorId: vendor.id, name: trigger, trigger, condition: { type: "always" }, actions: [{ type: "add_customer_tag", tag: "t" }] } });
    const log = await client.automationExecutionLog.create({ data: { vendorId: vendor.id, ruleId: rule.id, idempotencyKey: `q09-f4-${suffix}-${index}`, eventId: `e-${index}`, trigger, subjectType: "buyer_registration", subjectKeyHash: "k", status: "completed" } });
    const id = `q09_f4_${suffix}_auto_${index}`;
    await client.$executeRaw`
      INSERT INTO "DelayedStepRun" ("id", "vendorId", "automationRuleId", "sourceExecutionLogId", "formSubmissionId", "consultationBookingId", "subjectKeyHash", "anchorAt", "nextRunAt", "status", "cursorDelayMinutes", "updatedAt")
      VALUES (${id}, ${vendor.id}, ${rule.id}, ${log.id}, ${index === 0 ? submission.id : null}, ${index === 1 ? booking.id : null}, 'k', now(),
              ${index === 0 ? new Date() : null}, ${index === 0 ? "active" : "completed"}, ${index === 0 ? -1 : 60}, now())
    `;
    ids.push(id);
  }
  const sequenceRun = `q09_f4_${suffix}_sequence`;
  await client.$executeRaw`
    INSERT INTO "DelayedStepRun" ("id", "vendorId", "emailSequenceId", "formSubmissionId", "anchorAt", "nextRunAt", "status", "cursorDelayMinutes", "updatedAt")
    VALUES (${sequenceRun}, ${vendor.id}, ${sequence.id}, ${submission.id}, now(), now(), 'active', -1, now())
  `;
  ids.push(sequenceRun);
  return ids.sort();
}

/** Puts the subject constraints back to the F-4 state (the column stays, NULL everywhere). */
async function backToF4(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" DROP CONSTRAINT "${FK}"`);
  await tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" DROP CONSTRAINT "${SUBJECT_CHECK}"`);
  await tx.$executeRawUnsafe(F4_SUBJECT_CHECK);
  await tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "${SUBJECT_CHECK}"`);
}

/** Every column but the new one, so a row's values before and after the migration compare equal. */
function rowsOf(client: Pick<Prisma.TransactionClient, "$queryRaw">, ids: string[]) {
  return client.$queryRaw<Array<{ row: unknown }>>`
    SELECT (to_jsonb(r) - 'commerceOrderId') AS row FROM "DelayedStepRun" r WHERE r."id" = ANY(${ids}::text[]) ORDER BY r."id"
  `;
}

class Rollback extends Error {}

async function rolledBack(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(db.$transaction(async (tx) => {
    await work(tx);
    throw new Rollback("rollback");
  }, { timeout: 60_000, maxWait: 10_000 })).rejects.toBeInstanceOf(Rollback);
}

describe("Q-09 DelayedStepRun.commerceOrderId", () => {
  it("reads the constraint statements from both migrations: NOT VALID first, the foreign key last; validate, drop, rename", () => {
    expect(F4_SUBJECT_CHECK).toContain("NOT VALID");
    expect(ADD_STATEMENTS).toHaveLength(2);
    expect(ADD_STATEMENTS.every((statement) => statement.trimEnd().endsWith("NOT VALID;"))).toBe(true);
    expect(ADD_STATEMENTS[0]).toContain(`"${NEW_CHECK}"`);
    expect(ADD_STATEMENTS[1]).toContain(`"${FK}" FOREIGN KEY ("vendorId", "commerceOrderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID`);
    // The foreign key (SHARE ROW EXCLUSIVE on CommerceOrder) is the file's last statement.
    expect(ADD.trimEnd().endsWith(ADD_STATEMENTS[1]!)).toBe(true);
    expect(VALIDATE_STATEMENTS.map((statement) => statement.replace(/^ALTER TABLE "DelayedStepRun" /u, ""))).toEqual([
      `VALIDATE CONSTRAINT "${FK}";`,
      `VALIDATE CONSTRAINT "${NEW_CHECK}";`,
      `DROP CONSTRAINT "${SUBJECT_CHECK}";`,
      `RENAME CONSTRAINT "${NEW_CHECK}" TO "${SUBJECT_CHECK}";`,
    ]);
    const statements = (sql: string) => sql.replace(/^\s*--.*$/gmu, "");
    // The first file drops and rewrites nothing; the second only validates, drops the old CHECK and renames.
    expect(statements(ADD)).not.toMatch(/\bDROP\b/u);
    expect(statements(ADD)).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b/mu);
    expect(statements(VALIDATE)).not.toMatch(/\b(CREATE|INSERT|UPDATE|DELETE|ADD)\b/u);
    for (const sql of [ADD, VALIDATE]) {
      expect(sql).toContain("pg_catalog.set_config('lock_timeout', '5s', true)");
      expect(sql).not.toContain('ALTER TABLE "Vendor"');
      expect(sql).not.toContain('ALTER TABLE "CommerceOrder"');
    }
  });

  it("keeps the foreign key and the subject CHECK validated with their exact definitions, and the temporary name gone", async () => {
    await expect(constraints([FK, NEW_CHECK, SUBJECT_CHECK])).resolves.toEqual([
      { name: SUBJECT_CHECK, validated: true, definition: SUBJECT_CHECK_DEFINITION },
      { name: FK, validated: true, definition: `FOREIGN KEY ("vendorId", "commerceOrderId") REFERENCES "CommerceOrder"("vendorId", id) ON UPDATE CASCADE ON DELETE CASCADE` },
    ]);
    const schema = await currentSchema();
    const [index] = await db.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${schema} AND c.relname = 'DelayedStepRun_vendorId_commerceOrderId_idx'
    `;
    expect(index?.definition).toContain('USING btree ("vendorId", "commerceOrderId")');
  });

  it("validates over existing sequence and automation runs, which keep every value; an order run is refused until the second file", async () => {
    await rolledBack(async (tx) => {
      await backToF4(tx);
      const ids = await f4Runs(tx);
      const before = await rowsOf(tx, ids);
      expect(before).toHaveLength(3);
      for (const statement of ADD_STATEMENTS) await tx.$executeRawUnsafe(statement);
      // Between the two files the F-4 CHECK still applies: no order run can be written.
      await tx.$executeRawUnsafe("SAVEPOINT between_files");
      await expect(tx.$executeRaw`
        UPDATE "DelayedStepRun" SET "formSubmissionId" = NULL, "commerceOrderId" = 'no-such-order' WHERE "id" = ${ids[0]!}
      `).rejects.toThrow(/DelayedStepRun_automation_reference_check|DelayedStepRun_vendorId_commerceOrderId_fkey/u);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT between_files");
      for (const statement of VALIDATE_STATEMENTS) await tx.$executeRawUnsafe(statement);
      const rows = await constraints([FK, NEW_CHECK, SUBJECT_CHECK], tx);
      expect(rows).toEqual([
        { name: SUBJECT_CHECK, validated: true, definition: SUBJECT_CHECK_DEFINITION },
        expect.objectContaining({ name: FK, validated: true }),
      ]);
      await expect(rowsOf(tx, ids)).resolves.toEqual(before);
    });
  });

  it("fails the validation migration on a row that breaks the new rule, leaving the CHECK NOT VALID", async () => {
    const { vendor, order } = await vendorWithOrder("invalid");
    await rolledBack(async (tx) => {
      await backToF4(tx);
      const suffix = randomUUID().slice(0, 12);
      const form = await tx.registrationForm.create({ data: { vendorId: vendor.id, name: "F", slug: `q09-invalid-form-${suffix}`, headline: "H", fields: [] } });
      const live = await tx.live.create({ data: { vendorId: vendor.id, formId: form.id, title: "L", slug: `q09-invalid-live-${suffix}`, scheduledAt: new Date() } });
      const sequence = await tx.emailSequence.create({ data: { vendorId: vendor.id, liveId: live.id, name: "Q", status: "active", activatedAt: new Date() } });
      const submission = await tx.formSubmission.create({ data: { formId: form.id, liveId: live.id, name: "A", email: `a-${suffix}@example.test` } });
      // Possible only before the new CHECK exists: a sequence run naming an order.
      await tx.$executeRaw`
        INSERT INTO "DelayedStepRun" ("id", "vendorId", "emailSequenceId", "formSubmissionId", "commerceOrderId", "anchorAt", "nextRunAt", "status", "updatedAt")
        VALUES (${`q09_invalid_${suffix}`}, ${vendor.id}, ${sequence.id}, ${submission.id}, ${order.id}, now(), now(), 'active', now())
      `;
      for (const statement of ADD_STATEMENTS) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "${FK}"`);
      await tx.$executeRawUnsafe("SAVEPOINT before_validate");
      await expect(tx.$executeRawUnsafe(`ALTER TABLE "DelayedStepRun" VALIDATE CONSTRAINT "${NEW_CHECK}"`)).rejects.toThrow(/automation_subject_check/u);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT before_validate");
      await expect(constraints([NEW_CHECK], tx)).resolves.toEqual([expect.objectContaining({ name: NEW_CHECK, validated: false })]);
    });
  });

  it("accepts an order run of the vendor's own order and refuses every other shape", async () => {
    const a = await vendorWithOrder("a");
    const b = await vendorWithOrder("b");
    const base = { vendorId: a.vendor.id, automationRuleId: a.rule.id, sourceExecutionLogId: a.log.id, subjectKeyHash: "k", anchorAt: new Date(), nextRunAt: new Date() };
    const run = await db.delayedStepRun.create({ data: { ...base, commerceOrderId: a.order.id } });
    expect(run).toMatchObject({ commerceOrderId: a.order.id, formSubmissionId: null, consultationBookingId: null });
    // Two subjects.
    const form = await db.registrationForm.create({ data: { vendorId: a.vendor.id, name: "F", slug: `q09-two-${randomUUID().slice(0, 8)}`, headline: "H", fields: [] } });
    const submission = await db.formSubmission.create({ data: { formId: form.id, name: "A", email: `two-${randomUUID().slice(0, 8)}@example.test` } });
    const otherLog = await db.automationExecutionLog.create({ data: { vendorId: a.vendor.id, ruleId: a.rule.id, idempotencyKey: `q09-${randomUUID()}`, eventId: "e", trigger: "payment_paid", subjectType: "buyer_order", subjectKeyHash: "k", status: "completed" } });
    await expect(db.delayedStepRun.create({ data: { ...base, sourceExecutionLogId: otherLog.id, commerceOrderId: a.order.id, formSubmissionId: submission.id } }))
      .rejects.toThrow(/DelayedStepRun_automation_reference_check/u);
    // An order run without its customer key.
    await expect(db.delayedStepRun.create({ data: { ...base, sourceExecutionLogId: otherLog.id, subjectKeyHash: null, commerceOrderId: a.order.id } }))
      .rejects.toThrow(/DelayedStepRun_automation_reference_check/u);
    // A sequence run naming an order.
    const live = await db.live.create({ data: { vendorId: a.vendor.id, formId: form.id, title: "L", slug: `q09-live-${randomUUID().slice(0, 8)}`, scheduledAt: new Date() } });
    const sequence = await db.emailSequence.create({ data: { vendorId: a.vendor.id, liveId: live.id, name: "Q", status: "active", activatedAt: new Date() } });
    await expect(db.delayedStepRun.create({ data: { vendorId: a.vendor.id, emailSequenceId: sequence.id, formSubmissionId: submission.id, commerceOrderId: a.order.id, anchorAt: new Date() } }))
      .rejects.toThrow(/DelayedStepRun_automation_reference_check/u);
    // Another vendor's order (composite foreign key).
    await expect(db.delayedStepRun.create({ data: { ...base, sourceExecutionLogId: otherLog.id, commerceOrderId: b.order.id } }))
      .rejects.toMatchObject({ code: "P2003" });
    // Deleting the order removes its run (direct SQL: no application path deletes orders).
    await db.$executeRaw`DELETE FROM "CommerceOrder" WHERE "id" = ${a.order.id} AND "vendorId" = ${a.vendor.id}`;
    await expect(db.commerceOrder.count({ where: { id: a.order.id } })).resolves.toBe(0);
    await expect(db.delayedStepRun.count({ where: { id: run.id } })).resolves.toBe(0);
  });
});
