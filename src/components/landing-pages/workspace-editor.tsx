"use client";

import dynamic from "next/dynamic";
import type { PageDocument } from "@/lib/funnel-page-document";
import type { FunnelCommerceProduct } from "@/lib/funnel-commerce";
import type { FunnelEditorChrome } from "@/components/landing-pages/funnel-editor-chrome";
import { type FunnelStepPages } from "@/lib/funnel-step-pages";

const loading = (label: string) => function EditorLoading() { return <p role="status" className="grid h-full place-items-center p-8 text-sm font-semibold text-slate-600">{label}</p>; };
const FunnelEditor = dynamic(() => import("@/components/landing-pages/funnel-page-editor").then((module) => module.FunnelPageEditor), { ssr: false, loading: loading("正在載入網站編輯器…") });

const FunnelStepsEditor = dynamic(() => import("@/components/landing-pages/funnel-step-pages-editor").then((module) => module.FunnelStepPagesEditor), { ssr: false, loading: loading("正在載入網站編輯器…") });

/** Content the editor can open. Legacy pages are converted to a PageDocument before they get here. */
export type WorkspaceEditorContent = PageDocument | FunnelStepPages;

function isFunnelStepPages(content: WorkspaceEditorContent): content is FunnelStepPages { return "pages" in content && "activeStepId" in content && "flow" in content; }

/** Persistence revision is a concurrency token, not a React session key.
 * Keep save/publish acknowledgements in the same editor; external content
 * replacement is reconciled by the editor's document session boundary. */
export function WorkspaceEditor({ content, pending, onDocumentChange, commerceProducts, chrome }: {
  content: WorkspaceEditorContent;
  commerceProducts: FunnelCommerceProduct[];
  pending: boolean; revision: number; onDocumentChange: (content: WorkspaceEditorContent) => void | boolean;
  /** Full-screen shell controls; structured editors render the toolbar themselves. */
  chrome?: FunnelEditorChrome;
}) {
  if (isFunnelStepPages(content)) {
    return <FunnelStepsEditor state={content} disabled={pending} commerceProducts={commerceProducts} onChange={onDocumentChange} chrome={chrome} />;
  }
  return <FunnelEditor key={content.id} document={content} disabled={pending} onChange={onDocumentChange} chrome={chrome} />;
}
