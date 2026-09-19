import { z } from "zod";

export const CARD_EVENT_TYPE = "interaction_card";
export const CARD_STICKERS = ["👍", "❤️", "🎉", "👏", "🔥", "😊"] as const;
const identifier = z.string().trim().min(1).max(128);
export const CardScheduleSchema = z.object({
  enabled: z.boolean(),
  startSeconds: z.number().int().min(0).max(86400),
  durationSeconds: z.number().int().min(1).max(86400),
}).strict().refine(s => s.startSeconds + s.durationSeconds <= 86400, "排程不可超過 24 小時");
export type CardSchedule = z.infer<typeof CardScheduleSchema>;
export const CardConfigSchema = z.object({
  version: z.literal(1),
  kind: z.literal("interaction_card"),
  answerType: z.enum(["text", "single", "quick", "sticker"]),
  visibility: z.enum(["instructor_only", "public_display"]),
  options: z.array(z.string().trim().min(1).max(40)).max(8),
  schedule: CardScheduleSchema.optional(),
}).strict().superRefine((config, ctx) => {
  if ((config.answerType === "single" || config.answerType === "quick") && config.options.length < 2)
    ctx.addIssue({ code: "custom", message: "請提供至少兩個選項" });
  if (new Set(config.options).size !== config.options.length)
    ctx.addIssue({ code: "custom", message: "選項不能重複" });
});
export type CardConfig = z.infer<typeof CardConfigSchema>;
export const CardScopeSchema = z.object({ vendorId: identifier, liveId: identifier }).strict();
export const CardAnswerSchema = CardScopeSchema.extend({ runId: identifier, value: z.string().trim().min(1).max(160), positionSeconds: z.number().finite().min(0).max(86400).optional() }).strict();
export const CardCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), liveId: identifier, title: z.string().trim().min(1).max(160), configuration: CardConfigSchema }).strict(),
  z.object({ action: z.enum(["start", "end"]), liveId: identifier, runId: identifier }).strict(),
  z.object({ action: z.literal("schedule"), liveId: identifier, runId: identifier, schedule: CardScheduleSchema }).strict(),
]);
export type CardCommand = z.infer<typeof CardCommandSchema>;
export type CardView = { id: string; title: string; status: string; configuration: CardConfig; startsAt: string | null; endsAt: string | null; ownValue: string | null };
export type InstructorCard = CardView & { responseCount: number; answers: Array<{ id: string; value: string; createdAt: string }>; hasMoreAnswers: boolean; options: Array<{ value: string; count: number }> };
export function cardOptions(config: CardConfig): readonly string[] { return config.answerType === "sticker" ? CARD_STICKERS : config.options; }
export function validCardAnswer(config: CardConfig, value: string) {
  return value.trim().length > 0 && value.length <= 160 && (config.answerType === "text" || cardOptions(config).includes(value));
}
// 後續公開傳输只能使用此明確合約；私人回答永遠沒有公開 DTO。
export function publicCardAnswer(config: CardConfig, answer: { id: string; runId: string; value: string }) {
  return config.visibility === "public_display" ? { version: 1 as const, type: "card.answer" as const, id: answer.id, runId: answer.runId, value: answer.value, visibility: "public_display" as const } : null;
}

// 排程與未來傳輸可復用的生命週期 DTO；不包含觀眾身分或回答。
export function cardLifecycle(card: CardView, scope: { vendorId: string; liveId: string }) {
  if (card.status !== "active" && card.status !== "closed") return null;
  return { version: 1 as const, type: card.status === "active" ? "card.started" as const : "card.ended" as const,
    vendorId: scope.vendorId, liveId: scope.liveId, runId: card.id, startsAt: card.startsAt, endsAt: card.endsAt,
    visibility: card.configuration.visibility };
}
