import { describe, expect, it } from "vitest";

import { createEmptyPageDocument, parsePageDocument, type FunnelNode } from "@/lib/funnel-page-document";
import { createFunnelInspectorActionUpdate } from "@/lib/funnel-element-inspector";
import { funnelRegistrationHref, publicRegistrationLinks, registrationFormChoices } from "@/lib/funnel-registration-action";
import { registrationFormIdsInContent } from "@/lib/public-landing-page-eligibility";

const links = { pageId: "page_1", forms: [{ id: "form_1", slug: "autumn signup/2030" }], live: { id: "live 1", formId: "form_1" } };

describe("funnelRegistrationHref", () => {
  it("builds the hosted-form URL from server records, encoding slug and live", () => {
    expect(funnelRegistrationHref({ formId: "form_1" }, links)).toBe("/form/autumn%20signup%2F2030?liveId=live%201");
  });

  it("follows the current slug and live, carries the live only for its own form, and honours useBoundLive", () => {
    expect(funnelRegistrationHref({ formId: "form_1" }, { forms: [{ id: "form_1", slug: "renamed" }], live: { id: "live_2", formId: "form_1" } })).toBe("/form/renamed?liveId=live_2");
    expect(funnelRegistrationHref({ formId: "form_1" }, { ...links, live: { id: "live_2", formId: "form_2" } })).toBe("/form/autumn%20signup%2F2030");
    expect(funnelRegistrationHref({ formId: "form_1" }, { ...links, live: { id: "live_2" } })).toBe("/form/autumn%20signup%2F2030");
    expect(funnelRegistrationHref({ formId: "form_1", useBoundLive: false }, links)).toBe("/form/autumn%20signup%2F2030");
  });

  it("offers every project form without a bound live, and only the live's form with one", () => {
    const forms = [{ id: "form_1", slug: "a" }, { id: "form_2", slug: "b" }];
    expect(registrationFormChoices({ forms })).toEqual(forms);
    expect(registrationFormChoices({ forms, live: { id: "live_1", formId: "form_2" } })).toEqual([{ id: "form_2", slug: "b" }]);
    expect(registrationFormChoices({ forms, live: { id: "live_1" } })).toEqual([]);
  });

  it("returns null for a form the server did not provide", () => {
    expect(funnelRegistrationHref({ formId: "other_vendor_form" }, links)).toBeNull();
    expect(funnelRegistrationHref({ formId: "form_1" }, { forms: [] })).toBeNull();
  });

  it("projects only what the browser needs from the public render context", () => {
    expect(publicRegistrationLinks({ pageId: "page_1", forms: [{ id: "form_1", slug: "s", name: "內部表單名稱" }], live: { id: "live_1", slug: "l", title: "直播", status: "scheduled", formId: "form_1", scheduledAt: "2030-01-01T00:00:00.000Z" } }))
      .toEqual({ pageId: "page_1", forms: [{ id: "form_1", slug: "s" }], live: { id: "live_1", formId: "form_1" } });
    expect(publicRegistrationLinks({ forms: [] })).toEqual({ forms: [] });
  });
});

describe("registration node action", () => {
  const button = (actions: unknown[]): FunnelNode => ({ schemaVersion: 1, id: "cta", type: "button", props: { label: "報名" }, style: {}, overrides: {}, visible: true, actions: actions as FunnelNode["actions"], attributes: {} });
  const page = (actions: unknown[]) => ({ ...createEmptyPageDocument("p", "頁"), root: [{ schemaVersion: 1, id: "s", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "r", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [button(actions)] }] }] });

  it("parses only a form id and a boolean, defaults useBoundLive to true, and is collected for server validation", () => {
    const parsed = parsePageDocument(page([{ type: "registration", formId: "form_1" }]));
    expect(parsed?.root[0]!.children![0]!.children![0]!.actions).toEqual([{ type: "registration", formId: "form_1", useBoundLive: true }]);
    expect([...registrationFormIdsInContent(parsed!)]).toEqual(["form_1"]);
    expect(parsePageDocument(page([{ type: "registration", formId: "form_1", slug: "stored-slug" }]))).toBeNull();
    expect(parsePageDocument(page([{ type: "registration", formId: "../evil" }]))).toBeNull();
    expect(parsePageDocument(page([{ type: "registration" }]))).toBeNull();
  });

  it("is created by the inspector only with a well-formed form id", () => {
    const node = button([]);
    expect(createFunnelInspectorActionUpdate(node, { type: "registration", registrationFormId: "form_1" })).toEqual({ type: "update", nodeId: "cta", patch: { actions: [{ type: "registration", formId: "form_1", useBoundLive: true }] } });
    expect(createFunnelInspectorActionUpdate(node, { type: "registration", registrationFormId: "form_1", useBoundLive: false })).toEqual({ type: "update", nodeId: "cta", patch: { actions: [{ type: "registration", formId: "form_1", useBoundLive: false }] } });
    expect(createFunnelInspectorActionUpdate(node, { type: "registration" })).toBeNull();
    expect(createFunnelInspectorActionUpdate(node, { type: "registration", registrationFormId: "bad id" })).toBeNull();
    // A page form node id (submit_form) is not mistaken for a registration form.
    expect(createFunnelInspectorActionUpdate(node, { type: "registration", formId: "form_node" })).toBeNull();
  });
});
