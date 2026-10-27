"use client";

import { useMemo, useState } from "react";
import { referenceOptions } from "./funnel-display-labels";
import { useFunnelRegistrationLinks } from "./funnel-registration-links";
import { CodeTextarea } from "./funnel-custom-code-field";
import { BOUND_LIVE_FORM_RULE, registrationFormChoices } from "@/lib/funnel-registration-action";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { FunnelImageUploadButton } from "./funnel-editor-assets";
import { parseFunnelColor } from "@/lib/funnel-typography";

import {
  createFunnelInspectorActionUpdate,
  createFunnelInspectorUpdate,
  getFunnelElementInspectorDefinition,
  getFunnelInspectorFieldValue,
  getFunnelInspectorItems,
  isSafeInspectorHref,
  type FunnelInspectorActionInput,
  type FunnelInspectorField,
  type FunnelInspectorItemField,
  type FunnelInspectorScope,
} from "@/lib/funnel-element-inspector";
import type { FunnelNode, FunnelNodeAction } from "@/lib/funnel-page-document";
import type { FunnelPageCommand } from "@/lib/funnel-page-history";
import { isSafeContentAssetUrl, isSafeContentHref, UNSAFE_CONTENT_ASSET_MESSAGE, UNSAFE_CONTENT_HREF_MESSAGE } from "@/lib/safe-url";

/** Content fields holding a URL; an unsafe value is kept for editing but flagged, and never rendered as a link. */
const URL_FIELD_RULES: Readonly<Record<string, { valid: (value: string) => boolean; message: string }>> = {
  src: { valid: isSafeContentAssetUrl, message: UNSAFE_CONTENT_ASSET_MESSAGE },
  poster: { valid: isSafeContentAssetUrl, message: UNSAFE_CONTENT_ASSET_MESSAGE },
  url: { valid: isSafeContentHref, message: UNSAFE_CONTENT_HREF_MESSAGE },
};

/** zh-TW message when a URL content field holds an unsafe value; null when empty or safe. */
export function inspectorUrlFieldError(field: FunnelInspectorField, value: unknown): string | null {
  if (field.kind === "image" && typeof value === "string" && value.trim()) return isSafeContentAssetUrl(value.trim()) ? null : UNSAFE_CONTENT_ASSET_MESSAGE;
  const rule = field.target === "props" && field.kind === "text" ? URL_FIELD_RULES[field.id] ?? (/href$/iu.test(field.id) ? URL_FIELD_RULES.url : undefined) : undefined;
  if (!rule || typeof value !== "string" || !value.trim()) return null;
  return rule.valid(value.trim()) ? null : rule.message;
}

/** zh-TW message when an open_url / download action holds an unsafe href; null otherwise. */
export function inspectorActionHrefError(action: FunnelInspectorActionInput): string | null {
  if (action.type !== "open_url" && action.type !== "download") return null;
  const href = action.href?.trim();
  return href && !isSafeInspectorHref(href) ? UNSAFE_CONTENT_HREF_MESSAGE : null;
}

type InspectorProps = {
  node: FunnelNode;
  disabled?: boolean;
  popupIds?: readonly string[];
  stepIds?: readonly string[];
  stepNames?: Readonly<Record<string, string>>;
  popupNames?: Readonly<Record<string, string>>;
  onCommand: (command: FunnelPageCommand) => void;
};

const control = "min-h-10 w-full rounded-lg border border-slate-500 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100";
const actionTypes: Array<{ value: FunnelNodeAction["type"]; label: string }> = [
  { value: "none", label: "不設定動作" },
  { value: "open_url", label: "開啟網址" },
  { value: "show_popup", label: "顯示彈出視窗" },
  { value: "submit_form", label: "送出表單" },
  { value: "next_step", label: "前往下一個步驟" },
  { value: "registration", label: "開啟報名表" },
  { value: "download", label: "下載檔案" },
];

function initialAction(node: FunnelNode): FunnelInspectorActionInput {
  const action = node.actions[0];
  if (!action) return { type: "none" };
  switch (action.type) {
    case "open_url": return { type: action.type, href: action.href, newTab: action.newTab };
    case "show_popup": return { type: action.type, popupId: action.popupId };
    case "submit_form": return { type: action.type, formId: action.formId };
    case "next_step": return { type: action.type, stepId: action.stepId };
    case "download": return { type: action.type, href: action.href, fileName: action.fileName };
    case "registration": return { type: action.type, registrationFormId: action.formId, useBoundLive: action.useBoundLive };
    default: return { type: "none" };
  }
}

