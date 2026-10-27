import { describe, expect, it } from "vitest";
import { FUNNEL_TEMPLATE_GALLERY, type FunnelTemplateGalleryItem } from "@/lib/funnel-template-gallery";
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

const unregistered = (goal: FunnelTemplateGalleryItem["goal"], id = "new-unlisted-template"): FunnelTemplateGalleryItem => ({ ...FUNNEL_TEMPLATE_GALLERY[0]!, id, goal, name: "新範本" });

describe("template catalog labels", () => {
  it("lists every gallery template with at least one known purpose and style", () => {
    const catalog = listFunnelTemplateCatalog();
    expect(catalog.map((entry) => entry.id)).toEqual(FUNNEL_TEMPLATE_GALLERY.map((item) => item.id));
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
    expect(compatibleStepTypes({ id: "webinar-thank-you", goal: "webinar" })).toEqual(["webinar_thank_you_page"]);
    expect(compatibleStepTypes({ id: "custom-terms", goal: "custom" })).toEqual(["info_page", "contact_us_page"]);
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
    // New gallery templates (registered or derived) may join; the registered ones must be there.
    expect(sales.map((entry) => entry.id)).toEqual(expect.arrayContaining(["sell-product-checkout", "sell-simple-checkout", "sell-content-subscription", "webinar-strategy-registration"]));
    expect(sales.every((entry) => entry.purposes.includes("sales"))).toBe(true);
    expect(sales.map((entry) => entry.id)).not.toContain("custom-privacy");
    expect(filterFunnelTemplateCatalog(catalog, { style: "natural" }).every((entry) => entry.styles.includes("natural"))).toBe(true);
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "sales", style: "minimal" }).map((entry) => entry.id)).toContain("sell-simple-checkout");
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "sales", style: "minimal" }).map((entry) => entry.id)).not.toContain("sell-product-checkout");
    expect(filterFunnelTemplateCatalog(catalog, { purpose: "policy", style: "vivid" })).toEqual([]);
  });
});
