import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import type { LiveNotificationRuleTrigger } from "@/lib/live-notification-rules";
import { hasOnlySupportedMessageTemplateVariables } from "@/lib/message-template";

/**
 * Shared contract of the live studio's 「就地建立」 drawers: the registration
 * form and the three Email templates the studio can bind. Client-safe; the
 * Server Actions in `src/app/actions/live-resource-quick-create.ts` re-check
 * everything here.
 */
export const LIVE_QUICK_TEMPLATE_TRIGGERS = ["registration_confirmed", "live_reminder", "post_live_followup"] as const;
export type LiveQuickTemplateTrigger = (typeof LIVE_QUICK_TEMPLATE_TRIGGERS)[number];

export function isLiveQuickTemplateTrigger(value: unknown): value is LiveQuickTemplateTrigger {
  return typeof value === "string" && (LIVE_QUICK_TEMPLATE_TRIGGERS as readonly string[]).includes(value);
}

/** Same shape the live pages hand the studio for its registration form select. */
export type LiveQuickFormOption = { id: string; name: string };
/** Same shape the live pages hand the studio for its template selects. */
export type LiveQuickTemplateOption = { id: string; name: string; channel: string; trigger: string };

export type LiveQuickFormField = "root" | "name" | "headline";
export type LiveQuickTemplateField = "root" | "name" | "trigger" | "subject" | "body";

export type LiveQuickCreateResult<Option, Field extends string> =
  | { status: "success"; option: Option }
  | { status: "error"; message: string; fieldErrors: Partial<Record<Field, string>> };

export type LiveQuickFormResult = LiveQuickCreateResult<LiveQuickFormOption, LiveQuickFormField>;
export type LiveQuickTemplateResult = LiveQuickCreateResult<LiveQuickTemplateOption, LiveQuickTemplateField>;

/** Same shape the live pages hand the studio for its video select. */
export type LiveQuickVideoOption = { id: string; title: string };
export type LiveQuickVideoField = "root" | "title" | "videoUrl";
/**
 * `ready` is the shared live readiness of the created row: only a ready video
 * may join the studio's select; anything else waits in its processing list.
 */
export type LiveQuickVideoResult =
  | { status: "success"; option: LiveQuickVideoOption; ready: boolean }
  | { status: "error"; message: string; fieldErrors: Partial<Record<LiveQuickVideoField, string>> };

/** The Cloudflare upload routes accept titles up to 160 characters. */
export const LIVE_QUICK_VIDEO_LIMITS = { title: 160, videoUrl: 2048 } as const;

export const LIVE_QUICK_FORM_LIMITS = { name: 120, headline: 200 } as const;
export const LIVE_QUICK_TEMPLATE_LIMITS = { name: 160, subject: 200, body: 20_000 } as const;

export const LIVE_QUICK_TEMPLATE_COPY: Record<LiveQuickTemplateTrigger, { label: string; name: string; subject: string; body: string }> = {
  registration_confirmed: {
    label: "報名成功 Email",
    name: "報名成功通知",
    subject: "{{live_title}} 報名成功",
    body: "{{name}} 你好：\n\n你已完成「{{live_title}}」的報名，開播時間是 {{live_start_at}}。\n\n開播時請從這個連結進入直播間：\n{{live_url}}\n\n{{vendor_name}}",
  },
  live_reminder: {
    label: "開播提醒 Email",
    name: "開播提醒",
    subject: "{{live_title}} 即將開始",
    body: "{{name}} 你好：\n\n「{{live_title}}」將在 {{live_start_at}} 開始，請準時從這個連結進入直播間：\n{{live_url}}\n\n{{vendor_name}}",
  },
  post_live_followup: {
    label: "課後 Email",
    name: "課後通知",
    subject: "感謝參加 {{live_title}}",
    body: "{{name}} 你好：\n\n謝謝你參加「{{live_title}}」。如果想回顧內容，可以從這個連結回到直播頁：\n{{live_url}}\n\n{{vendor_name}}",
  },
};

