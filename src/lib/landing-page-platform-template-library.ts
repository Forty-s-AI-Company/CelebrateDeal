import type { FunnelStepType } from "@/lib/funnel-flow";
import type { PageDocument } from "@/lib/funnel-page-document";
import { compatibleStepTypes, listFunnelTemplateCatalog } from "@/lib/funnel-template-catalog";
import { getFunnelTemplateGalleryItem, previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import type { FunnelTemplateCatalogEntry } from "@/lib/funnel-template-library-meta";
import { templateDisplayDocument } from "@/lib/landing-page-template-document";

/**
 * Server side of the platform tab in 範本庫. The template registry (every
 * template's build code) stays on the server: the browser receives only the
 * card metadata, the step types a template fits and a thumbnail (the first
 * root sections the card renders). The full document is read per template when
 * it is previewed. Platform templates are code, not tenant data, so there is no
 * vendor to bind; callers still sit behind the manager guard.
 */

/** Root sections a card thumbnail renders (same count as `FunnelTemplateThumbnail`). */
export const PLATFORM_THUMBNAIL_SECTIONS = 3;

export type PlatformTemplateLibraryEntry = FunnelTemplateCatalogEntry & {
  /** Step types the gallery offers this template for (replaces a client-side gallery lookup). */
  stepTypes: FunnelStepType[];
  thumbnail: PageDocument;
};

/** Page id of a library preview; unchanged from the former client-side build so node ids stay identical. */
const previewPageId = (templateId: string) => `library_preview_${templateId}`;

export function listPlatformTemplateLibrary(): PlatformTemplateLibraryEntry[] {
  return listFunnelTemplateCatalog().map((entry) => {
    const full = templateDisplayDocument(previewFunnelTemplate(entry.id, previewPageId(entry.id)), { keepPageCss: false });
    return { ...entry, stepTypes: compatibleStepTypes(entry), thumbnail: { ...full, root: full.root.slice(0, PLATFORM_THUMBNAIL_SECTIONS) } };
  });
}

/** Full preview document of a library template, or null when the id is not browsable in the library. */
export function getPlatformTemplatePreviewDocument(templateId: unknown): PageDocument | null {
  if (typeof templateId !== "string") return null;
  const item = getFunnelTemplateGalleryItem(templateId);
  // Retired, hidden and step-only templates are not in the library, so they are not previewable from it either.
  if (!item || !listFunnelTemplateCatalog([item]).length) return null;
  return previewFunnelTemplate(item.id, previewPageId(item.id));
}
