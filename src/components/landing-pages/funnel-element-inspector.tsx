"use client";

import { useMemo, useState } from "react";

import {
  createFunnelInspectorActionUpdate,
  createFunnelInspectorUpdate,
  getFunnelElementInspectorDefinition,
  getFunnelInspectorFieldValue,
  type FunnelInspectorActionInput,
  type FunnelInspectorField,
  type FunnelInspectorGroup,
  type FunnelInspectorScope,
} from "@/lib/funnel-element-inspector";
import type { FunnelNode, FunnelNodeAction } from "@/lib/funnel-page-document";
import type { FunnelPageCommand } from "@/lib/funnel-page-history";

type InspectorProps = {
  node: FunnelNode;
  disabled?: boolean;
  popupIds?: readonly string[];
  onCommand: (command: FunnelPageCommand) => void;
};

const control = "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100";
const actionTypes: Array<{ value: FunnelNodeAction["type"]; label: string }> = [
  { value: "none", label: "不設定動作" },
  { value: "open_url", label: "開啟網址" },
  { value: "show_popup", label: "顯示 Popup" },
  { value: "submit_form", label: "送出表單" },
  { value: "next_step", label: "前往下一個步驟" },
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
    default: return { type: "none" };
  }
}

function FieldControl({ field, node, scope, disabled, onCommand }: { field: FunnelInspectorField; node: FunnelNode; scope: FunnelInspectorScope; disabled: boolean; onCommand: (command: FunnelPageCommand) => void }) {
  const value = getFunnelInspectorFieldValue(node, scope, field);
  const commit = (next: string | boolean) => {
    const command = createFunnelInspectorUpdate(node, scope, field, next);
    if (command) onCommand(command);
  };
  const describedBy = field.description ? `funnel-field-${node.id}-${field.id}` : undefined;
  const common = { disabled: disabled || field.disabled, "aria-describedby": describedBy };
  let input: React.ReactNode;
  if (field.kind === "checkbox") input = <input {...common} className="h-4 w-4 rounded border-slate-300 text-blue-700" type="checkbox" checked={value === true} onChange={(event) => commit(event.currentTarget.checked)} />;
  else if (field.kind === "select") input = <select {...common} className={control} value={String(value)} onChange={(event) => commit(event.currentTarget.value)}><option value="">未設定</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  else if (field.kind === "textarea" || field.kind === "list" || field.kind === "menu_items" || field.kind === "faq_items") input = <textarea {...common} className={`${control} min-h-24 resize-y`} value={String(value)} onChange={(event) => commit(event.currentTarget.value)} />;
  else input = <input {...common} className={control} type={field.kind === "number" ? "number" : "text"} min={field.min} max={field.max} step={field.step} value={String(value)} onChange={(event) => commit(event.currentTarget.value)} />;
  return <label className={field.kind === "checkbox" ? "flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-700" : "grid gap-1 text-sm font-semibold text-slate-700"}>
    <span>{field.label}</span>{input}{field.description ? <span id={describedBy} className="text-xs font-normal leading-5 text-slate-500">{field.description}</span> : null}
  </label>;
}

