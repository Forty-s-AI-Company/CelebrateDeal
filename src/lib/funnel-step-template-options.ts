import { FUNNEL_STEP_TYPES, type FunnelStepType } from "@/lib/funnel-flow";
import type { PageDocument } from "@/lib/funnel-page-document";
import {
  FUNNEL_TEMPLATE_GALLERY,
  FUNNEL_TEMPLATE_GOALS,
  instantiateFunnelTemplate,
  listFunnelTemplateGallery,
  previewFunnelTemplate,
  type FunnelTemplateGalleryItem,
  type FunnelTemplateGoal,
} from "@/lib/funnel-template-gallery";
import type { StepTemplateOption } from "@/lib/funnel-step-template-options-meta";
import { templateDisplayDocument } from "@/lib/landing-page-template-document";

/**
 * Server side of the step template picker. Platform templates are code, not
 * tenant data, so there is no vendor to bind here; callers sit behind the
 * manager guard (see `landing-page-template-service.ts`). The registry stays on
 * the server: the browser gets card metadata, the compatible step types and a
 * thumbnail, and fetches the full document per template on preview or apply.
 */

/** Root sections a card thumbnail renders (same count as `FunnelTemplateThumbnail`). */
export const STEP_TEMPLATE_THUMBNAIL_SECTIONS = 3;

const previewPageId = (templateId: string) => `gallery_preview_${templateId}`;
const isGoal = (value: unknown): value is FunnelTemplateGoal => typeof value === "string" && (FUNNEL_TEMPLATE_GOALS as readonly string[]).includes(value);
const isStepType = (value: unknown): value is FunnelStepType => typeof value === "string" && (FUNNEL_STEP_TYPES as readonly string[]).includes(value);

/** Every template offered for some step type of the goal, in gallery order. */
export function listStepTemplateOptions(goal: FunnelTemplateGoal): StepTemplateOption[] {
  const stepTypesById = new Map<string, FunnelStepType[]>();
  for (const type of FUNNEL_STEP_TYPES) {
    for (const item of listFunnelTemplateGallery(goal, type)) stepTypesById.set(item.id, [...(stepTypesById.get(item.id) ?? []), type]);
  }
  return FUNNEL_TEMPLATE_GALLERY.filter((item) => stepTypesById.has(item.id)).map((item) => {
    const full = templateDisplayDocument(previewFunnelTemplate(item.id, previewPageId(item.id)), { keepPageCss: false });
    return {
      id: item.id, name: item.name, description: item.description, category: item.category,
      stepTypes: stepTypesById.get(item.id)!, thumbnail: { ...full, root: full.root.slice(0, STEP_TEMPLATE_THUMBNAIL_SECTIONS) },
    };
  });
}

/** The template when the gallery offers it for this goal and step type; null for unknown, retired, hidden or incompatible ids. */
function offeredTemplate(goal: unknown, stepType: unknown, templateId: unknown): FunnelTemplateGalleryItem | null {
  if (!isGoal(goal) || !isStepType(stepType) || typeof templateId !== "string") return null;
  return listFunnelTemplateGallery(goal, stepType).find((item) => item.id === templateId) ?? null;
}

type StepTemplateRequest = { goal: unknown; stepType: unknown; templateId: unknown };

/** Full preview document (same build the picker used to make in the browser), or null when not offered. */
export function getStepTemplatePreviewDocument(request: StepTemplateRequest): PageDocument | null {
  const item = offeredTemplate(request.goal, request.stepType, request.templateId);
  return item ? previewFunnelTemplate(item.id, previewPageId(item.id)) : null;
}

/** Fresh document to put on a step page (unique node ids), or null when not offered or the page id is unusable. */
export function instantiateStepTemplateDocument(request: StepTemplateRequest & { pageId: unknown }): PageDocument | null {
  const item = offeredTemplate(request.goal, request.stepType, request.templateId);
  const pageId = request.pageId;
  if (!item || typeof pageId !== "string" || !pageId || pageId.length > 200) return null;
  return instantiateFunnelTemplate(item.id, pageId);
}
