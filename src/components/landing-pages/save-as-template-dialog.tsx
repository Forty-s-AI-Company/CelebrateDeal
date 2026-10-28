"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { saveLandingPageTemplateAction } from "@/app/actions/landing-page-template-actions";
import { LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH } from "@/lib/landing-page-template-document";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

/**
 * 「存成範本」: the server reads the stored draft of the step, so the dialog
 * only sends the page, step and name. Unsaved editor changes are therefore
 * not included; the caller passes `blockedReason` while there are any.
 */
export function SaveAsTemplateDialog({ csrfName, csrfToken, pageId, stepId, stepName, defaultName, blockedReason, onClose }: {
  csrfName: string;
  csrfToken: string;
  pageId: string;
  stepId?: string;
  stepName?: string;
  defaultName: string;
  blockedReason?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName.slice(0, LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH));
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape is ignored while saving; the handler identity may change, the dialog stays mounted.
  useDialogBehavior(true, () => { if (!pending) onClose(); });
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const trimmed = name.trim();
  const saved = result?.tone === "success";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || pending || blockedReason || saved) return;
    const data = new FormData();
    data.set(csrfName, csrfToken);
    data.set("pageId", pageId);
    if (stepId) data.set("stepId", stepId);
    data.set("name", trimmed);
    startTransition(async () => {
      try {
        const response = await saveLandingPageTemplateAction({ status: "idle", message: "" }, data);
        setResult({ tone: response.status === "success" ? "success" : "error", text: response.message });
      } catch {
        setResult({ tone: "error", text: "連線中斷，範本沒有建立，請稍後再試。" });
      }
    });
  }

  return <div role="dialog" aria-modal="true" aria-labelledby="save-as-template-title" aria-describedby="save-as-template-description" className="fixed inset-0 z-[160] grid place-items-center bg-slate-950/60 p-3 sm:p-6">
    <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
      <h2 id="save-as-template-title" className="text-lg font-bold text-slate-950">存成範本</h2>
      <p id="save-as-template-description" className="mt-2 text-sm leading-6 text-slate-600">把{stepName ? `「${stepName}」` : "這個頁面"}最後一次儲存的版面與文字存成你的範本，之後可在「範本 › 我的範本」用來建立新網站或套用到其他步驟。</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
        <li>報名表、活動場次、商品與價格、預約行事曆與「前往下一步」連結不會存入範本，使用後請重新設定。</li>
        <li>圖片網址、文字、樣式與彈出視窗會保留。</li>
      </ul>
      <label className="mt-4 grid gap-1.5 text-sm font-semibold text-slate-700">範本名稱
        <input ref={inputRef} required maxLength={LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH} value={name} disabled={pending || saved} onChange={(event) => setName(event.currentTarget.value)} className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50" />
        <span className="text-xs font-normal text-slate-500">{[...trimmed].length}／{LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH} 字</span>
      </label>
      {blockedReason ? <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{blockedReason}</p> : null}
      {result ? <p role={result.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-lg border p-3 text-sm ${result.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{result.text}{saved ? <> <Link href="/landing-pages/templates?tab=mine" className="font-semibold underline">查看我的範本</Link></> : null}</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" disabled={pending} onClick={onClose} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50">{saved ? "完成" : "取消"}</button>
        {!saved ? <button type="submit" disabled={!trimmed || pending || Boolean(blockedReason)} className="min-h-11 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "儲存中…" : "存成範本"}</button> : null}
      </div>
    </form>
  </div>;
}
