"use client";

import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle } from "lucide-react";
import { SideDrawer } from "@/components/side-drawer";
import type { LandingPagePublicationStatus } from "@/lib/landing-page-service";

/**
 * One run of 發布 in the editor: save the draft, run the server's publish
 * check (the publish transaction rolled back), then publish on request.
 * `blocked` covers a refused check and a refused publish alike.
 */
export type PublishFlowState =
  | { phase: "saving" }
  | { phase: "save_failed"; message: string; code?: string }
  | { phase: "checking" }
  | { phase: "blocked"; message: string; code?: string; publication?: LandingPagePublicationStatus }
  | { phase: "ready"; publication?: LandingPagePublicationStatus }
  | { phase: "publishing"; publication?: LandingPagePublicationStatus };

export type PublishFixKind = "commerce" | "page_settings" | "reload" | "edit";
export type PublishFix = { kind: PublishFixKind; label: string } | { kind: "management"; label: string };

/** Commerce state of the page being published; display only, never a publish rule. */
export type PublishCommerceStatus = "none" | "unbound" | "unavailable" | "bound";

const PAGE_SETTINGS_CODES = new Set([
  "landing_page_webinar_schedule_required", "landing_page_webinar_resources_required", "landing_page_live_form_mismatch",
  "landing_page_live_invalid", "landing_page_live_not_public", "landing_page_form_invalid", "landing_page_audience_live_requires_project",
  "landing_page_slug_reserved", "landing_page_slug_locked", "landing_page_custom_css_invalid", "settings_invalid",
]);
const MANAGEMENT_CODES = new Set(["landing_page_operations_reference_invalid", "landing_page_webinar_steps_required", "landing_page_step_type_not_allowed"]);

/** Where the merchant fixes a refusal; the reason text itself comes from the server. */
export function publishFixFor(code: string | undefined): PublishFix | null {
  if (!code) return null;
  if (code === "landing_page_commerce_invalid") return { kind: "commerce", label: "重新選擇結帳商品" };
  if (code === "landing_page_conflict") return { kind: "reload", label: "重新載入最新版本" };
  if (PAGE_SETTINGS_CODES.has(code)) return { kind: "page_settings", label: "開啟頁面設定" };
  if (MANAGEMENT_CODES.has(code)) return { kind: "management", label: "前往網站管理調整步驟" };
  // Refusals answered by the diagnosis links (independent publication limit) need no extra action.
  if (code.startsWith("landing_page_independent_publish")) return null;
  return { kind: "edit", label: "返回編輯修正內容" };
}

type RowStatus = "waiting" | "running" | "passed" | "failed";
const rowStatusText: Record<RowStatus, string> = { waiting: "等待中", running: "進行中", passed: "通過", failed: "未通過" };

function StatusIcon({ status }: { status: RowStatus }) {
  if (status === "running") return <LoaderCircle size={18} aria-hidden className="mt-0.5 shrink-0 animate-spin text-slate-500 motion-reduce:animate-none" />;
  if (status === "passed") return <CircleCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-emerald-700" />;
  if (status === "failed") return <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-red-700" />;
  return <CircleDashed size={18} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />;
}

