import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;
const SANITIZED_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,119}$/;
const MAX_INTEGER = 2_147_483_647;
const RECONCILIATION_TOLERANCE_MINUTES = 1;
const MAX_FUTURE_CAPTURED_AT_MS = 5 * 60 * 1_000;

export type StreamUsageReconciliationErrorCode =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "invalid_transition";

export class StreamUsageReconciliationError extends Error {
  constructor(public readonly code: StreamUsageReconciliationErrorCode) {
    super(code);
    this.name = "StreamUsageReconciliationError";
  }
}

export type StreamUsageReconciliationDto = {
  id: string;
  vendorId: string;
  provider: string;
  monthKey: string;
  providerWatchMinutes: number;
  providerStorageMinutes: number | null;
  internalWatchSeconds: number;
  internalWatchMinutes: number;
  differenceMinutes: number;
  status: "MATCHED" | "MISMATCH" | "RESOLVED";
  evidenceKind: "ADMIN_ATTESTED_DIGEST";
  capturedAt: Date;
  resolution: "ACCEPT_INTERNAL" | "ACCEPT_PROVIDER" | "ESCALATED" | null;
  resolvedAt: Date | null;
};

export type StreamUsageReconciliationImportResult = StreamUsageReconciliationDto & {
  duplicate: boolean;
};

type ReconciliationRow = Omit<StreamUsageReconciliationDto, "status" | "evidenceKind" | "resolution"> & {
  status: string;
  evidenceKind: string;
  resolution: string | null;
  sourceDigest: string;
  sourceReference: string | null;
};

type ImportInput = {
  vendorId: string;
  provider: string;
  monthKey: string;
  sourceDigest: string;
  sourceReference?: string | null;
  providerWatchMinutes: number;
  providerStorageMinutes?: number | null;
  capturedAt: Date;
  actorId: string;
  actorLabel: string;
};

type ResolveInput = {
  id: string;
  resolution: "ACCEPT_INTERNAL" | "ACCEPT_PROVIDER" | "ESCALATED";
  note: string;
  actorId: string;
  actorLabel: string;
};

function isPrismaCode(error: unknown, code: "P2002" | "P2034") {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function requireText(value: string, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maxLength) throw new StreamUsageReconciliationError("invalid_input");
  return normalized;
}

function requireNonNegativeInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INTEGER) {
    throw new StreamUsageReconciliationError("invalid_input");
  }
  return value;
}

function normalizeImport(input: ImportInput) {
  const vendorId = requireText(input.vendorId, 191);
  const provider = requireText(input.provider, 64).toUpperCase();
  const monthKey = requireText(input.monthKey, 7);
  const sourceDigest = requireText(input.sourceDigest, 64).toLowerCase();
  const sourceReference = input.sourceReference == null ? null : requireText(input.sourceReference, 120);
  if (
    !PROVIDER_PATTERN.test(provider)
    || !MONTH_KEY_PATTERN.test(monthKey)
    || !SHA256_PATTERN.test(sourceDigest)
    || (sourceReference !== null && !SANITIZED_REFERENCE_PATTERN.test(sourceReference))
    || !(input.capturedAt instanceof Date)
    || Number.isNaN(input.capturedAt.getTime())
    || input.capturedAt.getTime() > Date.now() + MAX_FUTURE_CAPTURED_AT_MS
  ) {
    throw new StreamUsageReconciliationError("invalid_input");
  }

  return {
    vendorId,
    provider,
    monthKey,
    sourceDigest,
    sourceReference,
    providerWatchMinutes: requireNonNegativeInteger(input.providerWatchMinutes),
    providerStorageMinutes: input.providerStorageMinutes == null
      ? null
      : requireNonNegativeInteger(input.providerStorageMinutes),
    capturedAt: input.capturedAt,
    actorId: requireText(input.actorId, 191),
    actorLabel: requireText(input.actorLabel, 200),
  };
}

function normalizeResolve(input: ResolveInput) {
  const id = requireText(input.id, 191);
  const note = requireText(input.note, 500);
  if (note.length < 10 || !["ACCEPT_INTERNAL", "ACCEPT_PROVIDER", "ESCALATED"].includes(input.resolution)) {
    throw new StreamUsageReconciliationError("invalid_input");
  }
  return {
    id,
    note,
    resolution: input.resolution,
    actorId: requireText(input.actorId, 191),
    actorLabel: requireText(input.actorLabel, 200),
  };
}

