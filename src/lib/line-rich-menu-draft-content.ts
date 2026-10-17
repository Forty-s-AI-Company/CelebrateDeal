import { z } from "zod";
import { LineRichMenuSchema, type LineRichMenu } from "@/lib/line-rich-menu";

const remoteId = z.string().regex(/^richmenu-[a-f0-9]{32}$/u).nullable();
export const RichMenuPublicationRecordSchema = z.object({
  attemptId: z.string().uuid(),
  status: z.enum(["syncing","synced","uncertain","failed","conflict","outdated"]),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  accountId: z.string().min(1).max(128),
  accountVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceRevision: z.number().int().positive(),
  startedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  stage: z.enum(["read_default","create","upload","check_current","set_default","confirm"]),
  remoteMenuId: remoteId,
  previousMenuId: remoteId,
  previousDefaultKnown: z.boolean(),
  confirmedAt: z.string().datetime().nullable(),
  links:z.object({live_url:z.string().max(1000).optional(),consultation_url:z.string().max(1000).optional(),portal_url:z.string().max(1000).optional(),voucher_url:z.string().max(1000).optional()}).strict().default({}),
}).strict();
export type RichMenuPublicationRecord = z.infer<typeof RichMenuPublicationRecordSchema>;
const ContentSchema = z.object({ version:z.literal(1),menu:LineRichMenuSchema,publication:RichMenuPublicationRecordSchema.nullable() }).strict();
export type RichMenuDraftContent = z.infer<typeof ContentSchema>;

/** Raw legacy menu JSON stays readable; only new publication records use an envelope. */
export function parseRichMenuDraftContent(value: unknown): RichMenuDraftContent | null {
  const legacy=LineRichMenuSchema.safeParse(value);
  if(legacy.success)return {version:1,menu:legacy.data,publication:null};
  const content=ContentSchema.safeParse(value);return content.success?content.data:null;
}
export function richMenuPublicationLocked(record: RichMenuPublicationRecord | null) {
  return record?.status==="syncing" || record?.status==="uncertain";
}
export function saveRichMenuDraftContent(menu: LineRichMenu, previous: RichMenuPublicationRecord | null) {
  return previous ? {version:1 as const,menu,publication:{...previous,status:"outdated" as const}} : menu;
}
export type RichMenuPublicationView = Pick<RichMenuPublicationRecord,"status"|"confirmedAt"|"expiresAt"|"links">;
export function richMenuPublicationView(record: RichMenuPublicationRecord | null): RichMenuPublicationView | null {
  return record?{status:record.status,confirmedAt:record.confirmedAt,expiresAt:record.expiresAt,links:record.links}:null;
}
