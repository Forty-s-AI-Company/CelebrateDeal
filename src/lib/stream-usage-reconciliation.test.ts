import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  vendorFindUnique: vi.fn(),
  ledgerAggregate: vi.fn(),
  reconciliationFindUnique: vi.fn(),
  reconciliationCreate: vi.fn(),
  reconciliationUpdateMany: vi.fn(),
  alertUpsert: vi.fn(),
  alertUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendor: { findUnique: mocks.vendorFindUnique },
    streamUsageLedgerEntry: { aggregate: mocks.ledgerAggregate },
    streamUsageReconciliation: {
      findUnique: mocks.reconciliationFindUnique,
      create: mocks.reconciliationCreate,
      updateMany: mocks.reconciliationUpdateMany,
    },
    streamOperationsAlert: { upsert: mocks.alertUpsert, updateMany: mocks.alertUpdateMany },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  }),
}));

import {
  importStreamUsageReconciliation,
  resolveStreamUsageReconciliation,
  StreamUsageReconciliationError,
} from "@/lib/stream-usage-reconciliation";

const capturedAt = new Date("2026-08-01T00:00:00.000Z");
const input = {
  vendorId: "vendor-1",
  provider: "cloudflare",
  monthKey: "2026-07",
  sourceDigest: "a".repeat(64),
  sourceReference: "CF export 2026-07",
  providerWatchMinutes: 3,
  providerStorageMinutes: 1,
  capturedAt,
  actorId: "finance-1",
  actorLabel: "finance_admin",
};

function reconciliationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "reconciliation-1",
    vendorId: input.vendorId,
    provider: "CLOUDFLARE",
    monthKey: input.monthKey,
    sourceDigest: input.sourceDigest,
    sourceReference: input.sourceReference,
    providerWatchMinutes: input.providerWatchMinutes,
    providerStorageMinutes: input.providerStorageMinutes,
    internalWatchSeconds: 120,
    internalWatchMinutes: 2,
    differenceMinutes: 1,
    status: "MATCHED",
    evidenceKind: "ADMIN_ATTESTED_DIGEST",
    capturedAt,
    resolution: null,
    resolvedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-1" });
  mocks.ledgerAggregate.mockResolvedValue({ _sum: { watchSeconds: 120 } });
  mocks.reconciliationFindUnique.mockResolvedValue(null);
  mocks.reconciliationCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => reconciliationRow(data));
  mocks.reconciliationUpdateMany.mockResolvedValue({ count: 1 });
  mocks.alertUpsert.mockResolvedValue({ id: "alert-1" });
  mocks.alertUpdateMany.mockResolvedValue({ count: 1 });
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    vendor: { findUnique: mocks.vendorFindUnique },
    streamUsageLedgerEntry: { aggregate: mocks.ledgerAggregate },
    streamUsageReconciliation: {
      findUnique: mocks.reconciliationFindUnique,
      create: mocks.reconciliationCreate,
      updateMany: mocks.reconciliationUpdateMany,
    },
    streamOperationsAlert: { upsert: mocks.alertUpsert, updateMany: mocks.alertUpdateMany },
    auditLog: { create: mocks.auditCreate },
  }));
});

