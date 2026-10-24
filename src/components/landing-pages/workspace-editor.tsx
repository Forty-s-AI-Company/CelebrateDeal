"use client";

import dynamic from "next/dynamic";
import type { LandingPageContent, LandingPageRenderContext } from "@/lib/landing-page-content";
import type { LandingPageStoredContent } from "@/lib/landing-page-service";
import type { PageDocument } from "@/lib/funnel-page-document";
import type { FunnelCommerceProduct } from "@/lib/funnel-commerce";
import type { FunnelEditorChrome } from "@/components/landing-pages/funnel-editor-chrome";
import { type FunnelStepPages } from "@/lib/funnel-step-pages";

const loading = (label: string) => function EditorLoading() { return <p role="status" className="grid h-full place-items-center p-8 text-sm font-semibold text-slate-600">{label}</p>; };
const Editor = dynamic(() => import("@/components/landing-pages/landing-page-editor").then((module) => module.LandingPageEditor), { ssr: false, loading: loading("正在載入編輯器…") });
const FunnelEditor = dynamic(() => import("@/components/landing-pages/funnel-page-editor").then((module) => module.FunnelPageEditor), { ssr: false, loading: loading("正在載入網站編輯器…") });

const FunnelStepsEditor = dynamic(() => import("@/components/landing-pages/funnel-step-pages-editor").then((module) => module.FunnelStepPagesEditor), { ssr: false, loading: loading("正在載入網站編輯器…") });

function isPageDocument(content: LandingPageStoredContent): content is PageDocument { return "root" in content && "settings" in content; }
function isFunnelStepPages(content: LandingPageStoredContent): content is FunnelStepPages { return "pages" in content && "activeStepId" in content && "flow" in content; }

/** Persistence revision is a concurrency token, not a React session key.
 * Keep save/publish acknowledgements in the same editor; external content
 * replacement is reconciled by the editor's document session boundary. */
export function WorkspaceEditor({ content, forms, live, pending, onLegacyChange, onDocumentChange, onValidityChange, commerceProducts, chrome }: {
  content: LandingPageStoredContent; forms: LandingPageRenderContext["forms"]; live?: LandingPageRenderContext["live"];
  commerceProducts: FunnelCommerceProduct[];
  pending: boolean; revision: number; onLegacyChange: (content: LandingPageContent) => void; onDocumentChange: (content: PageDocument | FunnelStepPages) => void | boolean; onValidityChange: (valid: boolean) => void;
  /** Full-screen shell controls; structured editors render the toolbar themselves. */
  chrome?: FunnelEditorChrome;
}) {
  if (isFunnelStepPages(content)) {
    return <FunnelStepsEditor state={content} disabled={pending} commerceProducts={commerceProducts} onChange={onDocumentChange} chrome={chrome} />;
  }
  if (isPageDocument(content)) return <FunnelEditor key={content.id} document={content} disabled={pending} onChange={onDocumentChange} chrome={chrome} />;
  return <Editor content={content} forms={forms} live={live} disabled={pending} onValidityChange={onValidityChange} onChange={onLegacyChange} />;
}
