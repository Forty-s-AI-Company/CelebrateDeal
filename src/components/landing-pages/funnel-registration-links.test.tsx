// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelRegistrationLinkProvider } from "@/components/landing-pages/funnel-registration-links";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import type { FunnelRegistrationLinks } from "@/lib/funnel-registration-action";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  window.history.replaceState(null, "", "/");
});

const button = (id: string, action: FunnelNode["actions"][number]): FunnelNode => ({ schemaVersion: 1, id, type: "button", props: { label: id }, style: {}, overrides: {}, visible: true, actions: [action], attributes: {} });
const page = (nodes: FunnelNode[]): PageDocument => ({ ...createEmptyPageDocument("links", "連結"), root: [{ schemaVersion: 1, id: "s", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "r", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: nodes }] }] });
const document_ = page([
  button("register", { type: "registration", formId: "form_1", useBoundLive: true }),
  button("plain-form-link", { type: "open_url", href: "/form/webinar-signup", newTab: false }),
]);

/** Visitor URL (with its query) → rendered hrefs, on the client where the query is read. */
async function hrefs(search: string, links: FunnelRegistrationLinks) {
  window.history.replaceState(null, "", `/lp/autumn${search}`);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<FunnelRegistrationLinkProvider value={links}><FunnelPageDocumentRenderer document={document_} mode="preview" publicSurface /></FunnelRegistrationLinkProvider>));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  const href = (label: string) => new URL(Array.from(container.querySelectorAll("a")).find((anchor) => anchor.textContent === label)!.getAttribute("href")!, "https://landing.invalid");
  return { register: href("register"), plain: href("plain-form-link") };
}

const links: FunnelRegistrationLinks = { pageId: "page_1", forms: [{ id: "form_1", slug: "webinar-signup" }], live: { id: "live_1", formId: "form_1" } };

describe("registration button attribution in the browser", () => {
  it("carries ref, share and UTM parameters from the visitor URL plus the page id, like legacy landing pages", async () => {
    const { register } = await hrefs("?utm_source=line&utm_medium=social&utm_campaign=autumn&utm_content=hero&utm_term=webinar&ref=AFF01&share=SH01&email=visitor%40example.com", links);
    expect(register.pathname).toBe("/form/webinar-signup");
    expect(Object.fromEntries(register.searchParams)).toEqual({
      liveId: "live_1", utm_source: "line", utm_medium: "social", utm_campaign: "autumn", utm_content: "hero", utm_term: "webinar", ref: "AFF01", share: "SH01", lp: "page_1",
    });
  });

  it("takes the first value of a repeated parameter, never duplicates one, and cannot be overridden through lp", async () => {
    const { register } = await hrefs("?ref=FIRST&ref=SECOND&lp=attacker_page&liveId=forged_live", links);
    expect(register.searchParams.getAll("ref")).toEqual(["FIRST"]);
    expect(register.searchParams.getAll("lp")).toEqual(["page_1"]);
    expect(register.searchParams.getAll("liveId")).toEqual(["live_1"]);
  });

  it("omits lp when the render context has no page (editor canvas and preview)", async () => {
    const { register } = await hrefs("?ref=AFF01", { forms: links.forms, live: links.live });
    expect(register.searchParams.has("lp")).toBe(false);
    expect(register.searchParams.get("ref")).toBe("AFF01");
  });

  it("leaves existing open_url /form/ links untouched by the visitor query", async () => {
    const { plain } = await hrefs("?ref=AFF01&utm_source=line", links);
    expect(`${plain.pathname}${plain.search}`).toBe("/form/webinar-signup");
  });
});
