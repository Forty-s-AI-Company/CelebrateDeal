import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

/**
 * Q-11: 20261118090100_pause_viewer_watch_progress_rules switches off every
 * `viewer_watch_progress` rule still marked active, because the trigger
 * starts running in this release (as 20261117110100 did for `form_no_show`).
 * The database is already migrated, so the file's own statements are replayed
 * over rules written afterwards, inside a transaction that is rolled back.
 */
const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../prisma/migrations/20261118090100_pause_viewer_watch_progress_rules/migration.sql"),
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
  const row = await client.vendor.create({ data: { name: "Pause migration", slug: `pause-watch-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(row.id);
  return row;
}

function condition(trigger: string) {
  if (trigger === "payment_paid") return { type: "order_amount_gte", amountCents: 100 };
  if (trigger === "viewer_watch_progress" || trigger === "webinar_attended_duration_gte") return { type: "watch_seconds_gte", seconds: 600 };
  return { type: "always" };
}

function rule(client: Prisma.TransactionClient, vendorId: string, trigger: string, isActive: boolean, updatedAt: Date) {
  return client.automationRule.create({
    data: {
      vendorId,
      name: `${trigger} ${isActive ? "on" : "off"}`,
      trigger,
      isActive,
      condition: condition(trigger) as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag: "x" }] as Prisma.InputJsonArray,
      updatedAt,
    },
    select: { id: true, trigger: true, isActive: true, updatedAt: true, version: true, condition: true, actions: true },
  });
}

describe("20261118090100_pause_viewer_watch_progress_rules", () => {
  it("is one forward-only UPDATE bound to viewer_watch_progress rules that are active, with a lock timeout", () => {
    expect(UPDATE_STATEMENTS).toHaveLength(1);
    expect(UPDATE_STATEMENTS[0]).toMatch(/SET "isActive" = false,\s+"updatedAt" = CURRENT_TIMESTAMP\s+WHERE "trigger" = 'viewer_watch_progress'\s+AND "isActive" = true;/u);
    expect(MIGRATION).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
    expect(MIGRATION).not.toMatch(/\b(DELETE|DROP|ALTER|TRUNCATE|INSERT)\b/u);
  });

  it("switches off active viewer_watch_progress rules of every vendor and leaves every other rule exactly as it was", async () => {
    const before = new Date("2026-11-01T00:00:00.000Z");
    const outcome = db.$transaction(async (tx) => {
      const a = await vendor(tx);
      const b = await vendor(tx);
      const active = [await rule(tx, a.id, "viewer_watch_progress", true, before), await rule(tx, b.id, "viewer_watch_progress", true, before)];
      const untouched = [
        await rule(tx, a.id, "viewer_watch_progress", false, before),
        await rule(tx, a.id, "form_registered", true, before),
        await rule(tx, b.id, "form_no_show", true, before),
        await rule(tx, b.id, "webinar_attended_duration_gte", true, before),
      ];

      for (const statement of UPDATE_STATEMENTS) await tx.$executeRawUnsafe(statement);

      const select = { id: true, trigger: true, isActive: true, updatedAt: true, version: true, condition: true, actions: true } as const;
      const pausedNow = await tx.automationRule.findMany({ where: { id: { in: active.map((row) => row.id) } }, select });
      expect(pausedNow).toHaveLength(2);
      for (const row of pausedNow) {
        const original = active.find((candidate) => candidate.id === row.id)!;
        expect(row).toMatchObject({ trigger: "viewer_watch_progress", isActive: false, version: original.version, condition: original.condition, actions: original.actions });
        expect(row.updatedAt.getTime()).toBeGreaterThan(before.getTime());
      }
      const others = await tx.automationRule.findMany({ where: { id: { in: untouched.map((row) => row.id) } }, select });
      expect(others.sort((x, y) => x.id.localeCompare(y.id))).toEqual([...untouched].sort((x, y) => x.id.localeCompare(y.id)));

      for (const statement of UPDATE_STATEMENTS) expect(await tx.$executeRawUnsafe(statement)).toBe(0);
      throw new Rollback();
    });
    await expect(outcome).rejects.toBeInstanceOf(Rollback);
    expect(await db.automationRule.count({ where: { vendorId: { in: vendorIds } } })).toBe(0);
  });
});
