import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CardError } from "./interaction-card";
import { resolveCardClock } from "./interaction-card-timeline";
import { DEFAULT_DANMAKU, DanmakuStateSchema, type DanmakuItem } from "./live-danmaku-contract";
import { currentWarmup, projectWarmup, SCRIPTED_INTERVAL, SCRIPTED_LIMIT, ScriptedStateSchema, type ScriptedCommand } from "./scripted-roles-contract";

type Scope = { vendorId: string; liveId: string };
export const StoredDanmakuSchema = DanmakuStateSchema.extend({ scripted: ScriptedStateSchema.optional() });
export async function warmupEvents(tx: Prisma.TransactionClient, vendorId: string, scriptId: string) {
  const script = await tx.interactionScript.findFirst({ where: { id: scriptId, vendorId, status: "published" }, select: { id: true } });
  if (!script) throw new CardError(404);
  const events = await tx.interactionEvent.findMany({ where: { scriptId, eventType: { in: ["chat_message", "reminder"] } }, include: { role: true }, orderBy: [{ triggerSec: "asc" }, { id: "asc" }], take: SCRIPTED_LIMIT + 1 });
  if (events.length > SCRIPTED_LIMIT) throw new CardError(409);
  return events.flatMap(e => { const item = projectWarmup(e, vendorId); return item ? [item] : []; });
}
export async function instructorWarmup(db: PrismaClient, scope: Scope) {
  const live = await db.live.findFirst({ where: { id: scope.liveId, vendorId: scope.vendorId }, include: { video: { select: { vendorId: true, durationSec: true } } } });
  if (!live) throw new CardError(404);
  const [row] = await db.$queryRaw<Array<{ danmakuState: unknown }>>`SELECT "danmakuState" FROM "Live" WHERE "id"=${scope.liveId} AND "vendorId"=${scope.vendorId}`;
  const state = StoredDanmakuSchema.safeParse(row?.danmakuState).data?.scripted ?? null;
  const scripts = await db.interactionScript.findMany({ where: { vendorId: scope.vendorId, status: "published" }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, name: true } });
  const events = state ? await db.$transaction(tx => warmupEvents(tx, scope.vendorId, state.scriptId)).catch(() => []) : [];
  return { state, scripts, events, canSchedule: live.streamMode === "vod" && live.video?.vendorId === scope.vendorId && Boolean(live.video.durationSec) && (!live.isEvergreen || Boolean(live.evergreenSessionStartAt)) };
}
export async function commandWarmup(db: PrismaClient, vendorId: string, command: ScriptedCommand) {
  return db.$transaction(async tx => {
    const [row] = await tx.$queryRaw<Array<{ danmakuState: unknown }>>`SELECT "danmakuState" FROM "Live" WHERE "id"=${command.liveId} AND "vendorId"=${vendorId} FOR UPDATE`;
    if (!row) throw new CardError(404);
    const stored = StoredDanmakuSchema.safeParse(row.danmakuState).data ?? { ...DEFAULT_DANMAKU };
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    const now = clock!.now;
    if (command.action === "stop") {
      if (stored.scripted) stored.scripted = { ...stored.scripted, enabled: false, scheduled: false };
    } else if (command.action === "select") {
      const events = await warmupEvents(tx, vendorId, command.scriptId);
      if (!events.length) throw new CardError(409);
      if (command.scheduled) {
        const live = await tx.live.findFirst({ where: { id: command.liveId, vendorId }, include: { video: { select: { vendorId: true, durationSec: true } } } });
        if (!live || live.streamMode !== "vod" || live.video?.vendorId !== vendorId || !live.video.durationSec || (live.isEvergreen && !live.evergreenSessionStartAt)
          || events.some(e => e.triggerSec + 3.5 > live.video!.durationSec!)
          || events.some((e, i) => i > 0 && e.triggerSec - events[i - 1]!.triggerSec < SCRIPTED_INTERVAL / 1000)) throw new CardError(409);
      }
      stored.scripted = { scriptId: command.scriptId, enabled: true, scheduled: command.scheduled, manual: stored.scripted?.manual ?? null };
    } else {
      const state = stored.scripted;
      if (!stored.enabled || !state?.enabled) throw new CardError(409);
      if (state.manual?.requestId === command.requestId) {
        if (state.manual.eventId !== command.eventId) throw new CardError(409);
        return;
      }
      if (state.manual && now.getTime() - Date.parse(state.manual.at) < SCRIPTED_INTERVAL) throw new CardError(429);
      const events = await warmupEvents(tx, vendorId, state.scriptId);
      if (!events.some(e => e.id === command.eventId)) throw new CardError(404);
      stored.scripted = { ...state, manual: { eventId: command.eventId, requestId: command.requestId, at: now.toISOString() } };
    }
    // 停止／換腳本會清除觀眾目前內容；單則發送保留水位避免首批被丟棄。
    if (command.action !== "send") { stored.epoch = randomUUID(); stored.since = now.toISOString(); }
    await tx.$executeRaw`UPDATE "Live" SET "danmakuState"=${JSON.stringify(stored)}::jsonb WHERE "id"=${command.liveId} AND "vendorId"=${vendorId}`;
  });
}

/** 讀取投影，不建立 response、chat、run 或任何真人參與／成交紀錄。 */
export async function readWarmup(tx: Prisma.TransactionClient, scope: Scope, stored: ReturnType<typeof StoredDanmakuSchema.parse>, now: Date, positionSeconds?: number) {
  const state = stored.scripted;
  const result: { epoch: string; item: DanmakuItem | null } = { epoch: stored.epoch, item: null };
  if (!state?.enabled) return result;
  const events = await warmupEvents(tx, scope.vendorId, state.scriptId).catch(() => []);
  // 角色停用、修改與事件刪除也會使客戶端的舊 queue 失效。
  result.epoch = createHash("sha256").update(stored.epoch + JSON.stringify(events)).digest("hex");
  if (!stored.enabled) return result;
  const live = await tx.live.findFirst({ where: { id: scope.liveId, vendorId: scope.vendorId }, include: { video: { select: { vendorId: true, durationSec: true } } } });
  if (!live) return result;
  const clock = resolveCardClock(live, now);
  if (state.manual && Date.parse(state.manual.at) > Date.parse(stored.since) && now.getTime() - Date.parse(state.manual.at) < 3500) {
    const event = events.find(e => e.id === state.manual!.eventId);
    if (event) result.item = { ...event, id: `warmup:manual:${state.manual.requestId}`, source: "scripted_role", createdAt: state.manual.at };
  } else if (state.scheduled && live.video?.vendorId === scope.vendorId) {
    const position = clock.mode === "personal" ? positionSeconds ?? null : clock.mode === "synchronized" ? clock.positionSeconds : null;
    const event = currentWarmup(events, position);
    if (event) result.item = { ...event, id: `warmup:scheduled:${state.scriptId}:${event.id}`, source: "scripted_role", createdAt: new Date(now.getTime() - (position! - event.triggerSec) * 1000).toISOString() };
  }
  return result;
}
