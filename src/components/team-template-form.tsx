"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, LockKeyhole, Sparkles } from "lucide-react";
import { Card } from "@/components/ui";

const locks = [
  ["HEADLINE", "主標題"],
  ["SUBHEADLINE", "副標題"],
  ["BODY", "內容說明"],
  ["CTA_LABEL", "CTA 按鈕文字"],
  ["CTA_URL", "CTA 連結"],
  ["PRODUCT_SLOTS", "商品槽"],
] as const;
const dynamicFields = ["partner.name", "partner.displayName", "partner.phone", "partner.email", "webinar.title", "webinar.startAt", "webinar.hostName", "webinar.registrationUrl"];
const productSlots = [
  ["main_product", "主打商品"],
  ["bundle_product", "組合商品"],
  ["join_member", "加入會員"],
  ["consultation", "諮詢預約"],
] as const;

type TemplateActionState = { status: "idle" | "success" | "error"; message: string };
type TemplateAction = (state: TemplateActionState, formData: FormData) => Promise<TemplateActionState>;
const initialActionState: TemplateActionState = { status: "idle", message: "" };

export type TeamTemplateFormData = {
  id?: string;
  name?: string;
  teamId: string;
  slug?: string;
  headline?: string;
  subheadline?: string | null;
  body?: string | null;
  ctaLabel?: string;
  ctaUrl?: string | null;
  webinarId?: string | null;
  sourcePageId?: string;
  lockedFields?: string[];
  productSlots?: Record<string, { productId: string; offerLabel: string | null }>;
};

export type TeamTemplateFormOption = { id: string; name: string };
export type TeamTemplateWebinarOption = { id: string; title: string; scheduledAt: string };

