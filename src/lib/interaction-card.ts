import { Prisma, type PrismaClient, type LiveInteractionRun } from "@prisma/client";
import { CARD_EVENT_TYPE, CardConfigSchema, cardOptions, validCardAnswer, type CardCommand, type CardView, type InstructorCard } from "./interaction-card-contract";
import { resolveCardClock, selectScheduledCard, type CardTimeline } from "./interaction-card-timeline";

type Scope = { vendorId: string; liveId: string };
export class CardError extends Error { constructor(public status: number) { super("互動卡片暫時無法操作，請重新整理後再試。"); } }
function project(run: LiveInteractionRun, ownValue: string | null = null): CardView {
  return { id: run.id, title: run.title, status: run.status, configuration: CardConfigSchema.parse(run.configuration),
    startsAt: run.status === "draft" ? null : run.startsAt.toISOString(), endsAt: run.status === "closed" ? run.endsAt.toISOString() : null, ownValue };
}
// 所有卡片寫入先鎖活動列，序列化開始／切換／結束／回答，避免 TOCTOU。
async function lockLive(tx: Prisma.TransactionClient, scope: Scope) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Live" WHERE "id" = ${scope.liveId} AND "vendorId" = ${scope.vendorId} FOR UPDATE`;
  if (!rows.length) throw new CardError(404);
}
async function manualCardAllowed(db: Prisma.TransactionClient, scope: Scope) {
  const live = await db.live.findFirst({ where: { id: scope.liveId, vendorId: scope.vendorId }, select: { streamMode: true, status: true } });
  return Boolean(live && (live.streamMode !== "live" || live.status === "live"));
}
export async function commandCard(db: PrismaClient, vendorId: string, command: CardCommand) {
  const scope = { vendorId, liveId: command.liveId };
  return db.$transaction(async tx => {
    await lockLive(tx, scope);
    if (command.action === "create") {
      if (command.configuration.schedule) throw new CardError(400);
      const row = await tx.liveInteractionRun.create({ data: { ...scope, eventType: CARD_EVENT_TYPE, source: "manual", status: "draft", title: command.title,
        configuration: command.configuration as Prisma.InputJsonValue, endsAt: new Date(0) } });
      return project(row);
    }
    const row = await tx.liveInteractionRun.findFirst({ where: { ...scope, id: command.runId, eventType: CARD_EVENT_TYPE } });
    if (!row) throw new CardError(404);
    const now = new Date();
    if (command.action === "schedule") {
      if (row.status !== "draft") throw new CardError(409);
      const live = await tx.live.findFirst({ where: { id: scope.liveId, vendorId }, include: { video: { select: { vendorId: true, durationSec: true } } } });
      const schedule = command.schedule;
      if (schedule.enabled && (!live || live.streamMode !== "vod" || live.video?.vendorId !== vendorId || !live.video.durationSec
        || schedule.startSeconds + schedule.durationSeconds > live.video.durationSec
        || (live.isEvergreen && !live.evergreenSessionStartAt))) throw new CardError(400);
      const count = await tx.liveInteractionRun.count({ where: { ...scope, eventType: CARD_EVENT_TYPE, status: "draft", configuration: { path: ["schedule", "enabled"], equals: true }, NOT: { id: row.id } } });
      if (schedule.enabled && count >= 100) throw new CardError(409);
      const configuration = { ...CardConfigSchema.parse(row.configuration), schedule };
      return project(await tx.liveInteractionRun.update({ where: { id: row.id }, data: { configuration: configuration as Prisma.InputJsonValue } }));
    }
    if (command.action === "start") {
      if (!await manualCardAllowed(tx, scope)) throw new CardError(409);
      if (row.status === "active") return project(row);
      if (row.status !== "draft") throw new CardError(409);
      await tx.liveInteractionRun.updateMany({ where: { ...scope, eventType: CARD_EVENT_TYPE, status: "active" }, data: { status: "closed", endsAt: now } });
      // 手動結束不依賴倒數；保留既有非 nullable endsAt 欄位相容性。
      const configuration = CardConfigSchema.parse(row.configuration);
      if (configuration.schedule) configuration.schedule.enabled = false;
      return project(await tx.liveInteractionRun.update({ where: { id: row.id }, data: { configuration: configuration as Prisma.InputJsonValue, status: "active", startsAt: now, endsAt: new Date("9999-12-31T00:00:00Z") } }));
    }
    if (row.status === "draft" && !CardConfigSchema.parse(row.configuration).schedule) throw new CardError(409);
    return project(row.status === "closed" ? row : await tx.liveInteractionRun.update({ where: { id: row.id }, data: { status: "closed", endsAt: now } }));
  });
}
export async function viewerCard(db: PrismaClient, scope: Scope, participantHash: string) {
  const run = await db.liveInteractionRun.findFirst({ where: { ...scope, eventType: CARD_EVENT_TYPE, status: "active" }, orderBy: { startsAt: "desc" } });
  if (!run) return null;
  const own = await db.liveInteractionResponse.findUnique({ where: { runId_participantHash: { runId: run.id, participantHash } }, select: { value: true } });
  return project(run, own?.value ?? null);
}
export async function answerCard(db: PrismaClient, scope: Scope, participantHash: string, runId: string, value: string, positionSeconds?: number, now?: Date) {
  return db.$transaction(async tx => {
    await lockLive(tx, scope);
    const run = await tx.liveInteractionRun.findFirst({ where: { ...scope, id: runId, eventType: CARD_EVENT_TYPE } });
    if (!run) throw new CardError(404);
    const own = await tx.liveInteractionResponse.findUnique({ where: { runId_participantHash: { runId, participantHash } } });
    // 重送相同回答回傳原紀錄，包含結束後的網路重試；改答一律拒絕。
    if (own) { if (own.value !== value) throw new CardError(409); return project(run, own.value); }
    const config = CardConfigSchema.parse(run.configuration);
    if (run.status === "active" && !await manualCardAllowed(tx, scope)) throw new CardError(409);
    if (run.status !== "active") {
      const timeline = await readTimeline(tx, scope, participantHash, now);
      const manual = await tx.liveInteractionRun.findFirst({ where: { ...scope, eventType: CARD_EVENT_TYPE, status: "active" } });
      const position = timeline.clock.mode === "personal" ? positionSeconds ?? null : timeline.clock.positionSeconds;
      if (manual || selectScheduledCard(timeline.cards, position)?.id !== run.id) throw new CardError(409);
    }
    if (!validCardAnswer(config, value)) throw new CardError(400);
    // Use the DB wall clock after the activity lock, not transaction-start now().
    // Otherwise a waiting answer could fall behind the danmaku snapshot watermark.
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    // Bound each admitted participant across cards; idempotent retries returned above.
    const recent = await tx.liveInteractionResponse.count({ where: { ...scope, participantHash, eventType: CARD_EVENT_TYPE, createdAt: { gte: new Date(clock!.now.getTime() - 10_000) } } });
    if (recent >= 3) throw new CardError(429);
    await tx.liveInteractionResponse.create({ data: { ...scope, runId, participantHash, eventType: CARD_EVENT_TYPE, value, createdAt: clock!.now } });
    return project(run, value);
  });
}

