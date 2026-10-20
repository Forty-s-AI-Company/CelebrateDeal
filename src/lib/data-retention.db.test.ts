import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { purgeExpiredData } from "./data-retention";

const DAY = 86_400_000;
const policy = { webhookPayloadDays: 180, analyticsEventDays: 365, auditLogIpDays: 365 };
const ROLLBACK = "synthetic-retention-rollback";

/**
 * The sweep is global by design. Run every case inside one interactive
 * transaction that is always rolled back, so the shared test database (and
 * any seeded rows other suites rely on) is left exactly as it was.
 */
async function inRollback(body: (tx: Prisma.TransactionClient, now: Date) => Promise<void>) {
  const now = new Date();
  await expect(getDb().$transaction(async (tx) => {
    await body(tx, now);
    throw new Error(ROLLBACK);
  }, { timeout: 60_000 })).rejects.toThrow(ROLLBACK);
}

async function createVendor(tx: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const vendor = await tx.vendor.create({
    data: { name: "Synthetic retention", slug: `retention-${suffix}`, email: `retention-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  return vendor.id;
}

function webhook(tx: Prisma.TransactionClient, status: string, createdAt: Date) {
  return tx.webhookEvent.create({
    data: {
      provider: "synthetic-retention",
      eventId: randomUUID(),
      eventType: "paid",
      status,
      createdAt,
      payload: { raw: { buyerEmail: "buyer@example.test" }, normalized: { orderNumber: "SYN-1" }, diagnostics: { ip: "203.0.113.9" } },
    },
  });
}

describe("purgeExpiredData (PostgreSQL)", () => {
  it("strips old terminal webhook payloads, deletes old analytics and clears old audit IPs only", async () => {
    await inRollback(async (tx, now) => {
      const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
      const vendorId = await createVendor(tx);
      const oldProcessed = await webhook(tx, "processed", daysAgo(200));
      const oldInFlight = await webhook(tx, "retrying", daysAgo(200));
      const recent = await webhook(tx, "processed", daysAgo(10));
      const oldEvent = await tx.analyticsEvent.create({ data: { vendorId, eventType: "page_view", visitorId: "v-old", createdAt: daysAgo(400) } });
      const newEvent = await tx.analyticsEvent.create({ data: { vendorId, eventType: "page_view", visitorId: "v-new", createdAt: daysAgo(30) } });
      const oldAudit = await tx.auditLog.create({ data: { vendorId, action: "synthetic", targetType: "Synthetic", ipAddress: "203.0.113.1", userAgent: "agent", createdAt: daysAgo(400) } });
      const newAudit = await tx.auditLog.create({ data: { vendorId, action: "synthetic", targetType: "Synthetic", ipAddress: "203.0.113.2", createdAt: daysAgo(30) } });

      const result = await purgeExpiredData(tx, { now, policy });
      expect(result.webhookPayloadsPurged).toBeGreaterThanOrEqual(1);
      expect(result.analyticsEventsDeleted).toBeGreaterThanOrEqual(1);
      expect(result.auditLogIpsCleared).toBeGreaterThanOrEqual(1);

      const purged = await tx.webhookEvent.findUniqueOrThrow({ where: { id: oldProcessed.id } });
      expect(purged.payload).toEqual({ normalized: { orderNumber: "SYN-1" }, retentionPurgedAt: now.toISOString() });
      expect(purged).toMatchObject({ provider: oldProcessed.provider, eventId: oldProcessed.eventId, status: "processed" });
      expect((await tx.webhookEvent.findUniqueOrThrow({ where: { id: oldInFlight.id } })).payload).toEqual(oldInFlight.payload);
      expect((await tx.webhookEvent.findUniqueOrThrow({ where: { id: recent.id } })).payload).toEqual(recent.payload);

      expect(await tx.analyticsEvent.findUnique({ where: { id: oldEvent.id } })).toBeNull();
      expect(await tx.analyticsEvent.findUnique({ where: { id: newEvent.id } })).not.toBeNull();

      expect(await tx.auditLog.findUniqueOrThrow({ where: { id: oldAudit.id } })).toMatchObject({ ipAddress: null, action: "synthetic", userAgent: "agent" });
      expect(await tx.auditLog.findUniqueOrThrow({ where: { id: newAudit.id } })).toMatchObject({ ipAddress: "203.0.113.2" });

      // Idempotent: a second run leaves already-purged payloads unchanged.
      const second = await purgeExpiredData(tx, { now: new Date(now.getTime() + 1_000), policy });
      expect(second).toMatchObject({ webhookPayloadsPurged: 0, analyticsEventsDeleted: 0, auditLogIpsCleared: 0, remaining: false });
      expect((await tx.webhookEvent.findUniqueOrThrow({ where: { id: oldProcessed.id } })).payload).toEqual(purged.payload);
    });
  });

  it("stops at the batch cap and reports remaining work", async () => {
    await inRollback(async (tx, now) => {
      const vendorId = await createVendor(tx);
      for (let index = 0; index < 3; index += 1) {
        await tx.auditLog.create({
          data: { vendorId, action: "synthetic", targetType: "Synthetic", ipAddress: `203.0.113.${index}`, createdAt: new Date(now.getTime() - 500 * DAY) },
        });
      }
      const result = await purgeExpiredData(tx, { now, policy, batchSize: 1, maxBatches: 1 });
      expect(result.auditLogIpsCleared).toBe(1);
      expect(result.remaining).toBe(true);
    });
  });
});
