import { expect } from "vitest";
import { richTextToEmailHtml, richTextToPlainText } from "@/lib/rich-text";

/**
 * A2-13: the self-typed names every e-mail path that carries a recipient's
 * name is tested with. A phishing name must leave no trace in the mail (its
 * whole value is replaced by the path's greeting); a stacked format prefix is
 * removed; an ordinary name is kept as typed.
 */
export const PHISHING_NAMES = [
  { label: "markdown link", name: "[點我](https://evil.test/login)" },
  { label: "scheme re-assembled after one removal", name: "hthttps://tps://evil.test" },
  { label: "bare domain", name: "evil.test" },
  { label: "www host", name: "www.evilshop" },
  { label: "full-width domain", name: "ｅｖｉｌ．ｔｅｓｔ" },
  { label: "Chinese full stop", name: "evil。test" },
  { label: "CJK host with Chinese full stop", name: "釣魚網站。測試" },
  // #670 review MAJOR-1: an invisible or format character next to the dot, or a combining mark after it.
  { label: "combining grapheme joiner U+034F", name: "evil͏.test" },
  { label: "variation selector U+FE00", name: "evil︀.test" },
  { label: "variation selector U+FE0F", name: "evil.️test" },
  { label: "tag space U+E0020", name: "evil\u{e0020}.test" },
  { label: "Mongolian free variation selector U+180B", name: "evil᠋.test" },
  { label: "Khmer inherent vowel U+17B4", name: "evil឴.test" },
  { label: "interlinear annotation anchor U+FFF9", name: "evil￹.test" },
  { label: "shorthand format letter overlap U+1BCA0", name: "evil\u{1bca0}.test" },
  { label: "musical symbol begin beam U+1D173", name: "evil\u{1d173}.test" },
  { label: "combining acute U+0301 after the dot", name: "evil.́test" },
] as const;

/** Markers of the phishing names above; none may reach a subject, body, HTML or plain text. */
const PHISHING_MARKERS = [/evil/iu, /ｅｖｉｌ/u, /釣魚/u, /點我/u, /hthttps|\/\/tps/iu, /\[|\]\(/u];

export const STACKED_FORMAT_NAME = { name: "# # x", cleaned: "x" } as const;

export const NORMAL_NAMES = ["王小明", "Mary Jane", "O'Brien", "José Müller", "राहुल"] as const;

/** Every rendering of one e-mail: as stored, as the HTML part and as the plain-text part. */
export function renderedForms(mail: { subject: string; body: string }) {
  return {
    subject: mail.subject,
    body: mail.body,
    html: richTextToEmailHtml(mail.body),
    text: richTextToPlainText(mail.body),
  };
}

const URL_PATTERN = /https?:\/\/[^\s<>"'　)\]]+/giu;
/** The platform's signed tokens (`lsw1.…`, `eu1.…`): random base64url that may spell a marker by chance. */
const SIGNED_TOKEN_VALUE = /^[a-z]{1,6}\d+\.[\w-]{8,}(?:\.[\w-]+)*$/iu;

function decodeEntities(value: string) {
  return value.replaceAll("&amp;", "&");
}

/** Every http(s) URL in a form, plain text and href alike. */
export function findUrls(value: string): string[] {
  return [...decodeEntities(value).matchAll(URL_PATTERN)].map((match) => match[0]);
}

/**
 * What a platform URL may legitimately contain, minus its random tokens: the
 * path and the query with only the value of a token parameter blanked. A name
 * smuggled in as another query value (`?name=evil`) stays visible to the markers.
 */
function urlWithoutToken(url: string) {
  const parsed = new URL(url);
  const query = [...parsed.searchParams].map(([key, val]) => (key === "token" || SIGNED_TOKEN_VALUE.test(val) ? `${key}=` : `${key}=${val}`));
  return `${decodeURIComponent(parsed.pathname)} ${query.join("&")}`;
}

/** Text with every URL swapped for its token-free path and query; hostnames are asserted separately. */
export function stripUrlTokens(value: string) {
  return decodeEntities(value).replace(URL_PATTERN, (url) => ` ${urlWithoutToken(url)} `);
}

export function expectNoPhishingTrace(mail: { subject: string; body: string }) {
  const forms = renderedForms(mail);
  for (const [form, value] of Object.entries(forms)) {
    // Only the platform's own links remain (verification, unsubscribe, live, watch link).
    for (const url of findUrls(value)) {
      expect(new URL(url).hostname, `${form}: ${url}`).toMatch(/(?:^|\.)example\.test$/u);
    }
    const remaining = stripUrlTokens(value);
    for (const marker of PHISHING_MARKERS) expect(remaining, `${form}: ${remaining}`).not.toMatch(marker);
  }
}

/** The stacked "# # x" prefix made no heading, list or quote, in any form. */
export function expectNoFormatting(mail: { subject: string; body: string }) {
  const { html } = renderedForms(mail);
  expect(html).not.toMatch(/<h[23]>|<ul>|<ol>|<strong>|<em>/u);
  expect(mail.body).not.toMatch(/^\s*#/mu);
}