describe("stream usage reconciliation", () => {
  it("rejects malformed provider evidence before database access", async () => {
    await expect(importStreamUsageReconciliation({ ...input, sourceDigest: "not-a-digest" }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await expect(importStreamUsageReconciliation({ ...input, sourceReference: "account@example.test" }))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts only a 1-120 character sanitized source reference and rejects future evidence beyond five minutes", async () => {
    await expect(importStreamUsageReconciliation({ ...input, sourceReference: `R${"a".repeat(119)}` }))
      .resolves.toMatchObject({ duplicate: false });
    await expect(importStreamUsageReconciliation({ ...input, sourceReference: `R${"a".repeat(120)}` }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await expect(importStreamUsageReconciliation({ ...input, capturedAt: new Date(Date.now() + (6 * 60 * 1_000)) }))
      .rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps source-reference, lifecycle, and snapshot immutability constraints in the migration", () => {
    const migration = readFileSync(join(
      process.cwd(),
      "prisma/migrations/20260809000000_g7_12_stream_usage_reconciliation/migration.sql",
    ), "utf8");

    expect(migration).toContain('CONSTRAINT "StreamUsageReconciliation_source_reference_check" CHECK');
    expect(migration).toContain('length(btrim("sourceReference")) BETWEEN 1 AND 120');
    expect(migration).toContain("'^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,119}$'");
    expect(migration).toContain('CONSTRAINT "StreamUsageReconciliation_lifecycle_check" CHECK');
    expect(migration).toContain("CREATE FUNCTION enforce_stream_usage_reconciliation_immutable()");
    expect(migration).toContain("Stream usage reconciliation snapshot is immutable.");
    expect(migration).toContain("Only a mismatch may transition to resolved.");
  });

  it("aggregates immutable ledger seconds server-side and matches within the fixed one-minute tolerance", async () => {
    await expect(importStreamUsageReconciliation(input)).resolves.toEqual({
      id: "reconciliation-1",
      vendorId: "vendor-1",
      provider: "CLOUDFLARE",
      monthKey: "2026-07",
      providerWatchMinutes: 3,
      providerStorageMinutes: 1,
      internalWatchSeconds: 120,
      internalWatchMinutes: 2,
      differenceMinutes: 1,
      status: "MATCHED",
      evidenceKind: "ADMIN_ATTESTED_DIGEST",
      capturedAt,
      resolution: null,
      resolvedAt: null,
      duplicate: false,
    });
    expect(mocks.ledgerAggregate).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", monthKey: "2026-07" },
      _sum: { watchSeconds: true },
    });
    expect(mocks.reconciliationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "MATCHED",
        evidenceKind: "ADMIN_ATTESTED_DIGEST",
        internalWatchSeconds: 120,
        internalWatchMinutes: 2,
        differenceMinutes: 1,
      }),
    }));
    expect(mocks.alertUpsert).not.toHaveBeenCalled();
    expect(mocks.alertUpdateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "import_stream_usage_reconciliation",
        after: expect.not.objectContaining({ sourceDigest: expect.anything() }),
      }),
    }));
  });

  it("persists a discrepancy alert while keeping provider evidence separate from billing data", async () => {
    mocks.ledgerAggregate.mockResolvedValueOnce({ _sum: { watchSeconds: 60 } });

    await expect(importStreamUsageReconciliation({ ...input, providerWatchMinutes: 5 }))
      .resolves.toMatchObject({ status: "MISMATCH", differenceMinutes: 4, evidenceKind: "ADMIN_ATTESTED_DIGEST" });

    expect(mocks.alertUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { dedupKey: "stream-provider-discrepancy:vendor-1:CLOUDFLARE:2026-07" },
      create: expect.objectContaining({
        type: "PROVIDER_DISCREPANCY",
        severity: "CRITICAL",
        metadata: { evidenceKind: "ADMIN_ATTESTED_DIGEST", differenceMinutes: 4 },
      }),
    }));
  });

  it("returns an exact duplicate without audit or alert side effects and rejects digest payload drift", async () => {
    mocks.reconciliationFindUnique.mockResolvedValueOnce(reconciliationRow());

    await expect(importStreamUsageReconciliation(input)).resolves.toMatchObject({ duplicate: true, id: "reconciliation-1" });
    expect(mocks.reconciliationCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.alertUpsert).not.toHaveBeenCalled();

    mocks.reconciliationFindUnique.mockResolvedValueOnce(reconciliationRow({ providerWatchMinutes: 99 }));
    await expect(importStreamUsageReconciliation(input)).rejects.toMatchObject({ code: "conflict" });
  });

  it("recovers a concurrent unique insert only when the persisted digest content is identical", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2002" });
    mocks.reconciliationFindUnique.mockResolvedValueOnce(reconciliationRow());

    await expect(importStreamUsageReconciliation(input)).resolves.toMatchObject({ duplicate: true, id: "reconciliation-1" });
  });

  it("retries one serializable conflict before returning a newly created reconciliation", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2034" });

    await expect(importStreamUsageReconciliation(input)).resolves.toMatchObject({ duplicate: false, status: "MATCHED" });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("resolves only a mismatch through a compare-and-set transition without changing its snapshot", async () => {
    mocks.reconciliationFindUnique.mockResolvedValueOnce(reconciliationRow({
      status: "MISMATCH",
      differenceMinutes: 4,
      internalWatchSeconds: 60,
      internalWatchMinutes: 1,
    }));

    await expect(resolveStreamUsageReconciliation({
      id: "reconciliation-1",
      resolution: "ACCEPT_INTERNAL",
      note: "The provider report includes traffic excluded from our ledger.",
      actorId: "finance-1",
      actorLabel: "finance_admin",
    })).resolves.toMatchObject({ status: "RESOLVED", resolution: "ACCEPT_INTERNAL", differenceMinutes: 4 });

    expect(mocks.reconciliationUpdateMany).toHaveBeenCalledWith({
      where: { id: "reconciliation-1", status: "MISMATCH" },
      data: expect.objectContaining({
        status: "RESOLVED",
        resolution: "ACCEPT_INTERNAL",
        resolutionNote: "The provider report includes traffic excluded from our ledger.",
      }),
    });
    expect(mocks.reconciliationUpdateMany.mock.calls[0]?.[0].data)
      .not.toHaveProperty("internalWatchSeconds");
    expect(mocks.alertUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "RESOLVED" }),
    }));
  });

  it("returns finite transition and input errors", async () => {
    mocks.reconciliationFindUnique.mockResolvedValueOnce(reconciliationRow({ status: "MATCHED" }));
    await expect(resolveStreamUsageReconciliation({
      id: "reconciliation-1",
      resolution: "ACCEPT_PROVIDER",
      note: "A sufficiently detailed resolution note.",
      actorId: "finance-1",
      actorLabel: "finance_admin",
    })).rejects.toBeInstanceOf(StreamUsageReconciliationError);
    await expect(resolveStreamUsageReconciliation({
      id: "reconciliation-1",
      resolution: "ESCALATED",
      note: "short",
      actorId: "finance-1",
      actorLabel: "finance_admin",
    })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
