import { describe, expect, it } from "vitest";
import { listFunnelTemplateCatalog } from "./funnel-template-catalog";
import { listFunnelTemplateGallery, previewFunnelTemplate } from "./funnel-template-gallery";
import { FUNNEL_STEP_TYPES } from "./funnel-flow";
import { getPlatformTemplatePreviewDocument, listPlatformTemplateLibrary, PLATFORM_THUMBNAIL_SECTIONS } from "./landing-page-platform-template-library";
import { templateDisplayDocument } from "./landing-page-template-document";

describe("platform template library list", () => {
  const list = listPlatformTemplateLibrary();

  it("lists the same templates in the same order as the catalog", () => {
    expect(list.map((entry) => entry.id)).toEqual(listFunnelTemplateCatalog().map((entry) => entry.id));
  });

  it("carries metadata and a short thumbnail only, never build code or the full document", () => {
    for (const entry of list) {
      expect(entry).not.toHaveProperty("build");
      expect(entry).not.toHaveProperty("preview");
      expect(entry.thumbnail.root.length).toBeLessThanOrEqual(PLATFORM_THUMBNAIL_SECTIONS);
      expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    }
    const long = list.find((entry) => previewFunnelTemplate(entry.id).root.length > PLATFORM_THUMBNAIL_SECTIONS)!;
    expect(long.thumbnail.root).toHaveLength(PLATFORM_THUMBNAIL_SECTIONS);
  });

  it("renders the same thumbnail the card showed before: the first sections of the preview document", () => {
    for (const entry of list) {
      const full = templateDisplayDocument(previewFunnelTemplate(entry.id, `library_preview_${entry.id}`), { keepPageCss: false });
      expect(entry.thumbnail).toEqual({ ...full, root: full.root.slice(0, PLATFORM_THUMBNAIL_SECTIONS) });
    }
  });

  it("lists exactly the step types the gallery offers each template for", () => {
    for (const entry of list) {
      const offered = FUNNEL_STEP_TYPES.filter((type) => listFunnelTemplateGallery(entry.goal, type).some((item) => item.id === entry.id));
      expect(entry.stepTypes).toEqual(offered);
    }
  });
});

describe("platform template preview document", () => {
  it("is the full preview document, identical to the former client-side build", () => {
    for (const entry of listFunnelTemplateCatalog()) {
      expect(getPlatformTemplatePreviewDocument(entry.id)).toEqual(previewFunnelTemplate(entry.id, `library_preview_${entry.id}`));
    }
  });

  it("refuses ids that are unknown, not strings, or not browsable in the library", () => {
    expect(getPlatformTemplatePreviewDocument("no-such-template")).toBeNull();
    expect(getPlatformTemplatePreviewDocument(undefined)).toBeNull();
    expect(getPlatformTemplatePreviewDocument({ id: "webinar-ai-minimal" })).toBeNull();
    // Retired and step-only (thank-you) templates resolve for saved funnels but are not library entries.
    expect(getPlatformTemplatePreviewDocument("webinar-registration")).toBeNull();
    expect(getPlatformTemplatePreviewDocument("leads-checklist-minimal-thanks")).toBeNull();
  });
});
