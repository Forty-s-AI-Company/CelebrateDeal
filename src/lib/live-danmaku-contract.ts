import { z } from "zod";
import { CardConfigSchema, validCardAnswer } from "./interaction-card-contract";

export const DANMAKU_BATCH = 20;
export const DANMAKU_TTL = 10_000;
export const DanmakuStateSchema = z.object({ enabled: z.boolean(), epoch: z.string(), since: z.string().datetime() }).strict();
export type DanmakuState = z.infer<typeof DanmakuStateSchema>;
export type DanmakuItem = { id: string; value: string; displayName: string; createdAt: string; source?: "scripted_role"; avatarUrl?: string | null };
export type DanmakuSnapshot = { state: DanmakuState; cursor: string; items: DanmakuItem[] };
export const DEFAULT_DANMAKU: DanmakuState = { enabled: false, epoch: "off", since: new Date(0).toISOString() };
const fresh = (item: DanmakuItem, now: number) => now - Date.parse(item.createdAt) <= (item.source === "scripted_role" ? 3500 : DANMAKU_TTL);

/** Only trusted card configuration can authorize public output; no identity fields are copied. */
export function projectDanmaku(configuration: unknown, row: { id: string; value: string; createdAt: Date }): DanmakuItem | null {
  const config = CardConfigSchema.safeParse(configuration).data;
  if (!config || config.visibility !== "public_display" || config.answerType === "single" || !validCardAnswer(config, row.value)) return null;
  return { id: row.id, value: row.value, displayName: "觀眾", createdAt: row.createdAt.toISOString() };
}

/** A bounded, expiring queue. Hidden/off/reconnected clients discard rather than replay. */
export class DanmakuQueue {
  private epoch = "";
  private seen = new Set<string>();
  private queue: DanmakuItem[] = [];
  clear() { this.queue = []; this.seen.clear(); this.epoch = ""; }
  accept(snapshot: DanmakuSnapshot, visible: boolean, now = Date.now()) {
    if (!snapshot.state.enabled || !visible || this.epoch !== snapshot.state.epoch) {
      this.clear(); this.epoch = snapshot.state.epoch; return;
    }
    for (const item of snapshot.items.slice(0, DANMAKU_BATCH)) {
      if (this.seen.has(item.id)) continue;
      this.seen.add(item.id);
      if (fresh(item, now)) this.queue.push(item);
    }
    this.queue = this.queue.filter(item => fresh(item, now)).slice(-DANMAKU_BATCH);
    if (this.seen.size > 200) this.seen = new Set([...this.seen].slice(-100));
  }
  next(now = Date.now()) {
    this.queue = this.queue.filter(item => fresh(item, now));
    return this.queue.shift() ?? null;
  }
}