function isSameImport(row: ReconciliationRow, input: ReturnType<typeof normalizeImport>) {
  return row.vendorId === input.vendorId
    && row.provider === input.provider
    && row.monthKey === input.monthKey
    && row.sourceDigest === input.sourceDigest
    && row.sourceReference === input.sourceReference
    && row.providerWatchMinutes === input.providerWatchMinutes
    && row.providerStorageMinutes === input.providerStorageMinutes
    && row.capturedAt.getTime() === input.capturedAt.getTime();
}

function toDto(row: ReconciliationRow): StreamUsageReconciliationDto {
  return {
    id: row.id,
    vendorId: row.vendorId,
    provider: row.provider,
    monthKey: row.monthKey,
    providerWatchMinutes: row.providerWatchMinutes,
    providerStorageMinutes: row.providerStorageMinutes,
    internalWatchSeconds: row.internalWatchSeconds,
    internalWatchMinutes: row.internalWatchMinutes,
    differenceMinutes: row.differenceMinutes,
    status: row.status as StreamUsageReconciliationDto["status"],
    evidenceKind: row.evidenceKind as StreamUsageReconciliationDto["evidenceKind"],
    capturedAt: row.capturedAt,
    resolution: row.resolution as StreamUsageReconciliationDto["resolution"],
    resolvedAt: row.resolvedAt,
  };
}

function reconciliationAlertDedupKey(input: { vendorId: string; provider: string; monthKey: string }) {
  return `stream-provider-discrepancy:${input.vendorId}:${input.provider}:${input.monthKey}`;
}

async function findConcurrentImport(input: ReturnType<typeof normalizeImport>) {
  const existing = await getDb().streamUsageReconciliation.findUnique({
    where: { provider_sourceDigest: { provider: input.provider, sourceDigest: input.sourceDigest } },
  }) as ReconciliationRow | null;
  if (!existing) return null;
  if (!isSameImport(existing, input)) throw new StreamUsageReconciliationError("conflict");
  return { ...toDto(existing), duplicate: true } satisfies StreamUsageReconciliationImportResult;
}

export async function importStreamUsageReconciliation(input: ImportInput): Promise<StreamUsageReconciliationImportResult> {
  const normalized = normalizeImport(input);
  const db = getDb();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const existing = await tx.streamUsageReconciliation.findUnique({
          where: { provider_sourceDigest: { provider: normalized.provider, sourceDigest: normalized.sourceDigest } },
        }) as ReconciliationRow | null;
        if (existing) {
          if (!isSameImport(existing, normalized)) throw new StreamUsageReconciliationError("conflict");
          return { ...toDto(existing), duplicate: true } satisfies StreamUsageReconciliationImportResult;
        }

        const vendor = await tx.vendor.findUnique({ where: { id: normalized.vendorId }, select: { id: true } });
        if (!vendor) throw new StreamUsageReconciliationError("not_found");

        // Aggregate only the immutable, server-owned ledger. This import does
        // not change billing; a later explicit ACCEPT_PROVIDER resolution may
        // inform a separate, unlocked month-close workflow.
        const ledger = await tx.streamUsageLedgerEntry.aggregate({
          where: { vendorId: normalized.vendorId, monthKey: normalized.monthKey },
          _sum: { watchSeconds: true },
        });
        const internalWatchSeconds = ledger._sum.watchSeconds ?? 0;
        const internalWatchMinutes = Math.ceil(internalWatchSeconds / 60);
        const differenceMinutes = normalized.providerWatchMinutes - internalWatchMinutes;
        const status = Math.abs(differenceMinutes) <= RECONCILIATION_TOLERANCE_MINUTES ? "MATCHED" : "MISMATCH";

        const reconciliation = await tx.streamUsageReconciliation.create({
          data: {
            vendorId: normalized.vendorId,
            provider: normalized.provider,
            monthKey: normalized.monthKey,
            sourceDigest: normalized.sourceDigest,
            sourceReference: normalized.sourceReference,
            providerWatchMinutes: normalized.providerWatchMinutes,
            providerStorageMinutes: normalized.providerStorageMinutes,
            capturedAt: normalized.capturedAt,
            internalWatchSeconds,
            internalWatchMinutes,
            differenceMinutes,
            status,
            evidenceKind: "ADMIN_ATTESTED_DIGEST",
            createdByActorId: normalized.actorId,
            createdByActorLabel: normalized.actorLabel,
          },
        }) as ReconciliationRow;

        if (status === "MISMATCH") {
          await tx.streamOperationsAlert.upsert({
            where: { dedupKey: reconciliationAlertDedupKey(normalized) },
            create: {
              vendorId: normalized.vendorId,
              type: "PROVIDER_DISCREPANCY",
              status: "OPEN",
              dedupKey: reconciliationAlertDedupKey(normalized),
              provider: normalized.provider,
              monthKey: normalized.monthKey,
              severity: "CRITICAL",
              message: `Provider watch total differs from the internal ledger by ${differenceMinutes} minute(s).`,
              reconciliationId: reconciliation.id,
              metadata: { evidenceKind: "ADMIN_ATTESTED_DIGEST", differenceMinutes },
            },
            update: {
              status: "OPEN",
              severity: "CRITICAL",
              message: `Provider watch total differs from the internal ledger by ${differenceMinutes} minute(s).`,
              reconciliationId: reconciliation.id,
              metadata: { evidenceKind: "ADMIN_ATTESTED_DIGEST", differenceMinutes },
              acknowledgedByActorId: null,
              acknowledgedByActorLabel: null,
              acknowledgedAt: null,
              resolvedByActorId: null,
              resolvedByActorLabel: null,
              resolvedAt: null,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            vendorId: normalized.vendorId,
            actorId: normalized.actorId,
            actorLabel: normalized.actorLabel,
            action: "import_stream_usage_reconciliation",
            targetType: "StreamUsageReconciliation",
            targetId: reconciliation.id,
            after: {
              provider: normalized.provider,
              monthKey: normalized.monthKey,
              providerWatchMinutes: normalized.providerWatchMinutes,
              internalWatchSeconds,
              internalWatchMinutes,
              differenceMinutes,
              status,
              evidenceKind: "ADMIN_ATTESTED_DIGEST",
            },
          },
        });

        return { ...toDto(reconciliation), duplicate: false } satisfies StreamUsageReconciliationImportResult;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof StreamUsageReconciliationError) throw error;
      if (!isPrismaCode(error, "P2002") && !isPrismaCode(error, "P2034")) throw error;
      const concurrent = await findConcurrentImport(normalized);
      if (concurrent) return concurrent;
      if (attempt === 0) continue;
      throw new StreamUsageReconciliationError("conflict");
    }
  }
  throw new StreamUsageReconciliationError("conflict");
}