function FieldControl({ field, node, scope, disabled, onCommand }: { field: FunnelInspectorField; node: FunnelNode; scope: FunnelInspectorScope; disabled: boolean; onCommand: (command: FunnelPageCommand) => void }) {
  const value = getFunnelInspectorFieldValue(node, scope, field);
  if (field.kind === "code") return <CodeTextarea label={field.label} value={String(value)} maxBytes={field.maxBytes ?? 0} disabled={disabled || field.disabled} description={field.description} onCommit={(next) => { const command = createFunnelInspectorUpdate(node, "base", field, next); if (command) onCommand(command); }} />;
  const commit = (next: string | boolean) => {
    const command = createFunnelInspectorUpdate(node, scope, field, next);
    if (command) onCommand(command);
  };
  const describedBy = field.description ? `funnel-field-${node.id}-${field.id}` : undefined;
  const urlError = inspectorUrlFieldError(field, value);
  const errorId = `funnel-field-${node.id}-${field.id}-error`;
  const common = { disabled: disabled || field.disabled, "aria-describedby": [describedBy, urlError ? errorId : undefined].filter(Boolean).join(" ") || undefined, "aria-invalid": urlError ? true : undefined };
  if (field.kind === "repeater") return <RepeaterField field={field} node={node} disabled={disabled || Boolean(field.disabled)} onCommand={onCommand} />;
  let input: React.ReactNode;
  if (field.kind === "color") input = <span className="flex items-center gap-2">
    <input type="color" aria-label={`${field.label}色票`} disabled={common.disabled} value={colorPickerValue(String(value))} onChange={(event) => commit(event.currentTarget.value)} className="h-10 w-11 shrink-0 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 disabled:cursor-not-allowed" />
    <input {...common} aria-label={field.label} className={control} value={String(value)} placeholder="例如 #c9a063" spellCheck={false} onChange={(event) => commit(event.currentTarget.value)} />
  </span>;
  else if (field.kind === "image") input = <span className="grid gap-2">
    <input {...common} className={control} inputMode="url" placeholder="https:// 或 /images/…" value={String(value)} spellCheck={false} onChange={(event) => commit(event.currentTarget.value)} />
    <FunnelImageUploadButton label={field.label} disabled={common.disabled} onUploaded={(url) => commit(url)} />
  </span>;
  else if (field.kind === "checkbox") input = <input {...common} className="h-4 w-4 rounded border-slate-300 text-blue-700" type="checkbox" checked={value === true} onChange={(event) => commit(event.currentTarget.checked)} />;
  else if (field.kind === "select") input = <select {...common} className={control} value={String(value)} onChange={(event) => commit(event.currentTarget.value)}><option value="">未設定</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  else if (field.kind === "textarea" || field.kind === "list" || field.kind === "menu_items" || field.kind === "faq_items") input = <textarea {...common} className={`${control} min-h-24 resize-y`} value={String(value)} onChange={(event) => commit(event.currentTarget.value)} />;
  else input = <input {...common} className={control} type={field.kind === "number" ? "number" : "text"} min={field.min} max={field.max} step={field.step} value={String(value)} onChange={(event) => commit(event.currentTarget.value)} />;
  return <label className={field.kind === "checkbox" ? "flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700" : "grid gap-1 text-sm font-semibold text-slate-700"}>
    <span>{field.label}</span>{input}{field.description ? <span id={describedBy} className="text-xs font-normal leading-5 text-slate-600">{field.description}</span> : null}
    {urlError ? <span id={errorId} role="alert" className="text-xs font-normal leading-5 text-red-700">{urlError}頁面上不會顯示這個網址。</span> : null}
  </label>;
}

/** The native colour picker needs #rrggbb; anything else shows black until a colour is chosen. */
function colorPickerValue(value: string): string {
  const rgb = value ? parseFunnelColor(value) : null;
  return rgb ? `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}` : "#000000";
}

