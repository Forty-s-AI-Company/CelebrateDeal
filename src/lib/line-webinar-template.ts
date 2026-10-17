import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { LINE_TEMPLATE_VARIABLE_LIMITS, normalizeMessageTemplateDraft, renderMessageTemplate, type MessageTemplateVariables } from "@/lib/message-template";
import { richTextToPlainText } from "@/lib/rich-text";
import type { LineMessage } from "@/lib/line-client";

export const LINE_BLOCK_HELP_URL = "https://help.line.me/line/ios/?contentId=20000390&lang=zh-Hant";
export type LineWebinarVariables = Omit<MessageTemplateVariables, "unsubscribe_url">;

/** Latest saved template is authoritative, including an explicit inactive choice. */
export function findLineWebinarTemplate(db: Pick<PrismaClient, "messageTemplate">, vendorId: string, trigger: string) {
  return db.messageTemplate.findFirst({
    where: { vendorId, channel: "line", trigger },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true, vendorId: true, name: true, channel: true, trigger: true, subject: true, body: true, isActive: true, updatedAt: true },
  });
}

/** Bind queued content to exact source facts, including same-millisecond edits. */
export function lineWebinarTemplateFingerprint(template: NonNullable<Awaited<ReturnType<typeof findLineWebinarTemplate>>>) {
  return createHash("sha256").update(JSON.stringify([template.id, template.vendorId, template.name, template.channel, template.trigger, template.subject, template.body, template.isActive, template.updatedAt.toISOString()])).digest("hex");
}

function splitLineText(text: string): LineMessage[] | null {
  const chunks: string[] = [];let chunk = "";
  const append = (part: string) => {
    if (part.length > 5000) return false;
    if (chunk.length + part.length > 5000) { chunks.push(chunk);chunk = ""; }
    chunk += part;return chunks.length < 5;
  };
  const segmenter = new Intl.Segmenter("zh-TW", { granularity: "grapheme" });
  for (const token of text.split(/(https?:\/\/\S+)/gu)) {
    // Recognize URLs even directly after Chinese copy. Pack other text at
    // grapheme boundaries so several long paragraphs do not waste whole bubbles.
    if (/^https?:\/\//u.test(token)) { if (!append(token)) return null;continue; }
    for (const part of segmenter.segment(token)) if (!append(part.segment)) return null;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(text => ({ type: "text" as const, text }));
}

export function buildLineWebinarMessages(
  template: { name: string; channel: string; trigger: string; subject: string | null; body: string; isActive: boolean },
  variables: LineWebinarVariables,
): LineMessage[] | null {
  const normalized = normalizeMessageTemplateDraft({ name: template.name, channel: template.channel, trigger: template.trigger, subject: template.subject ?? "", body: template.body, isActive: template.isActive });
  // Pass only the validation contract; callers may supply persistence metadata.
  if (!normalized.success || !normalized.data.isActive || normalized.data.channel !== "line") return null;
  if (Object.entries(variables).some(([name, value]) => value.length > LINE_TEMPLATE_VARIABLE_LIMITS[name])) return null;
  const values = { ...variables, unsubscribe_url: LINE_BLOCK_HELP_URL };
  const subject = renderMessageTemplate(normalized.data.subject, values);
  const body = renderMessageTemplate(richTextToPlainText(normalized.data.body), values);
  const text = [subject, body, variables.live_url && !body.includes(variables.live_url) ? `進場連結：${variables.live_url}` : "", `停止接收：請在 LINE 封鎖本官方帳號。操作說明：${LINE_BLOCK_HELP_URL}`].filter(Boolean).join("\n\n");
  // LINE permits five text objects of at most 5000 UTF-16 units. Do not truncate
  // merchant copy or split a surrogate pair when rendered variables expand it.
  return splitLineText(text);
}
