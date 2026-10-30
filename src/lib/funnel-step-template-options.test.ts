import { describe, expect, it } from "vitest";
import { FUNNEL_STEP_TYPES } from "./funnel-flow";
import {
  FUNNEL_TEMPLATE_GALLERY,
  FUNNEL_TEMPLATE_GOALS,
  instantiateFunnelTemplate,
  listFunnelTemplateGallery,
  previewFunnelTemplate,
} from "./funnel-template-gallery";
import { filterStepTemplateOptions } from "./funnel-step-template-options-meta";
import {
  getStepTemplatePreviewDocument,
  instantiateStepTemplateDocument,
  listStepTemplateOptions,
  STEP_TEMPLATE_THUMBNAIL_SECTIONS,
} from "./funnel-step-template-options";
import { templateDisplayDocument } from "./landing-page-template-document";

/** Applied documents carry a unique, time based id prefix; compare them with that prefix normalised. */
const normalised = (templateId: string, value: unknown) => JSON.stringify(value).replaceAll(new RegExp(`gallery_${templateId}_[0-9a-z]+_[0-9]+`, "gu"), "PREFIX");

describe("step template picker options", () => {
  it("offers, per goal and step type, exactly the templates and order the gallery lists", () => {
    for (const goal of FUNNEL_TEMPLATE_GOALS) {
      const options = listStepTemplateOptions(goal);
      for (const stepType of FUNNEL_STEP_TYPES) {
        expect(filterStepTemplateOptions(options, stepType).map((option) => option.id)).toEqual(listFunnelTemplateGallery(goal, stepType).map((item) => item.id));
      }
    }
  });

  it("never offers retired or hidden templates", () => {
    const withheld = FUNNEL_TEMPLATE_GALLERY.filter((item) => item.retired || item.hidden).map((item) => item.id);
    expect(withheld.length).toBeGreaterThan(0);
    const offered = FUNNEL_TEMPLATE_GOALS.flatMap((goal) => listStepTemplateOptions(goal).map((option) => option.id));
    for (const id of withheld) expect(offered).not.toContain(id);
  });

  it("carries metadata and a short thumbnail only, never build code or the full document", () => {
    for (const goal of FUNNEL_TEMPLATE_GOALS) {
      for (const option of listStepTemplateOptions(goal)) {
        expect(option).not.toHaveProperty("build");
        expect(option).not.toHaveProperty("preview");
        expect(option.thumbnail.root.length).toBeLessThanOrEqual(STEP_TEMPLATE_THUMBNAIL_SECTIONS);
        expect(JSON.parse(JSON.stringify(option))).toEqual(option);
      }
    }
  });

  it("renders the thumbnail the card showed before: the first sections of the gallery preview document", () => {
    for (const goal of FUNNEL_TEMPLATE_GOALS) {
      for (const option of listStepTemplateOptions(goal)) {
        const full = templateDisplayDocument(previewFunnelTemplate(option.id, `gallery_preview_${option.id}`), { keepPageCss: false });
        expect(option.thumbnail).toEqual({ ...full, root: full.root.slice(0, STEP_TEMPLATE_THUMBNAIL_SECTIONS) });
      }
    }
  });
});

describe("step template preview and apply documents", () => {
  const offered = FUNNEL_TEMPLATE_GOALS.flatMap((goal) => FUNNEL_STEP_TYPES.flatMap((stepType) => listFunnelTemplateGallery(goal, stepType).map((item) => ({ goal, stepType, id: item.id }))));

  it("returns the same preview document the picker used to build in the browser", () => {
    for (const { goal, stepType, id } of offered) {
      expect(getStepTemplatePreviewDocument({ goal, stepType, templateId: id })).toEqual(previewFunnelTemplate(id, `gallery_preview_${id}`));
    }
  });

  it("applies the same document as the former client path, for every template and step type it is offered for", () => {
    expect(offered.length).toBeGreaterThan(0);
    for (const { goal, stepType, id } of offered) {
      const viaServer = instantiateStepTemplateDocument({ goal, stepType, templateId: id, pageId: "step_page_1" });
      expect(viaServer, id).not.toBeNull();
      expect(normalised(id, viaServer)).toBe(normalised(id, instantiateFunnelTemplate(id, "step_page_1")));
      expect(viaServer!.id).toBe("step_page_1");
    }
  });

  it("gives every application unique node ids", () => {
    const { goal, stepType, id } = offered[0]!;
    const first = instantiateStepTemplateDocument({ goal, stepType, templateId: id, pageId: "p" })!;
    const second = instantiateStepTemplateDocument({ goal, stepType, templateId: id, pageId: "p" })!;
    expect(first.root[0]!.id).not.toBe(second.root[0]!.id);
  });

  it("refuses unknown, retired, hidden and incompatible templates", () => {
    const sample = offered[0]!;
    const retired = FUNNEL_TEMPLATE_GALLERY.find((item) => item.retired)!;
    const hidden = FUNNEL_TEMPLATE_GALLERY.find((item) => item.hidden)!;
    const incompatible = offered.find((item) => item.goal === sample.goal && item.id !== sample.id && !listFunnelTemplateGallery(sample.goal, sample.stepType).some((candidate) => candidate.id === item.id))!;
    const otherGoal = offered.find((item) => item.goal !== sample.goal)!;
    for (const templateId of ["no-such-template", retired.id, hidden.id, incompatible.id, otherGoal.id, "", undefined, 7, { id: sample.id }]) {
      expect(getStepTemplatePreviewDocument({ goal: sample.goal, stepType: sample.stepType, templateId }), String(templateId)).toBeNull();
      expect(instantiateStepTemplateDocument({ goal: sample.goal, stepType: sample.stepType, templateId, pageId: "p" }), String(templateId)).toBeNull();
    }
  });

  it("refuses an unknown goal, an unknown step type and an unusable page id", () => {
    const { goal, stepType, id } = offered[0]!;
    expect(getStepTemplatePreviewDocument({ goal: "nope", stepType, templateId: id })).toBeNull();
    expect(getStepTemplatePreviewDocument({ goal, stepType: "nope", templateId: id })).toBeNull();
    expect(getStepTemplatePreviewDocument({ goal: undefined, stepType, templateId: id })).toBeNull();
    for (const pageId of ["", undefined, 5, "x".repeat(201)]) expect(instantiateStepTemplateDocument({ goal, stepType, templateId: id, pageId })).toBeNull();
  });
});