const EMAIL_LINK = /^(mailto:)?[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/iu;

function itemUrlError(sub: FunnelInspectorItemField, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (sub.kind === "image") return isSafeContentAssetUrl(text) ? null : UNSAFE_CONTENT_ASSET_MESSAGE;
  if (sub.kind === "url") return isSafeContentHref(text) || EMAIL_LINK.test(text) ? null : UNSAFE_CONTENT_HREF_MESSAGE;
  return null;
}

function itemSummary(field: FunnelInspectorField, item: Record<string, unknown>, index: number): string {
  const text = ["name", "title", "label", "alt", "value"].map((key) => item[key]).find((value): value is string => typeof value === "string" && value.trim() !== "");
  return `${field.itemLabel ?? "項目"} ${index + 1}${text ? `：${text.trim().slice(0, 24)}` : ""}`;
}

/**
 * Editable list of structured items (testimonials, logos, stats…). Every edit
 * commits the whole list through `createFunnelInspectorUpdate`, which keeps
 * only declared keys and coerces each value to its declared kind.
 */
function RepeaterField({ field, node, disabled, onCommand }: { field: FunnelInspectorField; node: FunnelNode; disabled: boolean; onCommand: (command: FunnelPageCommand) => void }) {
  const items = getFunnelInspectorItems(node, field);
  const [open, setOpen] = useState<number | null>(items.length ? 0 : null);
  const max = field.maxItems ?? 24;
  const commit = (next: Record<string, unknown>[]) => {
    const command = createFunnelInspectorUpdate(node, "base", field, next);
    if (command) onCommand(command);
  };
  const update = (index: number, key: string, value: unknown) => commit(items.map((item, current) => current === index ? { ...item, [key]: value } : item));
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[index], next[target]] = [next[target]!, next[index]!];
    commit(next);
    setOpen(target);
  };
  const remove = (index: number) => { commit(items.filter((_, current) => current !== index)); setOpen(null); };
  const add = () => { commit([...items, { ...(field.newItem ?? {}) }]); setOpen(items.length); };
  const base = `funnel-repeater-${node.id}-${field.id}`;
  const iconButton = "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40";
  return <fieldset className="grid gap-2" aria-describedby={field.description ? `${base}-description` : undefined}>
    <legend className="mb-1 text-sm font-semibold text-slate-700">{field.label}<span className="ml-1 font-normal text-slate-500">（{items.length}／{max}）</span></legend>
    {field.description ? <p id={`${base}-description`} className="text-xs leading-5 text-slate-600">{field.description}</p> : null}
    {items.map((item, index) => {
      const expanded = open === index;
      const summary = itemSummary(field, item, index);
      return <div key={index} className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center gap-1 pr-1">
          <button type="button" aria-expanded={expanded} aria-controls={`${base}-${index}`} onClick={() => setOpen(expanded ? null : index)} className="min-h-10 min-w-0 flex-1 cursor-pointer truncate rounded-md px-3 text-left text-sm font-semibold text-slate-800 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">{summary}</button>
          <button type="button" aria-label={`上移${summary}`} title="上移" disabled={disabled || index === 0} className={iconButton} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden /></button>
          <button type="button" aria-label={`下移${summary}`} title="下移" disabled={disabled || index === items.length - 1} className={iconButton} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden /></button>
          <button type="button" aria-label={`刪除${summary}`} title="刪除" disabled={disabled} className={`${iconButton} text-red-600 hover:bg-red-50 hover:text-red-700`} onClick={() => remove(index)}><Trash2 size={15} aria-hidden /></button>
        </div>
        <div id={`${base}-${index}`} hidden={!expanded} className="grid gap-2.5 border-t border-slate-100 p-3">
          {(field.itemFields ?? []).map((sub) => <ItemFieldControl key={sub.key} id={`${base}-${index}-${sub.key}`} sub={sub} value={item[sub.key]} disabled={disabled} onChange={(value) => update(index, sub.key, value)} />)}
        </div>
      </div>;
    })}
    <button type="button" disabled={disabled || items.length >= max} onClick={add} className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-400 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-500 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={15} aria-hidden />新增{field.itemLabel ?? "項目"}</button>
  </fieldset>;
}

