import { z } from "zod";
import { isCanonicalInteractionRolePresetUrl } from "./interaction-role";

export const SCRIPTED_INTERVAL = 5_000;
export const SCRIPTED_LIMIT = 100;
export const ScriptedStateSchema = z.object({
  scriptId: z.string().min(1).max(128),
  enabled: z.boolean(), scheduled: z.boolean(),
  manual: z.object({ eventId: z.string(), requestId: z.string().uuid(), at: z.string().datetime() }).strict().nullable(),
}).strict();
export type ScriptedState = z.infer<typeof ScriptedStateSchema>;
export const ScriptedCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), liveId: z.string().min(1).max(128), scriptId: z.string().min(1).max(128), scheduled: z.boolean() }).strict(),
  z.object({ action: z.literal("stop"), liveId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("send"), liveId: z.string().min(1).max(128), eventId: z.string().min(1).max(128), requestId: z.string().uuid() }).strict(),
]);
export type ScriptedCommand = z.infer<typeof ScriptedCommandSchema>;
export type WarmupEvent = { id: string; triggerSec: number; value: string; displayName: string; avatarUrl: string | null };

/** 只投影既有文字事件；來源標記與標籤由伺服器決定，從不接受成交事件。 */
export function projectWarmup(event: { id: string; triggerSec: number; eventType: string; message: string | null; role: { vendorId: string; name: string; avatarUrl: string | null; isActive: boolean; isScheduled: boolean } | null }, vendorId: string): WarmupEvent | null {
  const role = event.role;
  const value = event.message?.trim();
  if (!role || role.vendorId !== vendorId || !role.isActive || !role.isScheduled || !role.name.trim() || role.name.length > 160
    || !["chat_message", "reminder"].includes(event.eventType) || !value || value.length > 160
    || !Number.isInteger(event.triggerSec) || event.triggerSec < 0 || event.triggerSec > 86400) return null;
  return { id: event.id, triggerSec: event.triggerSec, value, displayName: role.name,
    avatarUrl: isCanonicalInteractionRolePresetUrl(role.avatarUrl) ? role.avatarUrl : null };
}

/** 每個時間窗最多一則，不掃描或補播被 seek 跳過的事件。 */
export function currentWarmup(events: readonly WarmupEvent[], position: number | null) {
  if (position === null || !Number.isFinite(position)) return null;
  return events.filter(e => position >= e.triggerSec && position < e.triggerSec + 3.5)
    .sort((a, b) => b.triggerSec - a.triggerSec || a.id.localeCompare(b.id))[0] ?? null;
}
