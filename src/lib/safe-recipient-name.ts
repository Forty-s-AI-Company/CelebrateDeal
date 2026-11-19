// Pure constants and functions only: client components reach this file through
// automation-generic-email.ts, so it must never import a server module.

/**
 * Text that somebody outside the business typed (a registrant's, booker's or
 * buyer's own name) put into an e-mail this vendor sends (A2-04, A2-13).
 *
 * The e-mail pipeline reads every body as a small markdown dialect
 * (rich-text.ts: `[label](url)`, bare `http(s)://` links, `**bold**`, `#`
 * headings, `-`/`1.` lists), and mail clients turn a bare domain such as
 * `evil.test` or `www.evil.test` into a link on their own. A public form lets
 * anybody type anybody's address, so an unchecked name is a stranger's text in
 * the vendor's mail: a phishing link with the vendor's sender name on it.
 *
 * So a name is put in only after `safeRecipientName`:
 * - anything that reads as a web address (a scheme `://`, `www.`, or letters or
 *   digits of any script joined by `.` or `。`), judged on the NFKC form without
 *   invisible characters, before and after cleaning, drops the whole name;
 * - otherwise it is cleaned (one line; no `[]()*<>{}` or backtick; no
 *   `http(s)://`; no `#`, `1.`, `1)`, `-`, `+`, `*`, `>` at the start, stacked
 *   ones too) again and again until nothing changes, so removing one piece can
 *   never re-assemble another (`hthttps://tps://evil.test`);
 * - the result is at most `maxLength` code points.
 * An empty result means "use the caller's own greeting", never the raw name.
 */

// Invisible or direction-changing characters: soft hyphen, ALM, Mongolian vowel separator, zero-width, LRM/RLM, bidi controls, word joiner, BOM.
export const INVISIBLE_CHARACTER_SOURCE = "[\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]";
// C0/C1 controls, DEL, line and paragraph separators (the body of a character class).
export const CONTROL_CHARACTER_CLASS = "\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029";

const INVISIBLE_GLOBAL = new RegExp(INVISIBLE_CHARACTER_SOURCE, "gu");
const CONTROL_RUNS = new RegExp(`[${CONTROL_CHARACTER_CLASS}]+`, "gu");
// Anything with a dot between word characters (any script), a scheme or `www.`.
const ADDRESS_LIKE = /:\/\/|\bwww\.|[\p{L}\p{N}-]+(?:[.。][\p{L}\p{N}-]+)+/iu;
const SCHEME_OR_WWW = /:\/\/|\bwww\./iu;
// A "#", "1." or bullet (also stacked, "# # x") at the start would make a heading, list or quote.
const LEADING_FORMAT = /^(?:\s*(?:#+|\d+[.)]|[-+*>])\s*)+/u;

/** The NFKC form without invisible characters (full-width letters and dots fold to ASCII). */
export function foldInvisibleAndWidth(text: string) {
  return text.normalize("NFKC").replace(INVISIBLE_GLOBAL, "");
}

/** Whether a mail client or the e-mail pipeline could read `text` as a web address. */
export function looksLikeWebAddress(text: string) {
  return ADDRESS_LIKE.test(foldInvisibleAndWidth(text));
}

function clip(text: string, maxLength: number) {
  return Array.from(text).slice(0, maxLength).join("");
}

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
 * One value made safe for one line of the markdown dialect: no markers that
 * make a link, bold, heading or list, no `{{ }}`, no line break. Cleaning
 * repeats until nothing changes. `outsider`: somebody outside the business
 * typed it, so anything that looks like a web address drops the whole value.
 * Without it (a vendor's own Live title or name) only a scheme or `www.` does.
 * Empty means "use the fallback".
 */
export function cleanInlineEmailValue(value: string | null | undefined, options: { maxLength?: number; outsider?: boolean } = {}) {
  const maxLength = options.maxLength ?? 80;
  const original = value ?? "";
  if (options.outsider && looksLikeWebAddress(original)) return "";
  let current = original;
  for (let round = 0; round < 20; round += 1) {
    const next = cleanOnce(current);
    if (next === current) break;
    current = next;
  }
  if (options.outsider && looksLikeWebAddress(current)) return "";
  if (SCHEME_OR_WWW.test(foldInvisibleAndWidth(current))) return "";
  return clip(current, maxLength).trim();
}

/** A recipient's self-typed name made safe for an e-mail, or "" (use the greeting instead). */
export function safeRecipientName(value: string | null | undefined, options: { maxLength?: number } = {}) {
  return cleanInlineEmailValue(value, { maxLength: options.maxLength ?? 80, outsider: true });
}

/** `safeRecipientName`, or `fallback` when nothing safe is left. */
export function safeRecipientNameOr(value: string | null | undefined, fallback: string, options: { maxLength?: number } = {}) {
  return safeRecipientName(value, options) || fallback;
}
