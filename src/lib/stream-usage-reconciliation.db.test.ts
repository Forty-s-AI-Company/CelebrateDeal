import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  importStreamUsageReconciliation,
  resolveStreamUsageReconciliation,
} from "@/lib/stream-usage-reconciliation";

const createdVendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

async function createVendorWithUsage(suffix: string, watchSeconds: number) {
  const db = getDb();
  const vendor = await db.vendor.create({
    data: {
      name: `G7-12 Stream reconciliation ${suffix}`,
      slug: `g7-12-stream-${suffix}`,
      email: `g7-12-stream-${suffix}@example.test`,
      passwordHash: "disposable-test-only",
    },
  });
  createdVendorIds.push(vendor.id);
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      title: "Provider reconciliation fixture",
      slug: `g7-12-live-${suffix}`,
      scheduledAt: new Date("2026-07-01T00:00:00.000Z"),
      status: "ended",
    },
  });
  if (watchSeconds > 0) {
    await db.streamUsageLedgerEntry.create({
      data: {
        vendorId: vendor.id,
        liveId: live.id,
        eventId: crypto.randomUUID(),
        monthKey: "2026-07",
        watchSeconds,
        source: "DIRECT_PLAYBACK",
        capturedAt: new Date("2026-07-15T00:00:00.000Z"),
      },
    });
  }
  return vendor;
}

describe("Stream usage reconciliation disposable database invariants", () => {
  it("keeps provider evidence immutable, idempotent and tenant-bound through resolution", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const vendor = await createVendorWithUsage(suffix, 120);
    const input = {
      vendorId: vendor.id,
      provider: "CLOUDFLARE",
      monthKey: "2026-07",
      sourceDigest: "a".repeat(64),
      sourceReference: "synthetic-july-export",
      providerWatchMinutes: 10,
      providerStorageMinutes: 4,
      capturedAt: new Date("2026-08-01T00:00:00.000Z"),
      actorId: "synthetic-platform-admin",
      actorLabel: "platform_admin",
    } as const;

    const imported = await importStreamUsageReconciliation(input);
    expect(imported).toMatchObject({
      duplicate: false,
      status: "MISMATCH",
      internalWatchSeconds: 120,
      internalWatchMinutes: 2,
      differenceMinutes: 8,
      evidenceKind: "ADMIN_ATTESTED_DIGEST",
    });
    await expect(importStreamUsageReconciliation(input)).resolves.toMatchObject({ id: imported.id, duplicate: true });
    expect(await getDb().streamUsageReconciliation.count({ where: { vendorId: vendor.id } })).toBe(1);
    expect(await getDb().streamOperationsAlert.findFirstOrThrow({ where: { vendorId: vendor.id } })).toMatchObject({
      type: "PROVIDER_DISCREPANCY",
      status: "OPEN",
      reconciliationId: imported.id,
    });

    const newerMatched = await importStreamUsageReconciliation({
      ...input,
      sourceDigest: "c".repeat(64),
      sourceReference: "synthetic-corrected-export",
      providerWatchMinutes: 2,
      providerStorageMinutes: 4,
    });
    expect(newerMatched).toMatchObject({ status: "MATCHED", differenceMinutes: 0 });
    expect(await getDb().streamOperationsAlert.findFirstOrThrow({ where: { vendorId: vendor.id } })).toMatchObject({
      status: "OPEN",
      reconciliationId: imported.id,
    });
    expect(await getDb().streamUsageReconciliation.count({ where: { vendorId: vendor.id, status: "MISMATCH" } })).toBe(1);

    await expect(resolveStreamUsageReconciliation({
      id: imported.id,
      resolution: "ACCEPT_PROVIDER",
      note: "Synthetic provider total reviewed against the immutable ledger.",
      actorId: "synthetic-platform-admin",
      actorLabel: "platform_admin",
    })).resolves.toMatchObject({ id: imported.id, status: "RESOLVED", resolution: "ACCEPT_PROVIDER" });
    expect(await getDb().streamOperationsAlert.findFirstOrThrow({ where: { vendorId: vendor.id } })).toMatchObject({ status: "RESOLVED" });

    await expect(getDb().streamUsageReconciliation.update({
      where: { id: imported.id },
      data: { providerWatchMinutes: 11 },
    })).rejects.toThrow();
    expect(await getDb().streamUsageReconciliation.findUniqueOrThrow({ where: { id: imported.id } })).toMatchObject({
      providerWatchMinutes: 10,
      internalWatchSeconds: 120,
      sourceDigest: "a".repeat(64),
    });
  });

  it("rejects digest reuse across tenants instead of attaching one provider report twice", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const first = await createVendorWithUsage(`${suffix}-a`, 0);
    const second = await createVendorWithUsage(`${suffix}-b`, 0);
    const base = {
      provider: "CLOUDFLARE",
      monthKey: "2026-07",
      sourceDigest: "b".repeat(64),
      sourceReference: "synthetic-report",
      providerWatchMinutes: 0,
      providerStorageMinutes: null,
      capturedAt: new Date("2026-08-01T00:00:00.000Z"),
      actorId: "synthetic-platform-admin",
      actorLabel: "platform_admin",
    } as const;

    await importStreamUsageReconciliation({ ...base, vendorId: first.id });
    await expect(importStreamUsageReconciliation({ ...base, vendorId: second.id })).rejects.toMatchObject({ code: "conflict" });
    expect(await getDb().streamUsageReconciliation.count({ where: { vendorId: second.id } })).toBe(0);
  });
});
