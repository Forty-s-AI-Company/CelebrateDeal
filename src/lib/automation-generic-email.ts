// Pure constants and functions only: the rule form (a client component) and the
// action schema import this file, so it must never import a server module.

/**
 * The link-free e-mail template (`generic_message`, A2-04): the merchant writes
 * the subject and the body, plain text. Safety rules, all enforced here:
 * - the subject is one line (no CR/LF or other control characters, so it can
 *   never add a header) and at most 100 characters;
 * - the body is at most 2000 characters; HTML is never interpreted (the e-mail
 *   pipeline escapes it, and a `<` typed by the merchant arrives as text);
 * - only the `{{variables}}` the trigger can really supply are accepted, and a
 *   value is cleaned (genericEmailVariableValue) before it is put in, so a
 *   registrant's name can neither start a line, add a link nor name a variable.
 */
export const GENERIC_EMAIL_SUBJECT_MAX = 100;
export const GENERIC_EMAIL_BODY_MAX = 2_000;

export const GENERIC_EMAIL_VARIABLES = ["name", "vendor_name", "live_title"] as const;
export type GenericEmailVariable = typeof GENERIC_EMAIL_VARIABLES[number];

export const GENERIC_EMAIL_VARIABLE_LABELS: Record<GenericEmailVariable, string> = {
  name: "收件人姓名",
  vendor_name: "商家名稱",
  live_title: "直播名稱",
};

/**
 * What each trigger's subject can supply: a registration (form, watch, no-show)
 * has a name and a Live; a booking has a name; an order carries only a masked
 * buyer name, which is never put in a mail, so only the vendor name is left.
 */
const LIVE_TRIGGER_VARIABLES: readonly GenericEmailVariable[] = ["name", "vendor_name", "live_title"];
const GENERIC_EMAIL_VARIABLES_BY_TRIGGER: Record<string, readonly GenericEmailVariable[]> = {
  form_registered: LIVE_TRIGGER_VARIABLES,
  viewer_watch_progress: LIVE_TRIGGER_VARIABLES,
  webinar_attended_duration_gte: LIVE_TRIGGER_VARIABLES,
  form_no_show: LIVE_TRIGGER_VARIABLES,
  consultation_booked: ["name", "vendor_name"],
  consultation_no_show: ["name", "vendor_name"],
  payment_paid: ["vendor_name"],
};

export function genericEmailVariablesForTrigger(trigger: string): readonly GenericEmailVariable[] {
  return GENERIC_EMAIL_VARIABLES_BY_TRIGGER[trigger] ?? [];
}

const VARIABLE_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/gu;
// C0/C1 controls, DEL, line and paragraph separators, bidi controls.
const SUBJECT_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const BODY_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

export type GenericEmailContent = { subject: string; body: string };

/** The cleaned subject and body, or null when either breaks a rule above (a subject with a line break is refused, never trimmed). */
export function normalizeGenericEmailContent(input: { subject?: unknown; body?: unknown }): GenericEmailContent | null {
  if (typeof input.subject !== "string" || typeof input.body !== "string") return null;
  if (SUBJECT_FORBIDDEN.test(input.subject)) return null;
  const subject = input.subject.trim();
  const body = input.body.replace(/\r\n?/gu, "\n").trim();
  if (!subject || subject.length > GENERIC_EMAIL_SUBJECT_MAX) return null;
  if (!body || body.length > GENERIC_EMAIL_BODY_MAX || BODY_FORBIDDEN.test(body)) return null;
  return { subject, body };
}

/** Every `{{...}}` in `text` names a variable of `allowed`, and no stray braces are left. */
function usesOnlyVariables(text: string, allowed: readonly string[]) {
  const rest = text.replace(VARIABLE_PATTERN, (match, name: string) => (allowed.includes(name) ? "" : match));
  return !rest.includes("{{") && !rest.includes("}}");
}

/** Whether `content` is valid for `trigger`: normalized as stored, and using only the variables that trigger can supply. */
export function genericEmailContentUsable(trigger: string, content: { subject?: unknown; body?: unknown }) {
  const normalized = normalizeGenericEmailContent(content);
  if (!normalized) return false;
  const allowed = genericEmailVariablesForTrigger(trigger);
  return usesOnlyVariables(normalized.subject, allowed) && usesOnlyVariables(normalized.body, allowed);
}

/** The variables `content` uses, so a caller only loads what it needs. */
export function genericEmailVariablesUsed(content: GenericEmailContent) {
  const used = new Set<GenericEmailVariable>();
  for (const text of [content.subject, content.body]) {
    for (const match of text.matchAll(VARIABLE_PATTERN)) {
      const name = match[1] as GenericEmailVariable;
      if ((GENERIC_EMAIL_VARIABLES as readonly string[]).includes(name)) used.add(name);
    }
  }
  return used;
}

/**
 * One variable value made safe for plain text that the mail pipeline reads as a
 * small markdown dialect: one line, no markers that make a link, bold, heading
 * or list, no `{{ }}`. Empty after cleaning means "use the fallback".
 */
export function genericEmailVariableValue(value: string | null | undefined, maxLength = 80) {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/gu, " ")
    .replace(/[\[\]()*<>{}`]/gu, "")
    .replace(/https?:\/\//giu, "")
    .replace(/\s+/gu, " ")
    .trim()
    // A leading "#" or "1." at the start of a line would make a heading or list.
    .replace(/^(?:#+|\d+[.)]|-)\s*/u, "")
    .slice(0, maxLength)
    .trim();
}

const FALLBACKS: Record<GenericEmailVariable, string> = { name: "你", vendor_name: "我們", live_title: "這場直播" };

/**
 * Fills the variables in one pass (a value is never read again, so it cannot
 * name another variable) and keeps the subject on one line.
 */
export function renderGenericEmail(content: GenericEmailContent, values: Partial<Record<GenericEmailVariable, string | null | undefined>>): GenericEmailContent {
  const fill = (text: string) => text.replace(VARIABLE_PATTERN, (_match, name: string) => {
    if (!(GENERIC_EMAIL_VARIABLES as readonly string[]).includes(name)) return "";
    const variable = name as GenericEmailVariable;
    return genericEmailVariableValue(values[variable]) || FALLBACKS[variable];
  });
  return {
    subject: fill(content.subject).replace(/[\r\n\u2028\u2029]+/gu, " ").trim().slice(0, 200),
    body: fill(content.body).trim(),
  };
}
