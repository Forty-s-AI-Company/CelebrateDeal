"use client";

import { useState, type ReactNode } from "react";
import { FUNNEL_FONT_OPTIONS, funnelContrastRatio, isCuratedFunnelFont, parseFunnelColor, resolveFunnelFontStack } from "@/lib/funnel-typography";
import { ArrowDown, ArrowUp, ChevronLeft, Copy, Monitor, Smartphone, Trash2 } from "lucide-react";
import { funnelDeviceVisibilityCommand, funnelNodeVisibility, type FunnelDevice } from "@/lib/funnel-node-visibility";
import { FunnelElementInspector } from "./funnel-element-inspector";
import { FunnelCommerceSettings } from "./funnel-commerce-settings";
import { funnelNodeLabel } from "./funnel-editor-library";
import type { FunnelCommerceProduct } from "@/lib/funnel-commerce";
import type { FunnelNode, PageDocument } from "@/lib/funnel-page-document";
import type { FunnelPageCommand } from "@/lib/funnel-page-history";
import { createFunnelPopup, deleteFunnelPopup, updateFunnelPopup, validatePopupTrigger } from "@/lib/funnel-popup";
import { isSafeContentAssetUrl } from "@/lib/safe-url";

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

const fieldLabel = "grid gap-1 text-sm font-semibold text-slate-700";
const SAFE_COLOR_INPUT = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|white|black)$/iu;

/** Accepts the persisted model's safe colours; the native picker needs #rrggbb. */
function pickerValue(value: string | undefined): string {
  const rgb = value ? parseFunnelColor(value) : null;
  return rgb ? `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}` : "#000000";
}

/** Keeps a local draft so half-typed values never reach the history; commits only valid values. */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  if (source !== value) { setSource(value); setDraft(value); }
  return [draft, setDraft] as const;
}

function ColorField({ id, label, value, disabled, placeholder, onCommit, onClear }: { id: string; label: string; value: string | undefined; disabled: boolean; placeholder?: string; onCommit: (value: string) => void; onClear?: () => void }) {
  const [draft, setDraft] = useDraft(value ?? "");
  const invalid = draft.trim() !== "" && !SAFE_COLOR_INPUT.test(draft.trim());
  const commit = (next: string) => {
    setDraft(next);
    if (SAFE_COLOR_INPUT.test(next.trim())) onCommit(next.trim().toLowerCase());
    else if (!next.trim() && onClear) onClear();
  };
  return <div className="grid gap-1">
    <label htmlFor={id} className="text-sm font-semibold text-slate-700">{label}</label>
    <div className="flex items-center gap-2">
      <input type="color" aria-label={`${label}色票`} disabled={disabled} value={pickerValue(value ?? placeholder)} onChange={(event) => commit(event.currentTarget.value)} className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 disabled:cursor-not-allowed" />
      <input id={id} disabled={disabled} className={panelControl} value={draft} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined} spellCheck={false} onChange={(event) => commit(event.currentTarget.value)} />
    </div>
    {invalid ? <span id={`${id}-error`} className="text-xs font-normal text-red-700">請輸入色碼，例如 #1d4ed8。</span> : null}
  </div>;
}

