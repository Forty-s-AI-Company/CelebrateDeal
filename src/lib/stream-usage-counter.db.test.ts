import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { recordStreamUsageLedgerEntry } from "@/lib/stream-usage";
import { readVendorStreamUsageSeconds } from "@/lib/stream-usage-counter";

// F-092 / B06-06: concurrent viewers of one vendor must never see a false
// "stream minutes exhausted". These tests run against the disposable loopback
// PostgreSQL database with real READ COMMITTED transactions and row locks.

const createdVendorIds: string[] = [];
const capturedAt = new Date("2026-07-15T12:00:00.000Z");
const monthKey = "2026-07";

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

async function createVendorWithLive(streamMinutesLimit: number) {
  const db = getDb();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 16);
  const vendor = await db.vendor.create({
    data: {
      name: `F-092 stream counter ${suffix}`,
      slug: `f092-stream-${suffix}`,
      email: `f092-stream-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      title: "F-092 concurrent heartbeat fixture",
      slug: `f092-live-${suffix}`,
      scheduledAt: new Date("2026-07-15T11:00:00.000Z"),
      status: "live",
    },
  });
  await db.vendorUsageLimit.create({
    data: {
      vendorId: vendor.id,
      streamMinutesLimit,
      // Expired legacy counter: the ledger/counter alone decides the quota.
      resetAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  });
  return { vendorId: vendor.id, liveId: live.id };
}

function heartbeat(scope: { vendorId: string; liveId: string }, watchSeconds = 60, eventId = randomUUID()) {
  return recordStreamUsageLedgerEntry({ ...scope, eventId, watchSeconds, capturedAt });
}

async function ledgerSeconds(vendorId: string) {
  const sum = await getDb().streamUsageLedgerEntry.aggregate({
    where: { vendorId, monthKey },
    _sum: { watchSeconds: true },
  });
  return sum._sum.watchSeconds ?? 0;
}

async function counterSeconds(vendorId: string) {
  const row = await getDb().streamUsageMonthlyCounter.findUnique({
    where: { vendorId_monthKey: { vendorId, monthKey } },
    select: { watchSeconds: true },
  });
  return row?.watchSeconds ?? null;
}

describe("stream usage monthly counter on PostgreSQL", () => {
  it("records 20 concurrent heartbeats under a finite quota without a single false exhaustion", async () => {
    const scope = await createVendorWithLive(600);

    const results = await Promise.allSettled(Array.from({ length: 20 }, () => heartbeat(scope)));

    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected.map((result) => (result as PromiseRejectedResult).reason)).toEqual([]);
    expect(results.every((result) => result.status === "fulfilled" && result.value.duplicate === false)).toBe(true);
    expect(await getDb().streamUsageLedgerEntry.count({ where: { vendorId: scope.vendorId } })).toBe(20);
    expect(await ledgerSeconds(scope.vendorId)).toBe(1_200);
    expect(await counterSeconds(scope.vendorId)).toBe(1_200);
    expect(await getDb().streamOperationsAlert.count({ where: { vendorId: scope.vendorId } })).toBe(0);
  });

  it("admits exactly the remaining quota when 20 concurrent heartbeats race for 10 minutes", async () => {
    const scope = await createVendorWithLive(10);

    const results = await Promise.allSettled(Array.from({ length: 20 }, () => heartbeat(scope)));

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(10);
    // Only genuine exhaustion: no usage_busy, no raw database error.
    expect(rejected.every((result) => (result.reason as { name?: string }).name === "StreamQuotaExceededError")).toBe(true);
    expect(await ledgerSeconds(scope.vendorId)).toBe(600);
    expect(await counterSeconds(scope.vendorId)).toBe(600);
    expect(await getDb().streamOperationsAlert.findMany({
      where: { vendorId: scope.vendorId },
      select: { type: true, status: true },
    })).toEqual(expect.arrayContaining([{ type: "QUOTA_EXHAUSTED", status: "OPEN" }]));
  });

  it("seeds the month's counter once from ledger rows written before the counter existed", async () => {
    const scope = await createVendorWithLive(0);
    await getDb().streamUsageLedgerEntry.create({
      data: { ...scope, eventId: randomUUID(), monthKey, watchSeconds: 300, source: "DIRECT_PLAYBACK", capturedAt },
    });
    expect(await counterSeconds(scope.vendorId)).toBeNull();
    expect(await readVendorStreamUsageSeconds(getDb(), { vendorId: scope.vendorId, monthKey })).toBe(300);

    await Promise.all([heartbeat(scope, 45), heartbeat(scope, 15)]);

    expect(await counterSeconds(scope.vendorId)).toBe(360);
    expect(await ledgerSeconds(scope.vendorId)).toBe(360);
    expect(await readVendorStreamUsageSeconds(getDb(), { vendorId: scope.vendorId, monthKey })).toBe(360);
  });

  it("counts a concurrently replayed event once", async () => {
    const scope = await createVendorWithLive(600);
    const eventId = randomUUID();

    const results = await Promise.all([heartbeat(scope, 60, eventId), heartbeat(scope, 60, eventId)]);

    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(await counterSeconds(scope.vendorId)).toBe(60);
    expect(await ledgerSeconds(scope.vendorId)).toBe(60);
  });

  it("keeps tenants apart: another vendor's live is not found and its counter is untouched", async () => {
    const first = await createVendorWithLive(600);
    const second = await createVendorWithLive(600);

    await expect(heartbeat({ vendorId: second.vendorId, liveId: first.liveId }))
      .rejects.toMatchObject({ code: "live_not_found" });
    await heartbeat(first);

    expect(await counterSeconds(first.vendorId)).toBe(60);
    expect(await counterSeconds(second.vendorId)).toBeNull();
  });

  it("enforces the counter CHECK constraints and cascades with the vendor", async () => {
    const scope = await createVendorWithLive(0);
    await expect(getDb().streamUsageMonthlyCounter.create({
      data: { vendorId: scope.vendorId, monthKey: "2026-13", watchSeconds: 1 },
    })).rejects.toThrow();
    await expect(getDb().streamUsageMonthlyCounter.create({
      data: { vendorId: scope.vendorId, monthKey, watchSeconds: -1 },
    })).rejects.toThrow();

    await heartbeat(scope);
    await getDb().vendor.delete({ where: { id: scope.vendorId } });
    expect(await getDb().streamUsageMonthlyCounter.count({ where: { vendorId: scope.vendorId } })).toBe(0);
  });
});
