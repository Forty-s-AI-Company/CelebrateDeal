import type { Prisma, PrismaClient } from "@prisma/client";
import type { AdvancedInteractionMetadata } from "@/lib/interaction-event";
import { FlashSaleUnavailableError, resolveFlashSaleTerms } from "@/lib/live-flash-sale";
import { luckyDrawClaimEnvelopePurpose, pollPercentagesFromCounts } from "@/lib/live-interaction";
import { decryptSensitiveValue } from "@/lib/sensitive-data";

/**
 * Viewer-facing projection of live interaction state. Shared by
 * `GET /api/live-interactions` and the merged `GET /api/live-updates` poll
 * (F-091 (2)); callers must have admitted the viewer first and pass the
 * participant hash derived from the admission token.
 */

type ViewerStateDatabase = PrismaClient;

export function interactionConfiguration(value: Prisma.JsonValue): AdvancedInteractionMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("kind" in value)) return null;
  return value as unknown as AdvancedInteractionMetadata;
}

export async function projectInteractionRun(db: ViewerStateDatabase, runId: string, participantHash: string) {
  const run = await db.liveInteractionRun.findUnique({
    where: { id: runId },
  });
  if (!run) return null;
  const metadata = interactionConfiguration(run.configuration);
  if (!metadata) return null;
  const sale = metadata.kind === "flash_sale" ? await resolveFlashSaleTerms(db, {
    vendorId: run.vendorId, liveId: run.liveId, productId: metadata.productId, title: run.title, configuration: run.configuration,
  }).catch((error: unknown) => {
    if (error instanceof FlashSaleUnavailableError) return null;
    throw error;
  }) : null;
  if (metadata.kind === "flash_sale" && !sale) return null;
  const [responseCount, ownResponse, pollCounts, winnerResponse] = await Promise.all([
    db.liveInteractionResponse.count({ where: { runId } }),
    db.liveInteractionResponse.findUnique({
      where: { runId_participantHash: { runId, participantHash } },
      select: { id: true, value: true },
    }),
    metadata.kind === "poll"
      ? db.liveInteractionResponse.groupBy({ by: ["value"], where: { runId }, _count: { _all: true } })
      : Promise.resolve([]),
    run.winnerResponseId
      ? db.liveInteractionResponse.findUnique({ where: { id: run.winnerResponseId }, select: { id: true, displayName: true, winnerClaimCodeEncryptedEnvelope: true } })
      : Promise.resolve(null),
  ]);
  const countMap = new Map<string, number>();
  for (const row of pollCounts) {
    let selections: string[] = [row.value];
    if (row.value.startsWith("[")) {
      try {
        const parsed = JSON.parse(row.value) as unknown;
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) selections = parsed;
      } catch { /* Legacy/single values stay valid. */ }
    }
    for (const selection of selections) countMap.set(selection, (countMap.get(selection) ?? 0) + row._count._all);
  }
  const winnerIsViewer = Boolean(run.winnerResponseId && ownResponse?.id === run.winnerResponseId);
  let winnerClaimCode: string | null = null;
  // The encrypted code is read only for the matching winner response. A failed
  // decrypt stays fail-closed: the UI never receives an unverifiable fallback.
  if (winnerIsViewer && winnerResponse?.winnerClaimCodeEncryptedEnvelope) {
    try {
      winnerClaimCode = decryptSensitiveValue(
        winnerResponse.winnerClaimCodeEncryptedEnvelope,
        luckyDrawClaimEnvelopePurpose(run.vendorId, winnerResponse.id),
      );
    } catch {
      winnerClaimCode = null;
    }
  }
  return {
    id: run.id,
    eventType: run.eventType,
    title: run.title,
    status: run.status,
    startsAt: run.startsAt.toISOString(),
    endsAt: run.endsAt.toISOString(),
    metadata,
    sale,
    responseCount,
    responded: Boolean(ownResponse),
    ownValue: ownResponse?.value ?? null,
    pollResults: metadata.kind === "poll" ? pollPercentagesFromCounts(metadata.options, countMap) : null,
    winner: winnerResponse ? winnerResponse.displayName ?? "幸運觀眾" : null,
    winnerIsViewer,
    winnerClaimCode,
    winnerRevealedAt: run.winnerResponseId ? run.updatedAt.toISOString() : null,
    prizeName: metadata.kind === "lucky_draw" ? (metadata.prizeName ?? null) : null,
  };
}

/** Manual interaction runs (most recent first) plus the spotlighted question. */
export async function readViewerInteractionState(
  db: ViewerStateDatabase,
  input: { vendorId: string; liveId: string; participantHash: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const { vendorId, liveId } = input;
  const [runs, spotlight] = await Promise.all([db.liveInteractionRun.findMany({
    where: {
      vendorId,
      liveId,
      source: "manual",
      eventType: { not: "interaction_card" },
      OR: [{ status: "active", endsAt: { gt: now } }, { winnerResponseId: { not: null }, updatedAt: { gt: new Date(now.getTime() - 30_000) } }],
    },
    orderBy: { startsAt: "desc" },
    take: 3,
    select: { id: true },
  }), db.liveQuestion.findFirst({
    where: { vendorId, liveId, status: "spotlight" },
    orderBy: { spotlightedAt: "desc" },
    select: { id: true, body: true, displayName: true, spotlightedAt: true },
  })]);
  const projected = await Promise.all(runs.map(({ id }) => projectInteractionRun(db, id, input.participantHash)));
  return { runs: projected.filter(Boolean), spotlight };
}
