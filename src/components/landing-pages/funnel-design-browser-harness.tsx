"use client";

import { FunnelPageDocumentRenderer, type FunnelViewport } from "./funnel-page-document-renderer";
import { FUNNEL_BLOCK_REGISTRY, getFunnelBlocksByCategory, listFunnelBlockCategories, previewFunnelBlockDocument } from "@/lib/funnel-block-library";
import { FUNNEL_TEMPLATE_GALLERY, previewFunnelTemplate } from "@/lib/funnel-template-gallery";

/**
 * Development-only visual QA surface for the R3 typography, templates and
 * block library. Every document is built deterministically from its ID, so the
 * page also exercises server/browser render parity (no hydration drift).
 */
export function FunnelDesignBrowserHarness({ template, block, category, viewport }: { template?: string; block?: string; category?: string; viewport: FunnelViewport }) {
  const frame = viewport === "mobile" ? "mx-auto w-[375px] max-w-full" : "w-full";
  if (template && FUNNEL_TEMPLATE_GALLERY.some((item) => item.id === template)) {
    return <div data-design-harness="template" className={frame}><FunnelPageDocumentRenderer document={previewFunnelTemplate(template)} viewport={viewport} /></div>;
  }
  if (block && FUNNEL_BLOCK_REGISTRY[block]) {
    return <div data-design-harness="block" className={frame}><FunnelPageDocumentRenderer document={previewFunnelBlockDocument(block)} viewport={viewport} /></div>;
  }
  const categories = listFunnelBlockCategories().filter((item) => !category || item.id === category);
  return <main className="grid gap-10 bg-slate-100 p-6">
    <h1 className="text-2xl font-bold">一頁式網站設計驗證</h1>
    <nav aria-label="模板" className="flex flex-wrap gap-2 text-sm">{FUNNEL_TEMPLATE_GALLERY.map((item) => <a key={item.id} className="underline" href={`?template=${item.id}`}>{item.name}</a>)}</nav>
    {categories.map((item) => <section key={item.id} aria-label={item.label} className="grid gap-4">
      <h2 className="text-xl font-bold">{item.label}（{item.variantCount}）</h2>
      {getFunnelBlocksByCategory(item.id).map((entry) => <figure key={entry.id} data-design-block={entry.id} className={`overflow-hidden rounded-xl bg-white shadow ${frame}`}>
        <figcaption className="border-b px-4 py-2 text-sm text-slate-700">{entry.label}・{entry.id}</figcaption>
        <FunnelPageDocumentRenderer document={previewFunnelBlockDocument(entry.id)} viewport={viewport} landmark={false} />
      </figure>)}
    </section>)}
  </main>;
}
