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
] as const;

/** Markers of the phishing names above; none may reach a subject, body, HTML or plain text. */
const PHISHING_MARKERS = [/evil/iu, /ｅｖｉｌ/u, /釣魚/u, /點我/u, /hthttps|\/\/tps/iu, /\[|\]\(/u];

export const STACKED_FORMAT_NAME = { name: "# # x", cleaned: "x" } as const;

export const NORMAL_NAMES = ["王小明", "Mary Jane", "O'Brien"] as const;

/** Every rendering of one e-mail: as stored, as the HTML part and as the plain-text part. */
export function renderedForms(mail: { subject: string; body: string }) {
  return {
    subject: mail.subject,
    body: mail.body,
    html: richTextToEmailHtml(mail.body),
    text: richTextToPlainText(mail.body),
  };
}

export function expectNoPhishingTrace(mail: { subject: string; body: string }) {
  const forms = renderedForms(mail);
  for (const [form, value] of Object.entries(forms)) {
    for (const marker of PHISHING_MARKERS) expect(value, `${form}: ${value}`).not.toMatch(marker);
  }
  // Only the platform's own links remain (verification, unsubscribe, live, watch link).
  for (const href of forms.html.matchAll(/<a href="([^"]+)"/gu)) {
    expect(new URL(href[1]!.replaceAll("&amp;", "&")).hostname).toMatch(/(?:^|\.)example\.test$/u);
  }
}

/** The stacked "# # x" prefix made no heading, list or quote, in any form. */
export function expectNoFormatting(mail: { subject: string; body: string }) {
  const { html } = renderedForms(mail);
  expect(html).not.toMatch(/<h[23]>|<ul>|<ol>|<strong>|<em>/u);
  expect(mail.body).not.toMatch(/^\s*#/mu);
}
