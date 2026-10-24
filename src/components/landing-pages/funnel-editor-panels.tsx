"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Copy, Monitor, Smartphone, Trash2 } from "lucide-react";
import { funnelDeviceVisibilityCommand, funnelNodeVisibility, type FunnelDevice } from "@/lib/funnel-node-visibility";
import { FunnelElementInspector } from "./funnel-element-inspector";
import { FunnelCommerceSettings } from "./funnel-commerce-settings";
import { funnelNodeLabel } from "./funnel-editor-library";
import type { FunnelCommerceProduct } from "@/lib/funnel-commerce";
import type { FunnelNode, PageDocument } from "@/lib/funnel-page-document";
import type { FunnelPageCommand } from "@/lib/funnel-page-history";
import { createFunnelPopup, deleteFunnelPopup, updateFunnelPopup, validatePopupTrigger } from "@/lib/funnel-popup";

export const panelControl = "min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50";
const smallButton = "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40";
const iconAction = "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40";

/** Header shared by every non-default panel view: 返回 + optional actions + title. */
export function PanelHeader({ title, backLabel = "返回", onBack, actions, subtitle }: { title: string; backLabel?: string; onBack: () => void; actions?: ReactNode; subtitle?: string }) {
  return <div className="mb-4 grid gap-3">
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={onBack} aria-label={backLabel} className={smallButton}><ChevronLeft size={16} aria-hidden />返回</button>
      {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
    </div>
    <div><h2 className="text-lg font-bold text-slate-950">{title}</h2>{subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}</div>
  </div>;
}

/** EDT-RESP-001: 桌機顯示／手機顯示, stored as per-device overrides of the existing model. */
export function DeviceVisibilityToggles({ node, viewport, disabled, onCommand }: { node: FunnelNode; viewport: FunnelDevice; disabled: boolean; onCommand: (command: FunnelPageCommand) => void }) {
  const visibility = funnelNodeVisibility(node);
  const devices: ReadonlyArray<{ id: FunnelDevice; label: string; icon: typeof Monitor }> = [{ id: "desktop", label: "桌機顯示", icon: Monitor }, { id: "mobile", label: "手機顯示", icon: Smartphone }];
  return <fieldset data-funnel-device-visibility className="mb-4 grid gap-2 rounded-lg border border-slate-200 p-3">
    <legend className="px-1 text-sm font-bold text-slate-900">裝置顯示</legend>
    <div className="grid grid-cols-2 gap-2">
      {devices.map(({ id, label, icon: Icon }) => <label key={id} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-sm font-semibold ${viewport === id ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 text-slate-700"}`}>
        <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-700" disabled={disabled} checked={visibility[id]} onChange={(event) => { const command = funnelDeviceVisibilityCommand(node, id, event.currentTarget.checked); if (command) onCommand(command); }} />
        <Icon size={15} aria-hidden />{label}
      </label>)}
    </div>
    {!visibility.desktop || !visibility.mobile ? <p className="text-xs leading-5 text-slate-600">隱藏的元件在編輯畫布上以斜線標示，預覽與公開頁面不會顯示。</p> : null}
  </fieldset>;
}

/** EDT-INT-001: the selected node's settings replace the library in the left panel. */
export function NodeSettingsPanel({ node, path, disabled, viewport, popups, stepIds, stepNames, onCommand, onBack, onDuplicate, onDelete }: {
  node: FunnelNode; path: readonly FunnelNode[]; disabled: boolean; viewport: FunnelDevice; popups: PageDocument["popups"];
  stepIds?: readonly string[]; stepNames?: Readonly<Record<string, string>>;
  onCommand: (command: FunnelPageCommand) => void; onBack: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  const label = funnelNodeLabel(node.type);
  return <div data-funnel-node-settings={node.type}>
    <PanelHeader title={label} backLabel="返回（取消選取）" onBack={onBack} subtitle={path.length > 1 ? path.map((item) => funnelNodeLabel(item.type)).join(" › ") : undefined} actions={<>
      <button type="button" aria-label={`上移${label}`} title="上移" disabled={disabled} className={iconAction} onClick={() => onCommand({ type: "move_up", nodeId: node.id })}><ArrowUp size={17} aria-hidden /></button>
      <button type="button" aria-label={`下移${label}`} title="下移" disabled={disabled} className={iconAction} onClick={() => onCommand({ type: "move_down", nodeId: node.id })}><ArrowDown size={17} aria-hidden /></button>
      <button type="button" aria-label={`複製${label}`} title="複製" disabled={disabled} className={iconAction} onClick={onDuplicate}><Copy size={17} aria-hidden /></button>
      <button type="button" aria-label={`刪除${label}`} title="刪除（Delete）" disabled={disabled} className={`${iconAction} text-red-600 hover:bg-red-50 hover:text-red-700`} onClick={onDelete}><Trash2 size={17} aria-hidden /></button>
    </>} />
    <DeviceVisibilityToggles node={node} viewport={viewport} disabled={disabled} onCommand={onCommand} />
    <FunnelElementInspector key={node.id} node={node} disabled={disabled} popupIds={popups.map((popup) => popup.id)} popupNames={Object.fromEntries(popups.map((popup) => [popup.id, popup.name]))} stepIds={stepIds} stepNames={stepNames} onCommand={onCommand} />
  </div>;
}

/** 頁面設定: workspace metadata (name, URL, form, live) plus this page's document settings. */
export function PageSettingsPanel({ document, disabled, commerceEnabled, commerceProducts, workspaceSettings, onCommand, onReplace, onBack }: {
  document: PageDocument; disabled: boolean; commerceEnabled: boolean; commerceProducts: FunnelCommerceProduct[]; workspaceSettings?: ReactNode;
  onCommand: (command: FunnelPageCommand) => void; onReplace: (document: PageDocument) => void; onBack: () => void;
}) {
  const settings = document.settings;
  const update = (patch: Partial<PageDocument["settings"]>) => onCommand({ type: "update_settings", settings: patch });
  return <div>
    <PanelHeader title="頁面設定" onBack={onBack} />
    <div className="grid gap-5">
      {workspaceSettings ? <section aria-labelledby="funnel-page-basic-settings" className="grid gap-3"><h3 id="funnel-page-basic-settings" className="text-sm font-bold text-slate-900">基本資料</h3>{workspaceSettings}</section> : null}
      <section aria-labelledby="funnel-page-document-settings" className="grid gap-3">
        <h3 id="funnel-page-document-settings" className="text-sm font-bold text-slate-900">頁面內容</h3>
        {commerceEnabled ? <FunnelCommerceSettings binding={document.commerce} products={commerceProducts} disabled={disabled} onChange={(commerce) => onReplace({ ...document, commerce })} /> : <p className="text-xs text-slate-600">商品與結帳設定位於「訂單表單」步驟的頁面設定。</p>}
        <label className="grid gap-1 text-sm font-semibold text-slate-700">語言<select disabled={disabled} className={panelControl} value={settings.language} onChange={(event) => update({ language: event.currentTarget.value as PageDocument["settings"]["language"] })}><option value="zh-TW">繁體中文</option><option value="en">英文</option><option value="ja">日本語</option></select></label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">搜尋引擎標題<input disabled={disabled} className={panelControl} value={settings.seo.title ?? ""} onChange={(event) => update({ seo: { ...settings.seo, title: event.currentTarget.value } })} /></label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">搜尋引擎描述<textarea disabled={disabled} className={`${panelControl} min-h-20`} value={settings.seo.description ?? ""} onChange={(event) => update({ seo: { ...settings.seo, description: event.currentTarget.value } })} /></label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">背景色<input disabled={disabled} className={panelControl} value={settings.background.color} onChange={(event) => update({ background: { ...settings.background, color: event.currentTarget.value } })} /></label>
        <label className="grid gap-1 text-sm font-semibold text-slate-700">內文字型<input disabled={disabled} className={panelControl} value={settings.typography.bodyFont} onChange={(event) => update({ typography: { ...settings.typography, bodyFont: event.currentTarget.value } })} /></label>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">追蹤設定：{settings.tracking.reason}<br />推薦夥伴：{settings.affiliate.reason}</div>
      </section>
    </div>
  </div>;
}

function PopupCard({ document, popup, disabled, editing, onReplace, onEdit, onPreview, onDeleted }: { document: PageDocument; popup: PageDocument["popups"][number]; disabled: boolean; editing: boolean; onReplace: (document: PageDocument | null) => void; onEdit: () => void; onPreview: () => void; onDeleted: () => void }) {
  const auto = validatePopupTrigger(popup, "automatic_delay");
  const exit = validatePopupTrigger(popup, "exit_intent");
  const set = (patch: Parameters<typeof updateFunnelPopup>[2]) => onReplace(updateFunnelPopup(document, popup.id, patch));
  return <article className={`grid gap-2 rounded-xl border bg-white p-3 ${editing ? "border-violet-400 ring-2 ring-violet-100" : "border-slate-200"}`}>
    <label className="grid gap-1 text-xs font-semibold text-slate-600">名稱<input disabled={disabled} className={panelControl} value={popup.name} onChange={(event) => set({ name: event.currentTarget.value })} /></label>
    <label className="flex items-center gap-2 text-xs"><input disabled={disabled} type="checkbox" checked={popup.settings.openAutomatically} onChange={(event) => set({ settings: { openAutomatically: event.currentTarget.checked } })} />自動開啟</label>
    <label className="flex items-center gap-2 text-xs"><input disabled={disabled} type="checkbox" checked={popup.settings.showCloseButton} onChange={(event) => set({ settings: { showCloseButton: event.currentTarget.checked } })} />顯示關閉按鈕</label>
    <label className="flex items-center gap-2 text-xs"><input disabled={disabled} type="checkbox" checked={popup.settings.openOnExitIntent} onChange={(event) => set({ settings: { openOnExitIntent: event.currentTarget.checked } })} />離開頁面時顯示（桌機單次觸發；手機不支援）</label>
    <label className="grid gap-1 text-xs">顯示延遲（秒）<input disabled={disabled} className={panelControl} type="number" min="0" value={popup.settings.automaticDelaySeconds} onChange={(event) => set({ settings: { automaticDelaySeconds: Number(event.currentTarget.value) } })} /></label>
    <label className="grid gap-1 text-xs">背景色<input disabled={disabled} className={panelControl} value={popup.settings.backgroundColor} onChange={(event) => set({ settings: { backgroundColor: event.currentTarget.value } })} /></label>
    <label className="grid gap-1 text-xs">內距<input disabled={disabled} type="number" min="0" className={panelControl} value={popup.settings.padding} onChange={(event) => set({ settings: { padding: Number(event.currentTarget.value) } })} /></label>
    <div className="grid grid-cols-2 gap-2">
      <label className="grid gap-1 text-xs">邊框<input disabled={disabled} type="number" min="0" className={panelControl} value={popup.settings.borderWidth} onChange={(event) => set({ settings: { borderWidth: Number(event.currentTarget.value) } })} /></label>
      <label className="grid gap-1 text-xs">陰影<select disabled={disabled} className={panelControl} value={popup.settings.shadow} onChange={(event) => set({ settings: { shadow: event.currentTarget.value as typeof popup.settings.shadow } })}><option value="none">無</option><option value="soft">柔和</option><option value="medium">中等</option><option value="strong">明顯</option></select></label>
    </div>
    <label className="flex items-center gap-2 text-xs"><input disabled={disabled} type="checkbox" checked={popup.pageId === document.id} onChange={(event) => set({ pageId: event.currentTarget.checked ? document.id : undefined })} />只綁定目前頁面</label>
    <p className="text-[11px] text-slate-500">自動顯示：{auto.executable ? `${auto.delayMs}ms` : auto.reason}</p>
    <p className="text-[11px] text-amber-700">離開頁面時顯示：{exit.reason}</p>
    <p className="text-[11px] text-slate-500">寬度與圓角可進入「編輯」後選取彈出視窗區塊調整。</p>
    <div className="grid grid-cols-3 gap-2">
      <button type="button" className={smallButton} onClick={onEdit}>{editing ? "編輯中" : "編輯"}</button>
      <button type="button" className={smallButton} onClick={onPreview}>預覽</button>
      <button type="button" disabled={disabled} className={`${smallButton} text-red-700`} onClick={() => { onDeleted(); onReplace(deleteFunnelPopup(document, popup.id)); }}>刪除</button>
    </div>
  </article>;
}

/** 彈出視窗: list, settings and entry points into popup canvas editing. */
export function PopupsPanel({ document, disabled, editingPopupId, onReplace, onEdit, onPreview, onBack }: {
  document: PageDocument; disabled: boolean; editingPopupId?: string;
  onReplace: (document: PageDocument | null) => void; onEdit: (popupId: string) => void; onPreview: (popupId: string) => void; onBack: () => void;
}) {
  return <div>
    <PanelHeader title="彈出視窗" onBack={onBack} />
    <div className="grid gap-3">
      <button type="button" disabled={disabled} className={smallButton} onClick={() => onReplace(createFunnelPopup(document, { name: `彈出視窗 ${document.popups.length + 1}` }))}>＋ 新增</button>
      {!document.popups.length ? <p className="rounded-lg border border-dashed p-4 text-sm text-slate-500">尚未建立彈出視窗。</p> : document.popups.map((popup) => <PopupCard key={popup.id} document={document} popup={popup} disabled={disabled} editing={editingPopupId === popup.id} onReplace={onReplace} onEdit={() => onEdit(popup.id)} onPreview={() => onPreview(popup.id)} onDeleted={() => { if (editingPopupId === popup.id) onEdit(""); }} />)}
    </div>
  </div>;
}
