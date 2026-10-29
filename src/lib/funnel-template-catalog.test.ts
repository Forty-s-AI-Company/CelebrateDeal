import { describe, expect, it } from "vitest";
import { FUNNEL_TEMPLATE_GALLERY, type FunnelTemplateGalleryItem } from "@/lib/funnel-template-gallery";
import { WEBINAR_TEMPLATES } from "@/lib/funnel-templates/webinar";
import { LEADS_TEMPLATES } from "@/lib/funnel-templates/leads";
import { SALES_TEMPLATES } from "@/lib/funnel-templates/sales";
import {
  compatibleStepTypes,
  DEFAULT_FUNNEL_TEMPLATE_STYLE,
  deriveFunnelTemplatePurposes,
  filterFunnelTemplateCatalog,
  FUNNEL_TEMPLATE_CATALOG_TAGS,
  FUNNEL_TEMPLATE_PURPOSE_LABELS,
  FUNNEL_TEMPLATE_PURPOSES,
  FUNNEL_TEMPLATE_STYLE_LABELS,
  FUNNEL_TEMPLATE_STYLES,
  funnelTemplateCatalogEntry,
  listFunnelTemplateCatalog,
} from "./funnel-template-catalog";

const unregistered = (goal: FunnelTemplateGalleryItem["goal"], id = "new-unlisted-template"): FunnelTemplateGalleryItem => ({ ...FUNNEL_TEMPLATE_GALLERY.find((item) => !item.retired && !item.hidden && !item.libraryHidden)!, id, goal, name: "新範本" });

describe("template catalog labels", () => {
  it("lists every gallery template with at least one known purpose and style", () => {
    const catalog = listFunnelTemplateCatalog();
    // Retired, hidden (the webinar development example) and step-only templates stay resolvable but are not listed.
    expect(catalog.map((entry) => entry.id)).toEqual(FUNNEL_TEMPLATE_GALLERY.filter((item) => !item.retired && !item.hidden && !item.libraryHidden).map((item) => item.id));
    for (const entry of catalog) {
      expect(entry.purposes.length).toBeGreaterThan(0);
      expect(entry.styles.length).toBeGreaterThan(0);
      for (const purpose of entry.purposes) expect(FUNNEL_TEMPLATE_PURPOSE_LABELS[purpose]).toBeTruthy();
      for (const style of entry.styles) expect(FUNNEL_TEMPLATE_STYLE_LABELS[style]).toBeTruthy();
    }
  });

  it("only registers ids that exist, with known labels", () => {
    const ids = new Set(FUNNEL_TEMPLATE_GALLERY.map((item) => item.id));
    for (const [id, tags] of Object.entries(FUNNEL_TEMPLATE_CATALOG_TAGS)) {
      expect(ids.has(id), id).toBe(true);
      expect(tags.purposes.every((purpose) => FUNNEL_TEMPLATE_PURPOSES.includes(purpose))).toBe(true);
      expect(tags.styles.every((style) => FUNNEL_TEMPLATE_STYLES.includes(style))).toBe(true);
    }
  });

  it("uses the registered labels", () => {
    expect(funnelTemplateCatalogEntry(FUNNEL_TEMPLATE_GALLERY.find((item) => item.id === "custom-privacy")!)).toMatchObject({ purposes: ["policy"], styles: ["minimal"], registered: true });
    expect(funnelTemplateCatalogEntry(FUNNEL_TEMPLATE_GALLERY.find((item) => item.id === "webinar-strategy-registration")!)).toMatchObject({ purposes: ["webinar", "sales"], styles: ["warm"] });
    const luxury = FUNNEL_TEMPLATE_GALLERY.find((item) => item.id === "custom-luxury-course")!;
    expect(funnelTemplateCatalogEntry(luxury)).toMatchObject({ name: "高質感課程品牌（黑金）", purposes: ["brand"], styles: ["luxe"], registered: true });
    expect(filterFunnelTemplateCatalog(listFunnelTemplateCatalog(), { purpose: "brand", style: "luxe" }).map((entry) => entry.id)).toEqual(["custom-luxury-course"]);
  });

  it("still shows an unregistered template, deriving its purpose from the goal and defaulting the style to 簡約", () => {
    expect(funnelTemplateCatalogEntry(unregistered("custom"))).toMatchObject({ id: "new-unlisted-template", purposes: ["brand"], styles: [DEFAULT_FUNNEL_TEMPLATE_STYLE], registered: false });
    expect(FUNNEL_TEMPLATE_STYLE_LABELS[DEFAULT_FUNNEL_TEMPLATE_STYLE]).toBe("簡約");
    expect(funnelTemplateCatalogEntry(unregistered("sell")).purposes).toEqual(["sales"]);
    expect(funnelTemplateCatalogEntry(unregistered("audience")).purposes).toEqual(["leads"]);
    expect(funnelTemplateCatalogEntry(unregistered("webinar")).purposes).toEqual(["webinar"]);
    const withNewTemplate = [...FUNNEL_TEMPLATE_GALLERY, unregistered("custom", "luxe-course-brand")];
    expect(listFunnelTemplateCatalog(withNewTemplate).at(-1)).toMatchObject({ id: "luxe-course-brand", purposes: ["brand"], styles: ["minimal"] });
  });

  it("adds the purposes implied by compatible step types", () => {
    expect(deriveFunnelTemplatePurposes({ id: "x", goal: "custom" }, ["opt_in_page", "order_form"])).toEqual(["sales", "leads", "brand"]);
    expect(deriveFunnelTemplatePurposes({ id: "x", goal: "audience" }, ["webinar_registration_page"])).toEqual(["leads", "webinar"]);
    expect(deriveFunnelTemplatePurposes({ id: "x", goal: "sell" }, [])).toEqual(["sales"]);
  });

  it("knows which steps a gallery template is offered for", () => {
    expect(compatibleStepTypes({ id: "webinar-thank-you-v2", goal: "webinar" })).toEqual(["webinar_thank_you_page"]);
    expect(compatibleStepTypes({ id: "custom-terms-v2", goal: "custom" })).toEqual(["info_page", "contact_us_page"]);
    // Retired ids are no longer offered for any step; step-only templates keep their steps but are not browsable.
    expect(compatibleStepTypes({ id: "webinar-thank-you", goal: "webinar" })).toEqual([]);
    expect(compatibleStepTypes({ id: "custom-terms", goal: "custom" })).toEqual([]);
    expect(compatibleStepTypes({ id: "sell-simple-checkout", goal: "sell" })).toEqual([]);
    expect(compatibleStepTypes({ id: "sales-course-watercolor", goal: "sell" })).toEqual(["sales_page", "order_form", "upsell", "downsell"]);
    expect(compatibleStepTypes({ id: "sales-course-watercolor-thanks", goal: "sell" })).toEqual(["thank_you_page"]);
    expect(compatibleStepTypes({ id: "leads-checklist-minimal", goal: "audience" })).toEqual(["opt_in_page", "inline_form", "popup_form", "link_in_bio"]);
    expect(compatibleStepTypes({ id: "leads-checklist-minimal-thanks", goal: "audience" })).toEqual(["opt_in_thank_you_page"]);
    expect(deriveFunnelTemplatePurposes({ id: "audience-volunteer", goal: "audience" })).toEqual(["leads"]);
  });
});

