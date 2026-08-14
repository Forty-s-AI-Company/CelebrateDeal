import { z } from "zod";

export const MESSAGE_TEMPLATE_CHANNELS = ["email"] as const;
export const MESSAGE_TEMPLATE_TRIGGERS = [
  "registration_confirmed",
  "live_reminder",
] as const;
export const MESSAGE_TEMPLATE_VARIABLES = [
  "name",
  "live_title",
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

export const LIVE_REMINDER_OFFSET_OPTIONS = [15, 30, 60, 180, 1440] as const;

const variablePattern = /\{\{\s*([a-z_]+)\s*\}\}/gu;
const allowedVariables = new Set<string>(MESSAGE_TEMPLATE_VARIABLES);

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

export type MessageTemplateActionError = "invalid_template" | "missing_template" | "conflict";

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
