// Pure constants and functions only: the rule form (a client component) and the
// action schema import this file, so it must never import a server module.

/**
 * The link-free e-mail template (`generic_message`, A2-04): the merchant writes
 * the subject and the body. The pipeline reads the body as a small markdown
 * dialect (bold, headings, lists), so basic formatting works; what never works
 * is a link. Safety rules, all enforced here:
 * - the subject is one line (no CR/LF, control or invisible characters, so it
 *   can never add a header) and at most 100 characters;
 * - the body is at most 2000 characters; HTML is never interpreted (the e-mail
 *   pipeline escapes it);
 * - neither text may contain a link or anything that reads as a web address;
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
 * has a name and (when its form is tied to a Live) a Live; a booking has a
 * name; an order carries only a masked buyer name, which is never put in a
 * mail, so only the vendor name is left.
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
// Invisible or direction-changing characters: soft hyphen, ALM, Mongolian vowel separator, zero-width, LRM/RLM, bidi controls, word joiner, BOM.
const INVISIBLE_SOURCE = "[\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]";
const INVISIBLE = new RegExp(INVISIBLE_SOURCE, "u");
const INVISIBLE_GLOBAL = new RegExp(INVISIBLE_SOURCE, "gu");
// C0/C1 controls, DEL, line and paragraph separators.
const CONTROL_SOURCE = "\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029";
const SUBJECT_FORBIDDEN = new RegExp(`[${CONTROL_SOURCE}]`, "u");
const BODY_FORBIDDEN = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "u");
const CONTROL_RUNS = new RegExp(`[${CONTROL_SOURCE}]+`, "gu");
// The template is link-free: no scheme, markdown link, www host or text that reads as a web address.
const LINK_LIKE = /:\/\/|\]\(|\bwww\.|\b(?:mailto|javascript|data):|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/|\b)/iu;
// Anything with a dot between word characters, for a value an outsider typed (a registrant's name).
const ADDRESS_LIKE = /:\/\/|\bwww\.|[a-z0-9-]+(?:\.[a-z0-9-]+)+/iu;

function fold(text: string) {
  return text.normalize("NFKC").replace(INVISIBLE_GLOBAL, "");
}

/** Whether the text would read as a link or web address (checked on its NFKC form, so full-width letters count). */
export function genericEmailTextLooksLikeLink(text: string) {
  return LINK_LIKE.test(fold(text));
}

export type GenericEmailContent = { subject: string; body: string };

/** The cleaned subject and body, or null when either breaks a rule above (a subject with a line break is refused, never trimmed). */
export function normalizeGenericEmailContent(input: { subject?: unknown; body?: unknown }): GenericEmailContent | null {
  if (typeof input.subject !== "string" || typeof input.body !== "string") return null;
  if (SUBJECT_FORBIDDEN.test(input.subject) || INVISIBLE.test(input.subject) || genericEmailTextLooksLikeLink(input.subject)) return null;
  const subject = input.subject.trim();
  const body = input.body.replace(/\r\n?/gu, "\n").trim();
  if (!subject || Array.from(subject).length > GENERIC_EMAIL_SUBJECT_MAX) return null;
  if (!body || Array.from(body).length > GENERIC_EMAIL_BODY_MAX || BODY_FORBIDDEN.test(body) || INVISIBLE.test(body) || genericEmailTextLooksLikeLink(body)) return null;
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

function clip(text: string, maxLength: number) {
  return Array.from(text).slice(0, maxLength).join("");
}

// A "#", "1." or bullet (also stacked, "# # x") at the start would make a heading, list or quote.
const LEADING_FORMAT = /^(?:\s*(?:#+|\d+[.)]|[-+*>])\s*)+/u;

function cleanOnce(value: string) {
  return value
    .normalize("NFKC")
    .replace(INVISIBLE_GLOBAL, "")
    .replace(CONTROL_RUNS, " ")
    .trim()
    // Before the brackets go, so "1)" is still seen as a list marker.
    .replace(LEADING_FORMAT, "")
    .replace(/[[\]()*<>{}`]/gu, "")
    .replace(/https?:\/\//giu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(LEADING_FORMAT, "");
}

/**
 * One variable value made safe for plain text that the mail pipeline reads as a
 * small markdown dialect: one line, no markers that make a link, bold, heading
 * or list, no `{{ }}`. Cleaning repeats until nothing changes, so removing one
 * piece can never re-assemble another (`hthttps://tps://` and the like).
 * `outsider`: a value somebody outside the business typed (a registrant's
 * name); anything that looks like a web address, before or after cleaning, is
 * dropped whole. Empty means "use the fallback".
 */
export function genericEmailVariableValue(value: string | null | undefined, options: { maxLength?: number; outsider?: boolean } = {}) {
  const maxLength = options.maxLength ?? 80;
  const original = value ?? "";
  if (options.outsider && ADDRESS_LIKE.test(fold(original))) return "";
  let current = original;
  for (let round = 0; round < 20; round += 1) {
    const next = cleanOnce(current);
    if (next === current) break;
    current = next;
  }
  if (options.outsider && ADDRESS_LIKE.test(fold(current))) return "";
  if (/:\/\/|\bwww\./iu.test(fold(current))) return "";
  return clip(current, maxLength).trim();
}

const FALLBACKS: Record<GenericEmailVariable, string> = { name: "你", vendor_name: "我們", live_title: "本活動" };

/**
 * Fills the variables in one pass (a value is never read again, so it cannot
 * name another variable) and keeps the subject on one line.
 */
export function renderGenericEmail(content: GenericEmailContent, values: Partial<Record<GenericEmailVariable, string | null | undefined>>): GenericEmailContent {
  const fill = (text: string) => text.replace(VARIABLE_PATTERN, (_match, name: string) => {
    if (!(GENERIC_EMAIL_VARIABLES as readonly string[]).includes(name)) return "";
    const variable = name as GenericEmailVariable;
    return genericEmailVariableValue(values[variable], { outsider: variable === "name" }) || FALLBACKS[variable];
  });
  return {
    subject: clip(fill(content.subject).replace(CONTROL_RUNS, " ").trim(), 200).trim(),
    body: fill(content.body).trim(),
  };
}