export async function resolveStreamUsageReconciliation(input: ResolveInput): Promise<StreamUsageReconciliationDto> {
  const normalized = normalizeResolve(input);
  const db = getDb();
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.streamUsageReconciliation.findUnique({ where: { id: normalized.id } }) as ReconciliationRow | null;
      if (!current) throw new StreamUsageReconciliationError("not_found");
      if (current.status !== "MISMATCH") throw new StreamUsageReconciliationError("invalid_transition");

      const resolvedAt = new Date();
      const updated = await tx.streamUsageReconciliation.updateMany({
        where: { id: current.id, status: "MISMATCH" },
        data: {
          status: "RESOLVED",
          resolution: normalized.resolution,
          resolutionNote: normalized.note,
          resolvedByActorId: normalized.actorId,
          resolvedByActorLabel: normalized.actorLabel,
          resolvedAt,
        },
      });
      if (updated.count !== 1) throw new StreamUsageReconciliationError("invalid_transition");

      await tx.streamOperationsAlert.updateMany({
        where: {
          vendorId: current.vendorId,
          reconciliationId: current.id,
          type: "PROVIDER_DISCREPANCY",
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
        data: {
          status: "RESOLVED",
          resolvedByActorId: normalized.actorId,
          resolvedByActorLabel: normalized.actorLabel,
          resolvedAt,
        },
      });
      await tx.auditLog.create({
        data: {
          vendorId: current.vendorId,
          actorId: normalized.actorId,
          actorLabel: normalized.actorLabel,
          action: "resolve_stream_usage_reconciliation",
          targetType: "StreamUsageReconciliation",
          targetId: current.id,
          before: { status: "MISMATCH" },
          after: { status: "RESOLVED", resolution: normalized.resolution },
        },
      });

      return toDto({
        ...current,
        status: "RESOLVED",
        resolution: normalized.resolution,
        resolvedAt,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof StreamUsageReconciliationError) throw error;
    if (isPrismaCode(error, "P2002") || isPrismaCode(error, "P2034")) {
      throw new StreamUsageReconciliationError("conflict");
    }
    throw error;
  }
}
