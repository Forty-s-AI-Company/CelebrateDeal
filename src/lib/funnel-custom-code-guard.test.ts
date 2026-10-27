import { describe, expect, it, vi } from "vitest";
import {
  assertFunnelCustomCodeDelete,
  assertFunnelCustomCodePublish,
  assertFunnelCustomCodeWrite,
  FunnelCustomCodeRefusal,
  recordFunnelCustomCodePublish,
  recordFunnelCustomCodeSave,
} from "./funnel-custom-code-guard";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "./funnel-page-document";

const owner = { userId: "user-owner", role: "owner", emailVerified: true };
const admin = { userId: "user-admin", role: "admin", emailVerified: true };

function codeNode(id: string, props: Record<string, unknown>): FunnelNode {
  return { schemaVersion: 1, id, type: "raw_html", props, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}

function page(nodes: FunnelNode[], customCss?: string): PageDocument {
  const document = createEmptyPageDocument("page-1");
  document.root = [{
    schemaVersion: 1, id: "section", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {},
    children: [{ schemaVersion: 1, id: "row", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: nodes }],
  }];
  if (customCss !== undefined) document.settings.customCss = customCss;
  return document;
}

function refusal(run: () => unknown) {
  try { run(); } catch (error) { if (error instanceof FunnelCustomCodeRefusal) return error.code; throw error; }
  return null;
}

describe("custom code write gate", () => {
  const plain = page([]);
  const withHtml = page([codeNode("a", { html: "<p>a</p>" })]);
  const withJs = page([codeNode("a", { html: "<p>a</p>", js: "run()" })]);
  const withCss = page([], "body{color:red}");

  it("lets owner and admin add, change and remove custom code and page CSS", () => {
    for (const actor of [owner, admin]) {
      expect(assertFunnelCustomCodeWrite(actor, plain, withJs, {})).toHaveLength(1);
      expect(assertFunnelCustomCodeWrite(actor, withJs, plain, {})).toHaveLength(1);
      expect(assertFunnelCustomCodeWrite(actor, plain, withCss, {})).toHaveLength(1);
    }
  });

  it("refuses any custom code change by other roles, but lets them save pages whose code is unchanged", () => {
    for (const role of ["support", "accountant", "editor", "member", "partner", null]) {
      const actor = { userId: "user-x", role, emailVerified: true };
      expect(refusal(() => assertFunnelCustomCodeWrite(actor, plain, withHtml, {}))).toBe("landing_page_custom_code_role");
      expect(refusal(() => assertFunnelCustomCodeWrite(actor, withHtml, plain, {}))).toBe("landing_page_custom_code_role");
      expect(refusal(() => assertFunnelCustomCodeWrite(actor, plain, withCss, {}))).toBe("landing_page_custom_code_role");
      expect(refusal(() => assertFunnelCustomCodeWrite(actor, withHtml, structuredClone(withHtml), {}))).toBeNull();
    }
  });

  it("requires a verified e-mail whenever the saved content contains JS", () => {
    const unverified = { ...owner, emailVerified: false };
    expect(refusal(() => assertFunnelCustomCodeWrite(unverified, plain, withJs, {}))).toBe("landing_page_custom_code_email_unverified");
    // Even when this save does not touch the JS another member wrote.
    expect(refusal(() => assertFunnelCustomCodeWrite(unverified, withJs, structuredClone(withJs), {}))).toBe("landing_page_custom_code_email_unverified");
    // HTML/CSS only, or removing the JS, is allowed.
    expect(refusal(() => assertFunnelCustomCodeWrite(unverified, plain, withHtml, {}))).toBeNull();
    expect(refusal(() => assertFunnelCustomCodeWrite(unverified, withJs, withHtml, {}))).toBeNull();
  });

  it("refuses new or changed JS while the emergency switch is on, but allows removing it", () => {
    const env = { FUNNEL_CUSTOM_CODE_DISABLED: "true" };
    expect(refusal(() => assertFunnelCustomCodeWrite(owner, plain, withJs, env))).toBe("landing_page_custom_code_disabled");
    expect(refusal(() => assertFunnelCustomCodeWrite(owner, withJs, page([codeNode("a", { html: "<p>a</p>", js: "other()" })]), env))).toBe("landing_page_custom_code_disabled");
    expect(refusal(() => assertFunnelCustomCodeWrite(owner, withJs, withHtml, env))).toBeNull();
    expect(refusal(() => assertFunnelCustomCodeWrite(owner, plain, withCss, env))).toBeNull();
  });

  it("gates publishing and deleting pages with custom code", () => {
    const support = { userId: "user-s", role: "support", emailVerified: true };
    expect(assertFunnelCustomCodePublish(owner, plain)).toBe(false);
    expect(assertFunnelCustomCodePublish(owner, withJs)).toBe(true);
    expect(refusal(() => assertFunnelCustomCodePublish(support, withHtml))).toBe("landing_page_custom_code_role");
    expect(refusal(() => assertFunnelCustomCodePublish({ ...admin, emailVerified: false }, withJs))).toBe("landing_page_custom_code_email_unverified");
    expect(refusal(() => assertFunnelCustomCodePublish({ ...admin, emailVerified: false }, withHtml))).toBeNull();
    expect(refusal(() => assertFunnelCustomCodeDelete(support, withCss))).toBe("landing_page_custom_code_role");
    expect(refusal(() => assertFunnelCustomCodeDelete(support, plain))).toBeNull();
  });
});

describe("custom code audit", () => {
  it("records saves with locations, fields and sizes only", async () => {
    const create = vi.fn();
    const changes = assertFunnelCustomCodeWrite(owner, page([]), page([codeNode("a", { html: "<p>secret-html</p>", js: "secretJs()" })], ".a{color:red}"), {});
    await recordFunnelCustomCodeSave({ auditLog: { create } }, { vendorId: "vendor-1", actorId: owner.userId, pageId: "page-1", operation: "save", changes });
    expect(create).toHaveBeenCalledWith({ data: {
      vendorId: "vendor-1", actorId: "user-owner", action: "funnel_custom_code_saved", targetType: "LandingPage", targetId: "page-1",
      after: { operation: "save", changes: [
        { location: "page/node:a", kind: "node", change: "added", fields: ["html", "js"], bytes: { html: 18, css: 0, js: 10 } },
        { location: "page/page_css", kind: "page_css", change: "added", fields: ["css"], bytes: { css: 13 } },
      ] },
    } });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/secret|color:red/u);
    create.mockClear();
    await recordFunnelCustomCodeSave({ auditLog: { create } }, { vendorId: "vendor-1", actorId: owner.userId, pageId: "page-1", operation: "save", changes: [] });
    expect(create).not.toHaveBeenCalled();
  });

  it("records publishes with sizes and fingerprints, never the code", async () => {
    const create = vi.fn();
    await recordFunnelCustomCodePublish({ auditLog: { create } }, { vendorId: "vendor-1", actorId: "user-owner", pageId: "page-1", version: 3, content: page([codeNode("a", { js: "secretJs()" })], "body{margin:0}"), env: {} });
    const data = create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ vendorId: "vendor-1", actorId: "user-owner", action: "funnel_custom_code_published", targetType: "LandingPage", targetId: "page-1" });
    expect(data.after).toMatchObject({ version: 3, killSwitchActive: false, nodes: [{ location: "page/node:a", bytes: { html: 0, css: 0, js: 10 } }], pageCss: [{ location: "page/page_css", bytes: 14 }] });
    expect(data.after.nodes[0].sha256).toMatch(/^[0-9a-f]{16}$/u);
    expect(JSON.stringify(data)).not.toMatch(/secretJs|margin/u);
  });
});
