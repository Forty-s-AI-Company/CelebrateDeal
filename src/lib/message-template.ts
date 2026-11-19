import { z } from "zod";
import { safeRecipientNameOr } from "@/lib/safe-recipient-name";

export const MESSAGE_TEMPLATE_CHANNELS = ["email", "line"] as const;
export const MESSAGE_TEMPLATE_TRIGGERS = [
  "registration_confirmed",
  "live_reminder",
  "live_started",
  "order_created",
  "order_paid",
  "commission_credited",
  "post_live_followup",
  // F-3 Email 追銷序列的每一步（src/lib/delayed-step-runs.ts）。
  "sequence_email",
] as const;
export const MESSAGE_TEMPLATE_VARIABLES = [
  "name",
  "live_title",
  "live_url",
  "live_start_at",
  "vendor_name",
  "unsubscribe_url",
] as const;

export const REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE = {
  channel: "email",
  trigger: "registration_confirmed",
  isActive: true,
} as const;

export const LIVE_REMINDER_EMAIL_TEMPLATE_WHERE = {
  channel: "email",
  trigger: "live_reminder",
  isActive: true,
} as const;

export const SEQUENCE_EMAIL_TEMPLATE_WHERE = {
  channel: "email",
  trigger: "sequence_email",
  isActive: true,
} as const;

export const LIVE_REMINDER_OFFSET_OPTIONS = [15, 30, 60, 180, 1440] as const;

const variablePattern = /\{\{\s*([a-z_]+)\s*\}\}/gu;
const renderableVariablePattern = /\{\{\s*(name|live_title|live_url|live_start_at|vendor_name|unsubscribe_url)\s*\}\}/gu;
const allowedVariables = new Set<string>(MESSAGE_TEMPLATE_VARIABLES);

export type MessageTemplateVariables = Record<typeof MESSAGE_TEMPLATE_VARIABLES[number], string>;

const MessageTemplateDraftSchema = z.object({
  name: z.string().trim().min(1).max(160),
  channel: z.enum(MESSAGE_TEMPLATE_CHANNELS),
  trigger: z.enum(MESSAGE_TEMPLATE_TRIGGERS),
  subject: z.string().transform((value) => value.replace(/\s+/gu, " ").trim()).pipe(z.string().min(1).max(200)),
  body: z.string().transform((value) => value.replace(/\r\n?/gu, "\n").trim()).pipe(z.string().min(1).max(20_000)),
  isActive: z.boolean(),
}).strict();

export type MessageTemplateDraft = z.infer<typeof MessageTemplateDraftSchema>;

export type MessageTemplateFormDraft = {
  name: string;
  channel: string;
  trigger: string;
  subject: string;
  body: string;
  isActive: boolean;
};

export type MessageTemplateFormTemplate = MessageTemplateFormDraft & {
  id: string;
  updatedAt: string;
};

export type MessageTemplateActionError = "invalid_template" | "missing_template" | "conflict" | "in_use_by_sequence" | "sequence_email_unavailable";

export type MessageTemplateActionState = {
  status: "idle" | "error";
  error: MessageTemplateActionError | null;
  draft: MessageTemplateFormDraft | null;
  expectedUpdatedAt: string | null;
  version: number;
};

export const initialMessageTemplateActionState: MessageTemplateActionState = {
  status: "idle",
  error: null,
  draft: null,
  expectedUpdatedAt: null,
  version: 0,
};

export type MessageTemplateDraftResult =
  | { success: true; data: MessageTemplateDraft }
  | { success: false };

export function hasOnlySupportedMessageTemplateVariables(value: string) {
  const withoutSupportedVariables = value.replace(variablePattern, (_, variable: string) => (
    allowedVariables.has(variable) ? "" : `{{${variable}}}`
  ));
  return !withoutSupportedVariables.includes("{{") && !withoutSupportedVariables.includes("}}");
}

export function hasUsableMessageTemplateContent(template: { subject: string | null; body: string }) {
  return Boolean(
    template.subject?.trim()
    && template.body.trim()
    && hasOnlySupportedMessageTemplateVariables(template.subject)
    && hasOnlySupportedMessageTemplateVariables(template.body),
  );
}

export function normalizeMessageTemplateDraft(input: unknown): MessageTemplateDraftResult {
  const parsed = MessageTemplateDraftSchema.safeParse(input);
  if (!parsed.success) return { success: false };
  if (!hasOnlySupportedMessageTemplateVariables(parsed.data.subject) || !hasOnlySupportedMessageTemplateVariables(parsed.data.body)) {
    return { success: false };
  }
  return { success: true, data: parsed.data };
}

export function messageTemplateVariableLabel(variable: typeof MESSAGE_TEMPLATE_VARIABLES[number]) {
  return `{{${variable}}}`;
}

/**
 * What `{{name}}` becomes when the registrant's own name cannot be used (empty,
 * or it reads as a web address); the same greeting as the automation template.
 */
export const MESSAGE_TEMPLATE_NAME_FALLBACK = "你";

/**
 * Renders only the same allowlisted variables accepted by the template
 * validator, in one pass (a value is never read again as a variable).
 * `{{name}}` is the registrant's own typed name, so it always goes through
 * safeRecipientName (A2-13): it can neither add a link, heading, list or bold
 * text nor a line break, and a name that reads as a web address is replaced by
 * the greeting. Every e-mail template path (confirmation, reminder, live
 * notifications, post-live follow-up, sequence e-mails, preview) renders here.
 */
export function renderMessageTemplate(value: string, variables: MessageTemplateVariables) {
  return value.replace(renderableVariablePattern, (_, variable: keyof MessageTemplateVariables) => (
    variable === "name" ? safeRecipientNameOr(variables.name, MESSAGE_TEMPLATE_NAME_FALLBACK) : variables[variable]
  ));
}
