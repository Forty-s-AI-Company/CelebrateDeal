import { describe, expect, it } from "vitest";
import { getFunnelTemplateGalleryItem, listFunnelTemplateGallery } from "@/lib/funnel-template-gallery";
import { listFunnelTemplateCatalog } from "@/lib/funnel-template-catalog";
import { WEBINAR_TEMPLATES } from "./index";
import { webinarTemplateIssues } from "./template-checks";

describe("webinar template registry", () => {
  it("registers unique ids and spec numbers", () => {
    expect(new Set(WEBINAR_TEMPLATES.map((template) => template.id)).size).toBe(WEBINAR_TEMPLATES.length);
    expect(new Set(WEBINAR_TEMPLATES.map((template) => template.number)).size).toBe(WEBINAR_TEMPLATES.length);
    for (const template of WEBINAR_TEMPLATES) expect(template.number).toBeGreaterThanOrEqual(0);
  });

  it.each(WEBINAR_TEMPLATES)("$id passes the shared template checks", (template) => {
    expect(webinarTemplateIssues(template)).toEqual([]);
  });

  it("offers visible templates for the webinar registration step with their own library tags, and hides the example", () => {
    const offered = listFunnelTemplateGallery("webinar", "webinar_registration_page").map((item) => item.id);
    const catalog = listFunnelTemplateCatalog();
    for (const template of WEBINAR_TEMPLATES) {
      expect(getFunnelTemplateGalleryItem(template.id)).not.toBeNull();
      expect(offered.includes(template.id)).toBe(!template.hidden);
      const entry = catalog.find((candidate) => candidate.id === template.id);
      if (template.hidden) expect(entry).toBeUndefined();
      else expect(entry).toMatchObject({ purposes: [...template.purposes], styles: [...template.styles], registered: true });
    }
  });
});
