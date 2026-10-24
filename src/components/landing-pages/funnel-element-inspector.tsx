"use client";

import { useMemo, useState } from "react";
import { referenceOptions } from "./funnel-display-labels";
import { useFunnelRegistrationLinks } from "./funnel-registration-links";

import {
  createFunnelInspectorActionUpdate,
  createFunnelInspectorUpdate,
  getFunnelElementInspectorDefinition,
  getFunnelInspectorFieldValue,
  type FunnelInspectorActionInput,
  type FunnelInspectorField,
  type FunnelInspectorScope,
} from "@/lib/funnel-element-inspector";
import type { FunnelNode, FunnelNodeAction } from "@/lib/funnel-page-document";
import type { FunnelPageCommand } from "@/lib/funnel-page-history";

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
    <span>{field.label}</span>{input}{field.description ? <span id={describedBy} className="text-xs font-normal leading-5 text-slate-600">{field.description}</span> : null}
  </label>;
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

/** 報名表只列出目前專案中啟用的表單（由伺服器提供）；實際綁定仍在儲存時由伺服器驗證。 */
function RegistrationActionFields({ action, missingForm, disabled, onForm, onUseBoundLive }: { action: FunnelInspectorActionInput; missingForm: boolean; disabled: boolean; onForm: (id: string) => void; onUseBoundLive: (value: boolean) => void }) {
  const { forms } = useFunnelRegistrationLinks();
  return <>
    <label className="grid gap-1 text-sm font-semibold text-slate-700">選擇報名表<select className={control} disabled={disabled || !forms.length} value={action.registrationFormId ?? ""} onChange={(event) => onForm(event.currentTarget.value)}><option value="">請選擇</option>{missingForm ? <option value={action.registrationFormId} disabled>原報名表已停用或不屬於此專案，請重新選擇</option> : null}{forms.map((form) => <option key={form.id} value={form.id}>{form.name ?? form.id}</option>)}</select>{!forms.length ? <span className="text-xs font-normal text-amber-700">目前專案沒有啟用中的報名表，請先到報名管理建立表單。</span> : null}</label>
    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={action.useBoundLive !== false} disabled={disabled} onChange={(event) => onUseBoundLive(event.currentTarget.checked)} />帶入頁面綁定的活動場次（場次使用同一份報名表時）</label>
  </>;
}

function ActionFields({ node, popupIds, stepIds, stepNames, popupNames, disabled, onCommand }: { node: FunnelNode; popupIds: readonly string[]; stepIds?: readonly string[]; stepNames?: Readonly<Record<string, string>>; popupNames?: Readonly<Record<string, string>>; disabled: boolean; onCommand: (command: FunnelPageCommand) => void }) {
  const [action, setAction] = useState<FunnelInspectorActionInput>(() => initialAction(node));
  const set = <Key extends keyof FunnelInspectorActionInput>(key: Key, value: FunnelInspectorActionInput[Key]) => setAction((current) => ({ ...current, [key]: value }));
  const { forms } = useFunnelRegistrationLinks();
  const formIds = useMemo(() => forms.map((form) => form.id), [forms]);
  const { missingPopup, missingStep, missingForm, invalidTarget } = actionTargetState(action, popupIds, stepIds, formIds);
  const apply = () => {
    if (disabled || invalidTarget) return;
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
    {action.type === "show_popup" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">選擇彈出視窗<select className={control} disabled={disabled || !popupIds.length} value={action.popupId ?? ""} onChange={(event) => set("popupId", event.currentTarget.value)}><option value="">請選擇</option>{missingPopup ? <option value={action.popupId} disabled>原彈出視窗已不存在，請重新選擇</option> : null}{referenceOptions(popupIds, popupNames, "彈出視窗").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{!popupIds.length ? <span className="text-xs font-normal text-amber-700">請先在彈出視窗建立一個視窗。</span> : null}</label> : null}
    {action.type === "submit_form" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">表單編號（選填）<input className={control} disabled={disabled} value={action.formId ?? ""} onChange={(event) => set("formId", event.currentTarget.value)} /></label> : null}
    {action.type === "next_step" ? <label className="grid gap-1 text-sm font-semibold text-slate-700">下一個步驟{stepIds ? <select className={control} disabled={disabled || !stepIds.length} value={action.stepId ?? ""} onChange={(event) => set("stepId", event.currentTarget.value)}><option value="">請選擇</option>{missingStep ? <option value={action.stepId} disabled>原步驟已不存在，請重新選擇</option> : null}{referenceOptions(stepIds, stepNames, "步驟").map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select> : <input className={control} disabled={disabled} value={action.stepId ?? ""} onChange={(event) => set("stepId", event.currentTarget.value)} />}</label> : null}
    {action.type === "registration" ? <RegistrationActionFields action={action} missingForm={missingForm} disabled={disabled} onForm={(id) => set("registrationFormId", id)} onUseBoundLive={(value) => set("useBoundLive", value)} /> : null}
    {action.type === "next_step" && stepIds?.length === 0 ? <p role="status" className="text-xs text-amber-800">目前沒有可選步驟，請先建立步驟。</p> : null}
    {invalidTarget ? <p role="status" className="text-xs text-amber-800">請選擇有效的目標後再套用動作。</p> : null}
    <button type="button" disabled={disabled || invalidTarget} className="min-h-10 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={apply}>套用動作</button>
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