/**
 * Starting copy for a template opened from the 「直播中」 rule group. It is
 * still a `live_reminder` template (the only trigger the studio binds for
 * that group), but it must read right for viewers who are already live.
 */
export const LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY = {
  label: "直播中通知 Email",
  name: "直播中通知",
  subject: "{{live_title}} 正在直播中",
  body: "{{name}} 你好：\n\n「{{live_title}}」正在直播中，現在就可以從這個連結進入直播間：\n{{live_url}}\n\n{{vendor_name}}",
} as const;

/** Title and starting copy of the template drawer for the trigger and the rule group it was opened from. */
export function liveQuickTemplateCopy(trigger: LiveQuickTemplateTrigger, ruleTrigger?: LiveNotificationRuleTrigger) {
  if (trigger === "live_reminder" && ruleTrigger === "during_live") return LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY;
  return LIVE_QUICK_TEMPLATE_COPY[trigger];
}

/**
 * Field-level checks for the quick template drawer. They mirror the template
 * validator (`normalizeMessageTemplateDraft`), which the server still runs,
 * so the drawer can point at the field to fix.
 */
export function liveQuickTemplateFieldErrors(draft: { name: string; subject: string; body: string }) {
  const errors: Partial<Record<LiveQuickTemplateField, string>> = {};
  const name = draft.name.trim();
  const subject = draft.subject.replace(/\s+/gu, " ").trim();
  const body = draft.body.replace(/\r\n?/gu, "\n").trim();
  if (!name) errors.name = "請填寫模板名稱。";
  else if (name.length > LIVE_QUICK_TEMPLATE_LIMITS.name) errors.name = `模板名稱不可超過 ${LIVE_QUICK_TEMPLATE_LIMITS.name} 個字。`;
  if (!subject) errors.subject = "請填寫 Email 主旨。";
  else if (subject.length > LIVE_QUICK_TEMPLATE_LIMITS.subject) errors.subject = `Email 主旨不可超過 ${LIVE_QUICK_TEMPLATE_LIMITS.subject} 個字。`;
  else if (!hasOnlySupportedMessageTemplateVariables(subject)) errors.subject = "主旨含有不支援的變數，只能使用下方列出的變數。";
  if (!body) errors.body = "請填寫 Email 內容。";
  else if (body.length > LIVE_QUICK_TEMPLATE_LIMITS.body) errors.body = `Email 內容不可超過 ${LIVE_QUICK_TEMPLATE_LIMITS.body.toLocaleString("en-US")} 個字。`;
  else if (!hasOnlySupportedMessageTemplateVariables(body)) errors.body = "內容含有不支援的變數，只能使用下方列出的變數。";
  return errors;
}

/**
 * Field-level checks for the external-URL video in the studio's video drawer;
 * the server validates the URL again with the same parser as the video editor.
 */
export function liveQuickVideoFieldErrors(draft: { title: string; videoUrl: string }) {
  const errors: Partial<Record<LiveQuickVideoField, string>> = {};
  const title = draft.title.trim();
  const videoUrl = draft.videoUrl.trim();
  if (!title) errors.title = "請填寫影片名稱。";
  else if (title.length > LIVE_QUICK_VIDEO_LIMITS.title) errors.title = `影片名稱不可超過 ${LIVE_QUICK_VIDEO_LIMITS.title} 個字。`;
  if (!videoUrl) errors.videoUrl = "請貼上影片網址。";
  else if (videoUrl.length > LIVE_QUICK_VIDEO_LIMITS.videoUrl || !parseSafeExternalHttpUrl(videoUrl)) errors.videoUrl = "影片網址必須是有效的 HTTP 或 HTTPS 完整網址。";
  return errors;
}

/** Puts locally created options first, then the server's, without duplicates. */
export function mergeLiveResourceOptions<Option extends { id: string }>(serverOptions: Option[], localOptions: Option[]) {
  const serverIds = new Set(serverOptions.map((option) => option.id));
  return [...localOptions.filter((option) => !serverIds.has(option.id)), ...serverOptions];
}
