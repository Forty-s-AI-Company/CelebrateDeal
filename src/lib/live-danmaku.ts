import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CardError } from "./interaction-card";
import { CARD_EVENT_TYPE } from "./interaction-card-contract";
import { DANMAKU_BATCH, DANMAKU_TTL, DEFAULT_DANMAKU, DanmakuStateSchema, projectDanmaku, type DanmakuSnapshot } from "./live-danmaku-contract";
import { readWarmup, StoredDanmakuSchema } from "./scripted-roles";

type Scope = { vendorId: string; liveId: string };
/** Same row lock as answerCard: snapshots cannot advance past an uncommitted answer. */
async function lockedState(tx: Prisma.TransactionClient, scope: Scope) {
  const rows = await tx.$queryRaw<Array<{ danmakuState: unknown }>>`SELECT "danmakuState" FROM "Live" WHERE "id"=${scope.liveId} AND "vendorId"=${scope.vendorId} FOR UPDATE`;
  if (!rows[0]) throw new CardError(404);
  return StoredDanmakuSchema.safeParse(rows[0].danmakuState).data ?? DEFAULT_DANMAKU;
}
export async function setDanmaku(db: PrismaClient, scope: Scope, enabled: boolean) {
  return db.$transaction(async tx => {
    const previous = await lockedState(tx, scope);
    if (previous.enabled === enabled) return previous;
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    const state = { ...previous, enabled, epoch: randomUUID(), since: clock!.now.toISOString() };
    await tx.$executeRaw`UPDATE "Live" SET "danmakuState"=${JSON.stringify(state)}::jsonb WHERE "id"=${scope.liveId} AND "vendorId"=${scope.vendorId}`;
    return state;
  });
}
export async function readDanmaku(db: PrismaClient, scope: Scope, cursor?: string, epoch?: string, positionSeconds?: number): Promise<DanmakuSnapshot> {
  return db.$transaction(async tx => {
    const stored = await lockedState(tx, scope);
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    const now = clock!.now;
    const warmup = await readWarmup(tx, scope, stored, now, positionSeconds);
    const state = DanmakuStateSchema.parse({ enabled: stored.enabled, epoch: warmup.epoch, since: stored.since });
    const snapshot: DanmakuSnapshot = { state, cursor: now.toISOString(), items: [] };
    // Initial load, generation changes and reconnects establish a fresh watermark.
    if (!state.enabled || !cursor || epoch !== state.epoch) return snapshot;
    const from = new Date(Math.max(Date.parse(cursor), Date.parse(state.since) + 1, now.getTime() - DANMAKU_TTL));
    const rows = await tx.liveInteractionResponse.findMany({
      where: { ...scope, eventType: CARD_EVENT_TYPE, createdAt: { gte: from, lte: now },
        run: { ...scope, eventType: CARD_EVENT_TYPE, configuration: { path: ["visibility"], equals: "public_display" } } },
      select: { id: true, value: true, createdAt: true, run: { select: { configuration: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: DANMAKU_BATCH,
    });
    snapshot.items = rows.reverse().flatMap(row => { const item = projectDanmaku(row.run.configuration, row); return item ? [item] : []; });
    if (warmup.item) snapshot.items = [...snapshot.items.slice(-(DANMAKU_BATCH - 1)), warmup.item];
    return snapshot;
  });
}