export function TeamTemplateForm({
  template,
  teams,
  products,
  webinars,
  csrfToken,
  action,
}: {
  template?: TeamTemplateFormData;
  teams: TeamTemplateFormOption[];
  products: TeamTemplateFormOption[];
  webinars: TeamTemplateWebinarOption[];
  csrfToken: string;
  action: TemplateAction;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [activeField, setActiveField] = useState<"headline" | "subheadline" | "body" | "ctaLabel" | "ctaUrl">("body");
  const isPublishing = Boolean(template?.id);

  function insertDynamicField(field: string) {
    const target = document.getElementById(`team-template-${activeField}`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!target) return;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    target.value = `${target.value.slice(0, start)}{{${field}}}${target.value.slice(end)}`;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.focus();
  }

  return (
    <Card>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (isPublishing && !window.confirm("確定要發布新的不可變版本？既有夥伴副本不會被覆寫。")) event.preventDefault();
        }}
        className="grid gap-6"
      >
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="operation" value={isPublishing ? "publish" : "create"} />
        {template?.id ? <input type="hidden" name="templateId" value={template.id} /> : null}
        {template?.sourcePageId ? <input type="hidden" name="sourcePageId" value={template.sourcePageId} /> : null}

        {state.status !== "idle" ? <p role="status" className={state.status === "success" ? "rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" : "rounded-md bg-red-50 p-3 text-sm text-red-800"}>{state.message}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">團隊
            <select name="teamId" defaultValue={template?.teamId ?? teams[0]?.id} required className="h-10 rounded-md border border-border bg-white px-3 text-sm">
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          {!isPublishing ? <label className="grid gap-1.5 text-sm font-medium text-slate-700">模板名稱
            <input name="name" required defaultValue={template?.name} className="h-10 rounded-md border border-border px-3 text-sm" placeholder="例如：夏季 webinar 導流頁" />
          </label> : <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800"><CheckCircle2 size={16} className="mr-1 inline" />發布會建立下一個不可變版本。</div>}
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">原始頁網址（slug）
            <input name="slug" required defaultValue={template?.slug} className="h-10 rounded-md border border-border px-3 text-sm" placeholder="summer-webinar" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">綁定 webinar
            <select name="webinarId" defaultValue={template?.webinarId ?? ""} className="h-10 rounded-md border border-border bg-white px-3 text-sm">
              <option value="">暫不綁定</option>
              {webinars.map((webinar) => <option key={webinar.id} value={webinar.id}>{webinar.title} · {webinar.scheduledAt}</option>)}
            </select>
            <span className="text-xs font-normal text-slate-500">可用 {"{{webinar.title}}"} 等動態欄位；發佈時會驗證並綁定此團隊的 webinar。</span>
          </label>
        </div>

        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">主標題
            <input id="team-template-headline" name="headline" required defaultValue={template?.headline} onFocus={() => setActiveField("headline")} className="h-10 rounded-md border border-border px-3 text-sm" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">副標題
            <input id="team-template-subheadline" name="subheadline" defaultValue={template?.subheadline ?? ""} onFocus={() => setActiveField("subheadline")} className="h-10 rounded-md border border-border px-3 text-sm" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">內容說明
            <textarea id="team-template-body" name="body" rows={7} defaultValue={template?.body ?? ""} onFocus={() => setActiveField("body")} className="rounded-md border border-border px-3 py-2 text-sm" />
          </label>
          <div className="rounded-lg border border-violet-100 bg-violet-50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-violet-900"><Sparkles size={16} />動態欄位</p>
            <p className="mt-1 text-xs text-violet-700">選擇後會插入目前焦點欄位；公開頁僅解析允許的欄位。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {dynamicFields.map((field) => <button key={field} type="button" onClick={() => insertDynamicField(field)} className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs font-semibold text-violet-800">{`{{${field}}}`}</button>)}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">CTA 按鈕文字
              <input id="team-template-ctaLabel" name="ctaLabel" required defaultValue={template?.ctaLabel} onFocus={() => setActiveField("ctaLabel")} className="h-10 rounded-md border border-border px-3 text-sm" />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">CTA 連結
              <input id="team-template-ctaUrl" name="ctaUrl" type="url" defaultValue={template?.ctaUrl ?? ""} onFocus={() => setActiveField("ctaUrl")} className="h-10 rounded-md border border-border px-3 text-sm" placeholder="https://..." />
            </label>
          </div>
        </div>

        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900"><LockKeyhole size={15} className="mr-1 inline" />鎖定區塊</legend>
          <p className="mb-3 text-xs text-slate-500">鎖定後，夥伴複製模板時不能修改該內容。</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {locks.map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded border border-slate-100 p-2 text-sm text-slate-700"><input name="lockedFields" type="checkbox" value={value} defaultChecked={template?.lockedFields?.includes(value)} className="h-4 w-4 accent-blue-600" />{label}</label>)}
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">商品槽選擇</legend>
          <p className="mb-3 text-xs text-slate-500">每個槽位只會建立一個預設商品；已鎖定商品槽時，夥伴無法覆寫。</p>
          <div className="grid gap-4 md:grid-cols-2">
            {productSlots.map(([key, label]) => {
              const selected = template?.productSlots?.[key];
              return <div key={key} className="grid gap-2 rounded-md border border-slate-100 p-3">
                <label className="grid gap-1 text-sm font-medium text-slate-700">{label}
                  <select name={`product_${key}`} defaultValue={selected?.productId ?? ""} className="h-10 rounded-md border border-border bg-white px-3 text-sm"><option value="">不設定</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
                </label>
                <input name={`offerLabel_${key}`} defaultValue={selected?.offerLabel ?? ""} className="h-9 rounded-md border border-border px-3 text-sm" placeholder="商品顯示名稱（選填）" />
              </div>;
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">需要權限或資料驗證時，系統不會揭露其他團隊資料。</p>
          <button disabled={pending || teams.length === 0} className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? "儲存中…" : isPublishing ? "發布新版本" : "建立原始頁"}</button>
        </div>
      </form>
    </Card>
  );
}
