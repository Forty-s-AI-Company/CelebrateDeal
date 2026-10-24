"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { FunnelCommerceProduct } from "@/lib/funnel-commerce";
import { FunnelPageEditor } from "@/components/landing-pages/funnel-page-editor";
import type { FunnelEditorChrome } from "@/components/landing-pages/funnel-editor-chrome";
import { getActiveFunnelStepPage, replaceFunnelStepPage, type FunnelStepPages } from "@/lib/funnel-step-pages";

type EditorProps = { state: FunnelStepPages; disabled?: boolean; onChange: (state: FunnelStepPages) => void | boolean; commerceProducts?: FunnelCommerceProduct[]; chrome?: FunnelEditorChrome };

/**
 * Edits the canvas of the active step only. Step switching, step metadata,
 * template changes and publishing live on the funnel management page
 * (systeme.io parity); the editor opens with `?step=` already resolved.
 *
 * The page editor keeps its own document session (parent echoes keep undo,
 * a replaced document starts fresh), so flow-only changes such as webinar
 * scheduling never remount the canvas.
 */
export function FunnelStepPagesEditor({ state, disabled = false, onChange, commerceProducts, chrome }: EditorProps) {
  // Rapid canvas events must build on the latest accepted state, while an
  // external replacement (new props) must win over the previous snapshot.
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; }, [state]);
  const [error, setError] = useState<string>();
  const active = getActiveFunnelStepPage(state);
  if (!active) return <p role="alert" className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">網站步驟資料無法通過驗證。</p>;
  const stepChrome = chrome ? { ...chrome, title: `${chrome.title} › ${active.step.name}` } : undefined;
  return <div className="flex h-full min-h-0 flex-col">
    {error ? <p role="alert" className="shrink-0 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p> : null}
    {!active.editable ? <p role="status" className="shrink-0 bg-amber-50 px-4 py-2 text-sm text-amber-900">「{active.step.name}」是系統頁，只能預覽，無法編輯內容。</p> : null}
    <div className="min-h-0 flex-1">
      <FunnelPageEditor key={active.page.id} document={active.page} chrome={stepChrome} commerceProducts={commerceProducts} commerceEnabled={active.step.type === "order_form"} stepIds={state.flow.steps.map((step) => step.id)} stepNames={Object.fromEntries(state.flow.steps.map((step) => [step.id, step.name]))} disabled={disabled || !active.editable} onChange={(page) => {
        if (disabled) return false;
        const result = replaceFunnelStepPage(stateRef.current, active.step.id, page);
        if (!result.ok) { setError(result.error); return false; }
        if (onChange(result.state) === false) { setError("父層未接受這次修改，請重新確認草稿。"); return false; }
        stateRef.current = result.state;
        setError(undefined);
        return true;
      }} />
    </div>
  </div>;
}
