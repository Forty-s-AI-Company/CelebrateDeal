import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

/**
 * Q-11: 20261117090100_pause_form_no_show_rules switches off every
 * `form_no_show` rule still marked active, because the trigger starts running
 * in this release (as 20261114120000 did for `payment_paid`). The database is
 * already migrated, so the file's own statements are replayed over rules
 * written afterwards, inside a transaction that is rolled back.
 */
const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../prisma/migrations/20261117090100_pause_form_no_show_rules/migration.sql"),
  "utf8",
);
const UPDATE_STATEMENTS = MIGRATION.match(/^UPDATE "AutomationRule"[\s\S]*?;$/gmu) ?? [];

const db = getDb();
const vendorIds: string[] = [];

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

class Rollback extends Error {}

async function vendor(client: Prisma.TransactionClient) {
  const suffix = randomUUID().slice(0, 12);
  const row = await client.vendor.create({ data: { name: "Pause migration", slug: `pause-no-show-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(row.id);
  return row;
}

function rule(client: Prisma.TransactionClient, vendorId: string, trigger: string, isActive: boolean, updatedAt: Date) {
  return client.automationRule.create({
    data: {
      vendorId,
      name: `${trigger} ${isActive ? "on" : "off"}`,
      trigger,
      isActive,
      condition: (trigger === "payment_paid" ? { type: "order_amount_gte", amountCents: 100 } : { type: "always" }) as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag: "x" }] as Prisma.InputJsonArray,
      updatedAt,
    },
    select: { id: true, trigger: true, isActive: true, updatedAt: true, version: true, condition: true, actions: true },
  });
}

describe("20261117090100_pause_form_no_show_rules", () => {
  it("is one forward-only UPDATE bound to form_no_show rules that are active, with a lock timeout", () => {
    expect(UPDATE_STATEMENTS).toHaveLength(1);
    expect(UPDATE_STATEMENTS[0]).toMatch(/SET "isActive" = false,\s+"updatedAt" = CURRENT_TIMESTAMP\s+WHERE "trigger" = 'form_no_show'\s+AND "isActive" = true;/u);
    expect(MIGRATION).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
    expect(MIGRATION).not.toMatch(/\b(DELETE|DROP|ALTER|TRUNCATE|INSERT)\b/u);
  });

  it("switches off active form_no_show rules of every vendor and leaves every other rule exactly as it was", async () => {
    const before = new Date("2026-11-01T00:00:00.000Z");
    const outcome = db.$transaction(async (tx) => {
      const a = await vendor(tx);
      const b = await vendor(tx);
      const active = [await rule(tx, a.id, "form_no_show", true, before), await rule(tx, b.id, "form_no_show", true, before)];
      const untouched = [
        await rule(tx, a.id, "form_no_show", false, before),
        await rule(tx, a.id, "form_registered", true, before),
        await rule(tx, b.id, "payment_paid", true, before),
        await rule(tx, b.id, "viewer_watch_progress", true, before),
      ];

      for (const statement of UPDATE_STATEMENTS) await tx.$executeRawUnsafe(statement);

      const select = { id: true, trigger: true, isActive: true, updatedAt: true, version: true, condition: true, actions: true } as const;
      const pausedNow = await tx.automationRule.findMany({ where: { id: { in: active.map((row) => row.id) } }, select });
      expect(pausedNow).toHaveLength(2);
      for (const row of pausedNow) {
        const original = active.find((candidate) => candidate.id === row.id)!;
        expect(row).toMatchObject({ trigger: "form_no_show", isActive: false, version: original.version, condition: original.condition, actions: original.actions });
        // A rule switched on again later gets a newer updatedAt, so it never runs for earlier sessions.
        expect(row.updatedAt.getTime()).toBeGreaterThan(before.getTime());
      }
      const others = await tx.automationRule.findMany({ where: { id: { in: untouched.map((row) => row.id) } }, select });
      expect(others.sort((x, y) => x.id.localeCompare(y.id))).toEqual([...untouched].sort((x, y) => x.id.localeCompare(y.id)));

      // A second run changes nothing (no active form_no_show rule is left).
      for (const statement of UPDATE_STATEMENTS) expect(await tx.$executeRawUnsafe(statement)).toBe(0);
      throw new Rollback();
    });
    await expect(outcome).rejects.toBeInstanceOf(Rollback);
    expect(await db.automationRule.count({ where: { vendorId: { in: vendorIds } } })).toBe(0);
  });
});