function ActionFields({ node, popupIds, disabled, onCommand }: { node: FunnelNode; popupIds: readonly string[]; disabled: boolean; onCommand: (command: FunnelPageCommand) => void }) {
  const [action, setAction] = useState<FunnelInspectorActionInput>(() => initialAction(node));
  const set = <Key extends keyof FunnelInspectorActionInput>(key: Key, value: FunnelInspectorActionInput[Key]) => setAction((current) => ({ ...current, [key]: value }));
  const apply = () => {
    const command = createFunnelInspectorActionUpdate(node, action);
    if (command) onCommand(command);
  };
  const needsHref = action.type === "open_url" || action.type === "download";
  return <div className="grid gap-3">
    <label className="grid gap-1 text-sm font-semibold text-slate-700">點擊後動作
      <select className={control} disabled={disabled} value={action.type} onChange={(event) => set("type", event.currentTarget.value as FunnelNodeAction["type"])}>{actionTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
    </label>
    {needsHref ? <label className="grid gap-1 text-sm font-semibold text-slate-700">網址<input className={control} disabled={disabled} value={action.href ?? ""} placeholder="https:// 或 /path 或 #anchor" onChange={(event) => set("href", event.currentTarget.value)} /></label> : null}
    {action.type === "open_url" ? <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={action.newTab === true} disabled={disabled} onChange={(event) => set("newTab", event.currentTarget.checked)} />另開分頁</label> : null}
    {action.type === "download" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">檔案名稱（選填）<input className={control} disabled={disabled} value={action.fileName ?? ""} onChange={(event) => set("fileName", event.currentTarget.value)} /></label> : null}
    {action.type === "show_popup" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">選擇 Popup<select className={control} disabled={disabled || !popupIds.length} value={action.popupId ?? ""} onChange={(event) => set("popupId", event.currentTarget.value)}><option value="">請選擇</option>{popupIds.map((id) => <option key={id} value={id}>{id}</option>)}</select>{!popupIds.length ? <span className="text-xs font-normal text-amber-700">請先在 Popups 建立一個視窗。</span> : null}</label> : null}
    {action.type === "submit_form" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">表單 ID（選填）<input className={control} disabled={disabled} value={action.formId ?? ""} onChange={(event) => set("formId", event.currentTarget.value)} /></label> : null}
    {action.type === "next_step" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">下一個步驟 ID<input className={control} disabled={disabled} value={action.stepId ?? ""} onChange={(event) => set("stepId", event.currentTarget.value)} /></label> : null}
    <button type="button" disabled={disabled} className="min-h-10 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={apply}>套用動作</button>
    <p className="text-xs leading-5 text-slate-500">網址只接受 HTTPS、同源路徑或頁面錨點；不會在編輯器內執行自訂程式碼。</p>
  </div>;
}

/** Shared inspector UI for every node in a structured Funnel document. */
export function FunnelElementInspector({ node, disabled = false, popupIds = [], onCommand }: InspectorProps) {
  const [group, setGroup] = useState<FunnelInspectorGroup>("content");
  const [scope, setScope] = useState<FunnelInspectorScope>("base");
  const definition = getFunnelElementInspectorDefinition(node.type);
  const fields = useMemo(() => definition.fields.filter((field) => field.group === group), [definition.fields, group]);
  const groups: FunnelInspectorGroup[] = ["content", "design", "actions", "advanced"];
  return <section data-funnel-element-inspector data-node-type={node.type} className="grid gap-4">
    <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="元件設定分類">{groups.map((item) => <button key={item} type="button" role="tab" aria-selected={group === item} className={`min-h-9 rounded-lg border px-2 text-sm font-semibold ${group === item ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700"}`} onClick={() => setGroup(item)}>{({ content: "內容", design: "設計", actions: "動作", advanced: "進階" })[item]}</button>)}</div>
    {definition.capabilityNote ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">{definition.capabilityNote}</p> : null}
    {group === "design" || group === "content" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">編輯範圍<select className={control} value={scope} onChange={(event) => setScope(event.currentTarget.value as FunnelInspectorScope)}><option value="base">基礎值</option><option value="desktop">僅桌機覆寫</option><option value="mobile">僅手機覆寫</option></select><span className="text-xs font-normal leading-5 text-slate-500">覆寫會建立在同一份頁面資料上，未覆寫時會沿用基礎值。</span></label> : null}
    {group === "actions" ? <ActionFields key={node.id} node={node} popupIds={popupIds} disabled={disabled} onCommand={onCommand} /> : fields.length ? <div className="grid gap-3">{fields.map((field) => <FieldControl key={field.id} field={field} node={node} scope={scope} disabled={disabled || Boolean(definition.capabilityNote && field.target === "props")} onCommand={onCommand} />)}</div> : <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">這個分類沒有可調整的設定。</p>}
  </section>;
}
