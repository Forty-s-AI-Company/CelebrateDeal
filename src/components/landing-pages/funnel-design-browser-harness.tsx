"use client";

import { useSyncExternalStore } from "react";
import { FunnelPageDocumentRenderer, type FunnelSubmissionContext, type FunnelViewport } from "./funnel-page-document-renderer";
import { PublicFunnelDocument } from "./public-funnel-document";
import { FUNNEL_BLOCK_REGISTRY, getFunnelBlocksByCategory, listFunnelBlockCategories, previewFunnelBlockDocument } from "@/lib/funnel-block-library";
import { FUNNEL_TEMPLATE_GALLERY, getFunnelTemplateGalleryItem, previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { stressFunnelDocument } from "@/lib/funnel-template-stress";

/**
 * Synthetic registration context so lead forms render their real public fields (the layout checks measure them).
 * Display only: the QA script never submits, and the harness is development-only.
 */
const HARNESS_SUBMISSION: FunnelSubmissionContext = {
  form: {
    id: "design-harness-form",
    fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "電子信箱", type: "email", required: true }, { key: "phone", label: "手機號碼", type: "tel", required: false }],
    submitLabel: "免費報名",
    successMessage: "報名成功",
  },
  landingPageId: "design-harness-page",
};

export type FunnelHarnessViewport = FunnelViewport | "responsive";

/**
 * Development-only visual QA surface for the R3 typography, templates and
 * block library. Every document is built deterministically from its ID, so the
 * page also exercises server/browser render parity (no hydration drift).
 */
export function FunnelDesignBrowserHarness({ template, block, category, viewport, stress = false, initialViewport }: { template?: string; block?: string; category?: string; viewport: FunnelHarnessViewport; stress?: boolean; initialViewport?: FunnelViewport }) {
  // false during SSR and hydration, true once mounted: lets the QA script wait for a hydrated page.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const frame = viewport === "mobile" ? "mx-auto w-[375px] max-w-full" : "w-full";
  // getFunnelTemplateGalleryItem also resolves hidden or retired templates.
  if (template && getFunnelTemplateGalleryItem(template)) {
    const document = stress ? stressFunnelDocument(previewFunnelTemplate(template)) : previewFunnelTemplate(template);
    // "responsive" renders the real public path with no forced viewport and no phone frame.
    if (viewport === "responsive") return <div data-design-harness="template" data-design-harness-viewport="responsive" data-design-harness-stress={stress ? "true" : undefined} data-design-harness-ready={ready ? "true" : undefined} className="w-full"><PublicFunnelDocument document={document} submission={HARNESS_SUBMISSION} initialViewport={initialViewport} /></div>;
    return <div data-design-harness="template" data-design-harness-stress={stress ? "true" : undefined} data-design-harness-ready={ready ? "true" : undefined} className={frame}><FunnelPageDocumentRenderer document={document} viewport={viewport} /></div>;
  }
  const fixedViewport: FunnelViewport = viewport === "responsive" ? "desktop" : viewport;
  if (block && FUNNEL_BLOCK_REGISTRY[block]) {
    return <div data-design-harness="block" data-design-harness-ready={ready ? "true" : undefined} className={frame}><FunnelPageDocumentRenderer document={previewFunnelBlockDocument(block)} viewport={fixedViewport} /></div>;
  }
  const categories = listFunnelBlockCategories().filter((item) => !category || item.id === category);
  return <main data-design-harness-ready={ready ? "true" : undefined} className="grid gap-10 bg-slate-100 p-6">
    <h1 className="text-2xl font-bold">一頁式網站設計驗證</h1>
    <nav aria-label="模板" className="flex flex-wrap gap-2 text-sm">{FUNNEL_TEMPLATE_GALLERY.map((item) => <a key={item.id} className="underline" href={`?template=${item.id}`}>{item.name}</a>)}</nav>
    {categories.map((item) => <section key={item.id} aria-label={item.label} className="grid gap-4">
      <h2 className="text-xl font-bold">{item.label}（{item.variantCount}）</h2>
      {getFunnelBlocksByCategory(item.id).map((entry) => <figure key={entry.id} data-design-block={entry.id} className={`overflow-hidden rounded-xl bg-white shadow ${frame}`}>
        <figcaption className="border-b px-4 py-2 text-sm text-slate-700">{entry.label}・{entry.id}</figcaption>
        <FunnelPageDocumentRenderer document={previewFunnelBlockDocument(entry.id)} viewport={fixedViewport} landmark={false} />
      </figure>)}
    </section>)}
  </main>;
}