async function readTimeline(db: Prisma.TransactionClient, scope: Scope, participantHash: string, now?: Date): Promise<CardTimeline> {
  const live = await db.live.findFirst({ where: { id: scope.liveId, vendorId: scope.vendorId }, include: { video: { select: { vendorId: true, durationSec: true } } } });
  if (!live) throw new CardError(404);
  const clock = resolveCardClock(live, now ?? new Date());
  if (live.video?.vendorId !== scope.vendorId || !["personal", "synchronized"].includes(clock.mode)) return { clock: { mode: clock.mode === "manual" ? "manual" : "unavailable", positionSeconds: null }, cards: [] };
  const runs = await db.liveInteractionRun.findMany({ where: { ...scope, eventType: CARD_EVENT_TYPE, status: "draft", configuration: { path: ["schedule", "enabled"], equals: true } }, take: 100, orderBy: { id: "asc" } });
  const own = await db.liveInteractionResponse.findMany({ where: { ...scope, participantHash, runId: { in: runs.map(r => r.id) } }, select: { runId: true, value: true } });
  return { clock, cards: runs.map(run => project(run, own.find(a => a.runId === run.id)?.value ?? null)) };
}

export async function viewerCardSnapshot(db: PrismaClient, scope: Scope, participantHash: string, now?: Date) {
  return db.$transaction(async tx => {
    const run = await tx.liveInteractionRun.findFirst({ where: { ...scope, eventType: CARD_EVENT_TYPE, status: "active" }, orderBy: { startsAt: "desc" } });
    const own = run ? await tx.liveInteractionResponse.findUnique({ where: { runId_participantHash: { runId: run.id, participantHash } }, select: { value: true } }) : null;
    return { card: run && await manualCardAllowed(tx, scope) ? project(run, own?.value ?? null) : null, timeline: await readTimeline(tx, scope, participantHash, now) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function cardTimelineCapability(db: PrismaClient, scope: Scope) {
  const live = await db.live.findFirst({ where: { id: scope.liveId, vendorId: scope.vendorId }, include: { video: { select: { vendorId: true, durationSec: true } } } });
  if (!live) throw new CardError(404);
  return { enabled: live.streamMode === "vod" && live.video?.vendorId === scope.vendorId && Boolean(live.video.durationSec) && (!live.isEvergreen || Boolean(live.evergreenSessionStartAt)), durationSeconds: live.video?.durationSec ?? null };
}
export async function instructorCards(db: PrismaClient, scope: Scope, answerRunId?: string): Promise<InstructorCard[]> {
  const live = await db.live.findFirst({ where: { id: scope.liveId, vendorId: scope.vendorId }, select: { id: true } });
  if (!live) throw new CardError(404);
  const [recent, controlled] = await Promise.all([
    db.liveInteractionRun.findMany({ where: { ...scope, eventType: CARD_EVENT_TYPE }, orderBy: { createdAt: "desc" }, take: 100 }),
    // 啟用排程／目前手動題不可被最近 100 題擠掉，講師必須一直能結束它們。
    db.liveInteractionRun.findMany({ where: { ...scope, eventType: CARD_EVENT_TYPE, OR: [{ status: "active" }, { status: "draft", configuration: { path: ["schedule", "enabled"], equals: true } }] }, orderBy: { id: "asc" }, take: 101 }),
  ]);
  const runs = [...new Map([...controlled, ...recent].map(run => [run.id, run])).values()];
  const ids = runs.map(run => run.id);
  const selectedIds = runs.filter(run => CardConfigSchema.parse(run.configuration).answerType !== "text").map(run => run.id);
  // Batch summaries; load answer details only for the selected question.
  const [counts, groups, answers] = await Promise.all([
    db.liveInteractionResponse.groupBy({ by: ["runId"], where: { ...scope, runId: { in: ids } }, _count: { _all: true } }),
    db.liveInteractionResponse.groupBy({ by: ["runId", "value"], where: { ...scope, runId: { in: selectedIds } }, _count: { _all: true } }),
    answerRunId && ids.includes(answerRunId) ? db.liveInteractionResponse.findMany({ where: { ...scope, runId: answerRunId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, value: true, createdAt: true } }) : Promise.resolve([]),
  ]);
  return runs.map(run => {
    const config = CardConfigSchema.parse(run.configuration);
    const responseCount = counts.find(c => c.runId === run.id)?._count._all ?? 0;
    const ownAnswers = run.id === answerRunId ? answers : [];
    return { ...project(run), responseCount, answers: ownAnswers.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })), hasMoreAnswers: run.id === answerRunId && responseCount > ownAnswers.length,
      options: cardOptions(config).map(value => ({ value, count: groups.find(g => g.runId === run.id && g.value === value)?._count._all ?? 0 })) };
  });
}