/** Page background / social image: no CSS-breaking characters, then the shared asset rule (`@/lib/safe-url`). */
function isSafePageUrl(value: string) {
  if (/[\u0000- "'()\\<>]/u.test(value)) return false;
  return isSafeContentAssetUrl(value);
}

function UrlField({ id, label, value, disabled, hint, onCommit }: { id: string; label: string; value: string | undefined; disabled: boolean; hint?: string; onCommit: (value: string | undefined) => void }) {
  const [draft, setDraft] = useDraft(value ?? "");
  const trimmed = draft.trim();
  const invalid = trimmed !== "" && !isSafePageUrl(trimmed);
  return <label className={fieldLabel}>{label}
    <input disabled={disabled} className={panelControl} inputMode="url" placeholder="https:// 或 /images/…" value={draft} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`} spellCheck={false}
      onChange={(event) => { const next = event.currentTarget.value; setDraft(next); const clean = next.trim(); if (!clean) onCommit(undefined); else if (isSafePageUrl(clean)) onCommit(clean); }} />
    <span id={`${id}-hint`} className={`text-xs font-normal ${invalid ? "text-red-700" : "text-slate-600"}`}>{invalid ? "只接受 HTTPS 網址或本站路徑（以單一 / 開頭，不可接 / 或 \\），且不可含空白、引號或括號。" : hint}</span>
  </label>;
}

/** Text that is committed on blur / Enter, so one edit becomes one undo step. */
function DraftTextField({ label, value, disabled, multiline = false, maxLength, onCommit }: { label: string; value: string | undefined; disabled: boolean; multiline?: boolean; maxLength: number; onCommit: (value: string | undefined) => void }) {
  const [draft, setDraft] = useDraft(value ?? "");
  const commit = () => { const clean = draft.trim(); if (clean !== (value ?? "")) onCommit(clean || undefined); };
  const common = { disabled, maxLength, value: draft, onBlur: commit };
  return <label className={fieldLabel}>{label}
    {multiline ? <textarea {...common} className={`${panelControl} min-h-20`} onChange={(event) => setDraft(event.currentTarget.value)} />
      : <input {...common} className={panelControl} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") commit(); }} />}
  </label>;
}

function FontSelect({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const custom = !isCuratedFunnelFont(value);
  return <label className={fieldLabel}>{label}
    <select disabled={disabled} className={panelControl} value={value} onChange={(event) => onChange(event.currentTarget.value)} style={{ fontFamily: resolveFunnelFontStack(value) }}>
      {custom ? <option value={value}>自訂：{value}</option> : null}
      {FUNNEL_FONT_OPTIONS.map((option) => <option key={option.value} value={option.value} style={{ fontFamily: option.stack }}>{option.label}</option>)}
    </select>
  </label>;
}

function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section aria-labelledby={id} className="grid gap-3 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0"><h3 id={id} className="text-sm font-bold text-slate-900">{title}</h3>{children}</section>;
}

/** 頁面設定 (EDT-SET-001): workspace metadata plus this page's typography, background, language and SEO. */
export function PageSettingsPanel({ document, disabled, commerceEnabled, commerceProducts, workspaceSettings, onCommand, onReplace, onBack }: {
  document: PageDocument; disabled: boolean; commerceEnabled: boolean; commerceProducts: FunnelCommerceProduct[]; workspaceSettings?: ReactNode;
  onCommand: (command: FunnelPageCommand) => void; onReplace: (document: PageDocument) => void; onBack: () => void;
}) {
  const settings = document.settings;
  const typography = settings.typography;
  const update = (patch: Partial<PageDocument["settings"]>) => onCommand({ type: "update_settings", settings: patch });
  const setTypography = (patch: Partial<PageDocument["settings"]["typography"]>) => update({ typography: { ...typography, ...patch } });
  const setBackground = (patch: Partial<PageDocument["settings"]["background"]>) => update({ background: { ...settings.background, ...patch } });
  const setSeo = (patch: Partial<PageDocument["settings"]["seo"]>) => update({ seo: { ...settings.seo, ...patch } });
  const textContrast = funnelContrastRatio(typography.textColor, settings.background.color);
  const headingContrast = funnelContrastRatio(typography.headingColor ?? typography.textColor, settings.background.color);
  const lowContrast = [textContrast, headingContrast].some((ratio) => ratio !== null && ratio < 4.5);
  return <div data-funnel-page-settings>
    <PanelHeader title="頁面設定" onBack={onBack} />
    <div className="grid gap-5">
      {workspaceSettings ? <SettingsSection id="funnel-page-basic-settings" title="基本資料">{workspaceSettings}</SettingsSection> : null}
      <SettingsSection id="funnel-page-document-settings" title="頁面內容">
        {commerceEnabled ? <FunnelCommerceSettings binding={document.commerce} products={commerceProducts} disabled={disabled} onChange={(commerce) => onReplace({ ...document, commerce })} /> : <p className="text-xs text-slate-600">商品與結帳設定位於「訂單表單」步驟的頁面設定。</p>}
        <label className={fieldLabel}>語言<select disabled={disabled} className={panelControl} value={settings.language} onChange={(event) => update({ language: event.currentTarget.value as PageDocument["settings"]["language"] })}><option value="zh-TW">繁體中文</option><option value="en">英文</option><option value="ja">日本語</option>{["zh-TW", "en", "ja"].includes(settings.language) ? null : <option value={settings.language}>{settings.language}</option>}</select></label>
      </SettingsSection>
      <SettingsSection id="funnel-page-typography-settings" title="預設文字">
        <FontSelect label="字型" value={typography.bodyFont} disabled={disabled} onChange={(bodyFont) => setTypography({ bodyFont })} />
        <div className="grid grid-cols-2 gap-2">
          <label className={fieldLabel}>字級（px）<input type="number" min={12} max={24} step={1} disabled={disabled} className={panelControl} value={typography.bodySize} onChange={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value) && value >= 12 && value <= 24) setTypography({ bodySize: value }); }} /></label>
          <label className={fieldLabel}>行高<input type="number" min={1.2} max={2.2} step={0.05} disabled={disabled} className={panelControl} value={typography.bodyLineHeight} onChange={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value) && value >= 1.2 && value <= 2.2) setTypography({ bodyLineHeight: value }); }} /></label>
        </div>
        <input type="range" aria-label="字級滑桿" min={12} max={24} step={1} disabled={disabled} value={typography.bodySize} onChange={(event) => setTypography({ bodySize: Number(event.currentTarget.value) })} className="w-full accent-blue-700" />
        <ColorField id="funnel-settings-text-color" label="文字顏色" value={typography.textColor} disabled={disabled} onCommit={(textColor) => setTypography({ textColor })} />
        <ColorField id="funnel-settings-link-color" label="連結顏色" value={typography.linkColor} disabled={disabled} onCommit={(linkColor) => setTypography({ linkColor })} />
        <fieldset className="grid gap-1"><legend className="mb-1 text-sm font-semibold text-slate-700">對齊</legend>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">{([["left", "靠左"], ["center", "置中"], ["right", "靠右"]] as const).map(([value, label]) => <label key={value} className={`flex min-h-8 cursor-pointer items-center justify-center rounded-md text-sm font-semibold ${typography.alignment === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-600"}`}>
            <input type="radio" name="funnel-page-alignment" className="sr-only" disabled={disabled} checked={typography.alignment === value} onChange={() => setTypography({ alignment: value })} />{label}
          </label>)}</div>
        </fieldset>
      </SettingsSection>
      <SettingsSection id="funnel-page-heading-settings" title="標題文字">
        <FontSelect label="字型" value={typography.headingFont} disabled={disabled} onChange={(headingFont) => setTypography({ headingFont })} />
        <ColorField id="funnel-settings-heading-color" label="顏色" value={typography.headingColor} placeholder={typography.textColor} disabled={disabled} onCommit={(headingColor) => setTypography({ headingColor })} onClear={() => setTypography({ headingColor: undefined })} />
        <p className="text-xs leading-5 text-slate-600">留空時沿用文字顏色。標題字級依 H1–H4 層級自動縮放，手機版會自動縮小；個別元件設定的字級與顏色優先。</p>
      </SettingsSection>
      <SettingsSection id="funnel-page-background-settings" title="背景">
        <ColorField id="funnel-settings-background-color" label="背景顏色" value={settings.background.color} disabled={disabled} onCommit={(color) => setBackground({ color })} />
        <UrlField id="funnel-settings-background-image" label="背景圖片網址" value={settings.background.imageUrl} disabled={disabled} hint="選填。圖片會鋪滿整個頁面背景。" onCommit={(imageUrl) => setBackground({ imageUrl })} />
        {settings.background.imageUrl ? <label className={fieldLabel}>背景模糊（{settings.background.blur}px）<input type="range" min={0} max={20} step={1} disabled={disabled} value={Math.min(settings.background.blur, 20)} onChange={(event) => setBackground({ blur: Number(event.currentTarget.value) })} className="w-full accent-blue-700" /></label> : null}
        {lowContrast ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-5 text-amber-900">文字與背景顏色的對比偏低（建議至少 4.5:1），訪客可能不易閱讀。</p> : null}
      </SettingsSection>
      <SettingsSection id="funnel-page-seo-settings" title="搜尋引擎與分享">
        <DraftTextField label="搜尋引擎標題" value={settings.seo.title} disabled={disabled} maxLength={240} onCommit={(title) => setSeo({ title })} />
        <DraftTextField label="搜尋引擎描述" value={settings.seo.description} disabled={disabled} multiline maxLength={320} onCommit={(description) => setSeo({ description })} />
        <UrlField id="funnel-settings-social-image" label="社群分享圖片網址" value={settings.seo.socialImage} disabled={disabled} hint="分享到社群時顯示的圖片，建議 1200×630。" onCommit={(socialImage) => setSeo({ socialImage })} />
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700"><input type="checkbox" className="mt-0.5 h-4 w-4" disabled={disabled} checked={settings.seo.hideFromSearch} onChange={(event) => setSeo({ hideFromSearch: event.currentTarget.checked })} /><span>不讓搜尋引擎收錄這個頁面<span className="block text-xs font-normal text-slate-600">勾選後公開頁會加上 noindex。</span></span></label>
      </SettingsSection>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">追蹤設定：{settings.tracking.reason}<br />推薦夥伴：{settings.affiliate.reason}</div>
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