function CheckRow({ label, status, children }: { label: string; status: RowStatus; children?: React.ReactNode }) {
  return <li data-publish-check={label} data-status={status} className={`flex gap-3 rounded-lg border p-3 ${status === "failed" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
    <StatusIcon status={status} />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-slate-900">{label}<span className={`ml-2 text-xs font-semibold ${status === "failed" ? "text-red-800" : status === "passed" ? "text-emerald-800" : "text-slate-600"}`}>{rowStatusText[status]}</span></p>
      {children}
    </div>
  </li>;
}

function rowStatuses(state: PublishFlowState): { save: RowStatus; check: RowStatus } {
  switch (state.phase) {
    case "saving": return { save: "running", check: "waiting" };
    case "save_failed": return { save: "failed", check: "waiting" };
    case "checking": return { save: "passed", check: "running" };
    case "blocked": return { save: "passed", check: "failed" };
    default: return { save: "passed", check: "passed" };
  }
}

function summary(state: PublishFlowState, published: boolean) {
  switch (state.phase) {
    case "saving": return "正在儲存草稿…";
    case "save_failed": return "草稿沒有儲存，尚未發布。";
    case "checking": return "正在執行發布檢查…";
    case "blocked": return "發布檢查未通過，網站沒有變更。";
    case "ready": return published ? "檢查通過，可以更新發布。" : "檢查通過，可以發布。";
    default: return "正在發布…";
  }
}

function FixButton({ fix, managementHref, onFix }: { fix: PublishFix | null; managementHref?: string; onFix: (kind: PublishFixKind) => void }) {
  if (!fix) return null;
  const className = "mt-2 inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400";
  if (fix.kind === "management") return managementHref ? <a href={managementHref} className={className}>{fix.label}</a> : null;
  const kind = fix.kind;
  return <button type="button" className={className} onClick={() => onFix(kind)}>{fix.label}</button>;
}

function DiagnosisLinks({ title, items, tone }: { title: string; items: Array<{ label: string; href: string }>; tone: "neutral" | "warning" }) {
  if (!items.length) return null;
  return <ul aria-label={title} className={`mt-2 list-disc space-y-1 pl-5 text-sm ${tone === "warning" ? "text-amber-900" : "text-slate-800"}`}>
    {items.map((item) => <li key={`${item.label}-${item.href}`}><a className="font-semibold text-blue-700 underline" href={item.href}>{item.label}</a></li>)}
  </ul>;
}

/** Current public-URL diagnosis: informational, never a publish rule here. */
function PublicationNote({ publication }: { publication?: LandingPagePublicationStatus }) {
  if (!publication) return null;
  return <section aria-labelledby="funnel-publish-public-url" className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <h3 id="funnel-publish-public-url" className="text-sm font-semibold text-slate-900">公開網址目前狀態</h3>
    <p className="mt-1 text-sm leading-6 text-slate-700">{publication.message}</p>
    <DiagnosisLinks title="尚未完成" items={publication.missing} tone="neutral" />
    <DiagnosisLinks title="需要注意" items={publication.warnings ?? []} tone="warning" />
  </section>;
}

/**
 * 發布 drawer of the full-screen editor. It shows only what the server said:
 * the save result, the publish check (same rules as publishing) and the
 * scoped diagnosis. Fix actions move the editor to the setting in question.
 */
export function FunnelPublishDrawer({ state, published, commerce, managementHref, onPublish, onRetry, onFix, onClose }: {
  state: PublishFlowState;
  published: boolean;
  commerce: PublishCommerceStatus;
  managementHref?: string;
  onPublish: () => void;
  onRetry: () => void;
  onFix: (kind: PublishFixKind) => void;
  onClose: () => void;
}) {
  const rows = rowStatuses(state);
  const action = published ? "更新發布" : "發布";
  const publication = "publication" in state ? state.publication : undefined;
  const canRetry = state.phase === "blocked" || state.phase === "save_failed";
  const footer = <div className="flex flex-wrap items-center justify-end gap-2">
    <button type="button" onClick={onClose} disabled={state.phase === "publishing"} className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50">取消</button>
    {canRetry ? <button type="button" onClick={onRetry} className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-blue-700 bg-white px-4 text-sm font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">重新檢查</button> : null}
    <button type="button" onClick={onPublish} disabled={state.phase !== "ready"} className="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-700">{state.phase === "publishing" ? `${action}中…` : `確認${action}`}</button>
  </div>;
  return <SideDrawer title={published ? "更新發布網站" : "發布網站"} description="發布前會先儲存目前的變更，並執行與正式發布相同的檢查。檢查不會改動公開網站。" busy={state.phase === "publishing"} onClose={onClose} footer={footer}>
    <p role="status" aria-live="polite" className="mb-3 text-sm font-semibold text-slate-900">{summary(state, published)}</p>
    <ol aria-label="發布檢查" className="grid gap-2">
      <CheckRow label="儲存草稿" status={rows.save}>
        {state.phase === "save_failed" ? <><p className="mt-1 text-sm leading-6 text-red-800">{state.message}</p><FixButton fix={publishFixFor(state.code)} managementHref={managementHref} onFix={onFix} /></> : null}
      </CheckRow>
      <CheckRow label="發布檢查" status={rows.check}>
        {state.phase === "blocked" ? <>
          <p className="mt-1 text-sm leading-6 text-red-800">{state.message}</p>
          <FixButton fix={publishFixFor(state.code)} managementHref={managementHref} onFix={onFix} />
        </> : null}
        {rows.check === "passed" ? <p className="mt-1 text-sm leading-6 text-slate-700">名稱、網址、綁定的表單與直播、商品結帳、自訂程式碼與方案上限都符合發布條件。</p> : null}
      </CheckRow>
    </ol>
    {commerce === "unbound" || commerce === "unavailable" ? <div data-publish-commerce-warning={commerce} className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
      <p className="font-semibold">{commerce === "unbound" ? "這個頁面的結帳元件還沒有連結商品" : "這個頁面連結的商品目前無法販售"}</p>
      <p>可以先發布，但訪客在這個頁面無法結帳。</p>
      <FixButton fix={{ kind: "commerce", label: "選取結帳元件並選擇商品" }} onFix={onFix} />
    </div> : null}
    <PublicationNote publication={publication} />
  </SideDrawer>;
}