function ItemFieldControl({ id, sub, value, disabled, onChange }: { id: string; sub: FunnelInspectorItemField; value: unknown; disabled: boolean; onChange: (value: unknown) => void }) {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const error = itemUrlError(sub, value);
  const common = { id, disabled, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-error` : undefined };
  const label = "grid gap-1 text-xs font-semibold text-slate-700";
  if (sub.kind === "checkbox") return <label htmlFor={id} className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input {...common} type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={value === true} onChange={(event) => onChange(event.currentTarget.checked)} />{sub.label}</label>;
  let input: React.ReactNode;
  if (sub.kind === "select") input = <select {...common} className={control} value={text} onChange={(event) => onChange(event.currentTarget.value)}><option value="">未設定</option>{sub.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  else if (sub.kind === "textarea") input = <textarea {...common} className={`${control} min-h-20 resize-y`} placeholder={sub.placeholder} value={text} onChange={(event) => onChange(event.currentTarget.value)} />;
  else if (sub.kind === "number") input = <input {...common} className={control} type="number" min={sub.min} max={sub.max} value={text} onChange={(event) => onChange(event.currentTarget.value)} />;
  else input = <input {...common} className={control} inputMode={sub.kind === "text" ? undefined : "url"} spellCheck={sub.kind === "text" ? undefined : false} placeholder={sub.placeholder ?? (sub.kind === "image" ? "https:// 或 /images/…" : undefined)} value={text} onChange={(event) => onChange(event.currentTarget.value)} />;
  return <div className="grid gap-1.5">
    <label htmlFor={id} className={label}>{sub.label}</label>
    {input}
    {sub.kind === "image" ? <FunnelImageUploadButton label={sub.label} disabled={disabled} onUploaded={(url) => onChange(url)} /> : null}
    {error ? <span id={`${id}-error`} role="alert" className="text-xs leading-5 text-red-700">{error}頁面上不會顯示這個網址。</span> : null}
  </div>;
}

// 集中目標有效性，顯示與套用防線使用相同判斷。
function actionTargetState(action: FunnelInspectorActionInput, popupIds: readonly string[], stepIds: readonly string[] | undefined, formIds: readonly string[]) {
  const missingPopup = Boolean(action.popupId && !popupIds.includes(action.popupId));
  const missingStep = Boolean(action.stepId && stepIds && !stepIds.includes(action.stepId));
  const missingForm = Boolean(action.registrationFormId && !formIds.includes(action.registrationFormId));
  const invalidTarget = action.type === "show_popup" ? !action.popupId || missingPopup
    : action.type === "next_step" ? !action.stepId || missingStep
      : action.type === "registration" ? !action.registrationFormId || missingForm : false;
  return { missingPopup, missingStep, missingForm, invalidTarget };
}

/**
 * 報名表只列出目前專案中啟用的表單（由伺服器提供）；頁面已綁定活動場次時只列出該場次的報名表。
 * 實際綁定仍在儲存時由伺服器驗證。
 */
function RegistrationActionFields({ action, choices, missingForm, disabled, onForm, onUseBoundLive }: { action: FunnelInspectorActionInput; choices: ReturnType<typeof registrationFormChoices>; missingForm: boolean; disabled: boolean; onForm: (id: string) => void; onUseBoundLive: (value: boolean) => void }) {
  const { forms, live } = useFunnelRegistrationLinks();
  const conflict = Boolean(live && action.registrationFormId && forms.some((form) => form.id === action.registrationFormId) && missingForm);
  const missingLabel = conflict ? "這份報名表不是頁面綁定場次的報名表，請重新選擇" : "原報名表已停用或不屬於此專案，請重新選擇";
  const empty = live ? "頁面綁定的活動場次沒有可用的報名表。請在頁面設定改選場次，或先為該場次設定報名表。" : "目前專案沒有啟用中的報名表，請先到報名管理建立表單。";
  return <>
    {live ? <p role="note" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">{BOUND_LIVE_FORM_RULE}{live.title ? `（目前場次：${live.title}）` : ""}</p> : null}
    <label className="grid gap-1 text-sm font-semibold text-slate-700">選擇報名表<select className={control} disabled={disabled || !choices.length} value={action.registrationFormId ?? ""} onChange={(event) => onForm(event.currentTarget.value)}><option value="">請選擇</option>{missingForm ? <option value={action.registrationFormId} disabled>{missingLabel}</option> : null}{choices.map((form) => <option key={form.id} value={form.id}>{form.name ?? form.id}</option>)}</select>{!choices.length ? <span className="text-xs font-normal text-amber-700">{empty}</span> : null}</label>
    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={action.useBoundLive !== false} disabled={disabled} onChange={(event) => onUseBoundLive(event.currentTarget.checked)} />報名連結帶入頁面綁定的活動場次</label>
  </>;
}

function ActionFields({ node, popupIds, stepIds, stepNames, popupNames, disabled, onCommand }: { node: FunnelNode; popupIds: readonly string[]; stepIds?: readonly string[]; stepNames?: Readonly<Record<string, string>>; popupNames?: Readonly<Record<string, string>>; disabled: boolean; onCommand: (command: FunnelPageCommand) => void }) {
  const [action, setAction] = useState<FunnelInspectorActionInput>(() => initialAction(node));
  const set = <Key extends keyof FunnelInspectorActionInput>(key: Key, value: FunnelInspectorActionInput[Key]) => setAction((current) => ({ ...current, [key]: value }));
  const links = useFunnelRegistrationLinks();
  const choices = useMemo(() => registrationFormChoices(links), [links]);
  const formIds = useMemo(() => choices.map((form) => form.id), [choices]);
  const { missingPopup, missingStep, missingForm, invalidTarget } = actionTargetState(action, popupIds, stepIds, formIds);
  const hrefError = inspectorActionHrefError(action);
  const hrefErrorId = `funnel-action-href-${node.id}-error`;
  const apply = () => {
    if (disabled || invalidTarget || hrefError) return;
    const command = createFunnelInspectorActionUpdate(node, action);
    if (command) onCommand(command);
  };
  const needsHref = action.type === "open_url" || action.type === "download";
  return <div className="grid gap-3">
    <label className="grid gap-1 text-sm font-semibold text-slate-700">點擊後動作
      <select className={control} disabled={disabled} value={action.type} onChange={(event) => set("type", event.currentTarget.value as FunnelNodeAction["type"])}>{actionTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
    </label>
    {needsHref ? <label className="grid gap-1 text-sm font-semibold text-slate-700">網址<input className={control} disabled={disabled} value={action.href ?? ""} placeholder="https:// 或 /path 或 #anchor" aria-invalid={hrefError ? true : undefined} aria-describedby={hrefError ? hrefErrorId : undefined} onChange={(event) => set("href", event.currentTarget.value)} />{hrefError ? <span id={hrefErrorId} role="alert" className="text-xs font-normal leading-5 text-red-700">{hrefError}</span> : null}</label> : null}
    {action.type === "open_url" ? <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={action.newTab === true} disabled={disabled} onChange={(event) => set("newTab", event.currentTarget.checked)} />另開分頁</label> : null}
    {action.type === "download" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">檔案名稱（選填）<input className={control} disabled={disabled} value={action.fileName ?? ""} onChange={(event) => set("fileName", event.currentTarget.value)} /></label> : null}
    {action.type === "show_popup" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">選擇彈出視窗<select className={control} disabled={disabled || !popupIds.length} value={action.popupId ?? ""} onChange={(event) => set("popupId", event.currentTarget.value)}><option value="">請選擇</option>{missingPopup ? <option value={action.popupId} disabled>原彈出視窗已不存在，請重新選擇</option> : null}{referenceOptions(popupIds, popupNames, "彈出視窗").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{!popupIds.length ? <span className="text-xs font-normal text-amber-700">請先在彈出視窗建立一個視窗。</span> : null}</label> : null}
    {action.type === "submit_form" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">表單編號（選填）<input className={control} disabled={disabled} value={action.formId ?? ""} onChange={(event) => set("formId", event.currentTarget.value)} /></label> : null}
    {action.type === "next_step" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">下一個步驟{stepIds ? <select className={control} disabled={disabled || !stepIds.length} value={action.stepId ?? ""} onChange={(event) => set("stepId", event.currentTarget.value)}><option value="">請選擇</option>{missingStep ? <option value={action.stepId} disabled>原步驟已不存在，請重新選擇</option> : null}{referenceOptions(stepIds, stepNames, "步驟").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select> : <input className={control} disabled={disabled} value={action.stepId ?? ""} onChange={(event) => set("stepId", event.currentTarget.value)} />}</label> : null}
    {action.type === "registration" ? <RegistrationActionFields action={action} choices={choices} missingForm={missingForm} disabled={disabled} onForm={(id) => set("registrationFormId", id)} onUseBoundLive={(value) => set("useBoundLive", value)} /> : null}
    {action.type === "next_step" && stepIds?.length === 0 ? <p role="status" className="text-xs text-amber-800">目前沒有可選步驟，請先建立步驟。</p> : null}
    {invalidTarget ? <p role="status" className="text-xs text-amber-800">請選擇有效的目標後再套用動作。</p> : null}
    <button type="button" disabled={disabled || invalidTarget || Boolean(hrefError)} className="min-h-10 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={apply}>套用動作</button>
    <p className="text-xs leading-5 text-slate-600">網址只接受 HTTPS、同源路徑或頁面錨點；不會在編輯器內執行自訂程式碼。</p>
  </div>;
}

type InspectorSectionKey = "content" | "typography" | "color" | "size" | "actions" | "advanced";
const sectionLabels: Record<InspectorSectionKey, string> = { content: "內容", typography: "字型", color: "顏色", size: "尺寸與位置", actions: "動作", advanced: "進階" };
const typographyFieldIds = new Set(["fontSize", "lineHeight", "textAlign", "fontFamily", "fontWeight", "letterSpacing"]);

/** Presentation-only grouping (systeme.io: Typography / Color / Size and position / Advanced).
 * The field schema and its validation stay in `@/lib/funnel-element-inspector`. */
export function inspectorSectionFor(field: FunnelInspectorField): InspectorSectionKey {
  if (field.group === "content") return "content";
  if (field.group === "actions") return "actions";
  if (field.group === "advanced" || field.target === "visible") return "advanced";
  if (typographyFieldIds.has(field.id)) return "typography";
  if (/colou?r/iu.test(field.id)) return "color";
  return "size";
}

function InspectorSection({ id, label, defaultOpen, children }: { id: string; label: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return <div className="border-t border-slate-200 pt-3">
    <h3><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)} className="flex min-h-9 w-full cursor-pointer items-center justify-between rounded-md text-left text-sm font-bold text-slate-900 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
      <span>{label}</span><span aria-hidden className={`text-xs text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
    </button></h3>
    <div id={id} hidden={!open} className="mt-3 grid gap-3">{children}</div>
  </div>;
}

/** Shared inspector UI for every node in a structured Funnel document. */
export function FunnelElementInspector({ node, disabled = false, popupIds = [], stepIds, stepNames, popupNames, onCommand }: InspectorProps) {
  const [scope, setScope] = useState<FunnelInspectorScope>("base");
  const definition = getFunnelElementInspectorDefinition(node.type);
  const sections = useMemo(() => {
    const grouped = new Map<InspectorSectionKey, FunnelInspectorField[]>();
    for (const field of definition.fields) {
      const key = inspectorSectionFor(field);
      grouped.set(key, [...(grouped.get(key) ?? []), field]);
    }
    return (Object.keys(sectionLabels) as InspectorSectionKey[]).filter((key) => key === "actions" || grouped.get(key)?.length).map((key) => ({ key, fields: grouped.get(key) ?? [] }));
  }, [definition.fields]);
  const responsive = definition.fields.some((field) => field.responsive);
  return <section data-funnel-element-inspector data-node-type={node.type} className="grid gap-3">
    {definition.capabilityNote ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">{definition.capabilityNote}</p> : null}
    {responsive ? <label className="grid gap-1 text-sm font-semibold text-slate-700">編輯範圍<select className={control} value={scope} onChange={(event) => setScope(event.currentTarget.value as FunnelInspectorScope)}><option value="base">基礎值</option><option value="desktop">僅桌機覆寫</option><option value="mobile">僅手機覆寫</option></select><span className="text-xs font-normal leading-5 text-slate-600">覆寫會建立在同一份頁面資料上，未覆寫時會沿用基礎值。</span></label> : null}
    {sections.map(({ key, fields }) => <InspectorSection key={key} id={`funnel-inspector-${node.id}-${key}`} label={sectionLabels[key]} defaultOpen={key !== "actions" && key !== "advanced"}>
      {key === "actions"
        ? <ActionFields stepNames={stepNames} popupNames={popupNames} stepIds={stepIds} key={`${node.id}:${JSON.stringify(node.actions ?? [])}`} node={node} popupIds={popupIds} disabled={disabled} onCommand={onCommand} />
        : fields.map((field) => <FieldControl key={field.id} field={field} node={node} scope={scope} disabled={disabled || Boolean(definition.capabilityNote && field.target === "props")} onCommand={onCommand} />)}
    </InspectorSection>)}
  </section>;
}