describe("filterFunnelTemplateCatalog", () => {
  const catalog = listFunnelTemplateCatalog();

  it("returns everything without a filter", () => {
    expect(filterFunnelTemplateCatalog(catalog, {})).toHaveLength(catalog.length);
    expect(filterFunnelTemplateCatalog(catalog, { purpose: null, style: null })).toHaveLength(catalog.length);
  });

  it("filters by purpose, style, or both", () => {
    const sales = filterFunnelTemplateCatalog(catalog, { purpose: "sales" });
    // 銷售用途：帶 sales 標籤的 Webinar 範本＋8 個銷售頁範本（感謝頁只在步驟選單）。
    expect(sales.map((entry) => entry.id)).toEqual(["webinar-saas-split", "webinar-travel-story", "webinar-career-value", "webinar-ecommerce-data", ...SALES_TEMPLATES.map((template) => template.id)]);
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "leads" }).map((entry) => entry.id)).toEqual(LEADS_TEMPLATES.map((template) => template.id));
    expect(sales.every((entry) => entry.purposes.includes("sales"))).toBe(true);
    expect(filterFunnelTemplateCatalog(catalog, { style: "natural" }).every((entry) => entry.styles.includes("natural"))).toBe(true);
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "sales", style: "professional" }).map((entry) => entry.id)).toEqual(["webinar-saas-split", "webinar-career-value", ...SALES_TEMPLATES.filter((template) => template.styles.includes("professional")).map((template) => template.id)]);
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "policy" }).map((entry) => entry.id)).toEqual(["custom-privacy-v2", "custom-terms-v2"]);
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "policy", style: "vivid" })).toEqual([]);
  });

  it("classifies the new webinar templates and functional pages by their own tags", () => {
    const webinar = filterFunnelTemplateCatalog(catalog, { purpose: "webinar" }).map((entry) => entry.id);
    for (const template of WEBINAR_TEMPLATES.filter((item) => !item.hidden)) {
      expect(webinar).toContain(template.id);
      for (const purpose of template.purposes) expect(FUNNEL_TEMPLATE_PURPOSES).toContain(purpose);
      for (const style of template.styles) expect(FUNNEL_TEMPLATE_STYLES).toContain(style);
      for (const style of template.styles) expect(filterFunnelTemplateCatalog(catalog, { purpose: "webinar", style }).map((entry) => entry.id)).toContain(template.id);
    }
    expect(webinar).toEqual(expect.arrayContaining(["webinar-thank-you-v2", "webinar-broadcast-v2"]));
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "webinar", style: "minimal" }).map((entry) => entry.id)).toEqual(expect.arrayContaining(["webinar-ai-minimal", "webinar-thank-you-v2"]));
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "webinar", style: "luxe" }).map((entry) => entry.id)).toEqual(["webinar-photo-portfolio", "webinar-aesthetic-clinic"]);
    for (const template of [...LEADS_TEMPLATES, ...SALES_TEMPLATES]) {
      for (const style of template.styles) expect(filterFunnelTemplateCatalog(catalog, { purpose: template.kind, style }).map((entry) => entry.id)).toContain(template.id);
      expect(catalog.find((entry) => entry.id === template.id)?.registered).toBe(true);
    }
    // Every catalog entry of a registration template is registered through its own tags, not derived.
    expect(catalog.filter((entry) => WEBINAR_TEMPLATES.some((template) => template.id === entry.id)).every((entry) => entry.registered)).toBe(true);
  });
});
