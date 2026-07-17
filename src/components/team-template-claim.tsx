"use client";

import { useActionState, useEffect, useState } from "react";
import { CheckCircle2, CopyPlus, FilePenLine, LockKeyhole, RectangleEllipsis } from "lucide-react";
import { Card } from "@/components/ui";
import type { PartnerPageActionState } from "@/app/actions/team-funnel-partner-actions";

export type TeamTemplateClaimData = {
  teamId: string;
  shareCode: string;
  sourceOwnerName: string;
  templateName: string;
  version: number;
  webinar: string | null;
  lockedFields: string[];
};

type ClaimAction = (state: PartnerPageActionState, formData: FormData) => Promise<PartnerPageActionState>;
const initialState: PartnerPageActionState = { status: "idle", message: "" };
const modes = [
  { value: "QUICK_APPLY", title: "快速套用", description: "帶入 A 的內容；僅編輯未鎖定欄位。", icon: CopyPlus },
  { value: "COPY_THEN_EDIT", title: "複製後編輯", description: "先建立副本，再逐項調整你可管理的內容。", icon: FilePenLine },
  { value: "BLANK_PAGE_BOUND_TO_A_WEBINAR", title: "空白頁綁定研討會", description: "從空白頁開始，保留 A 的 webinar 歸屬與報名流程。", icon: RectangleEllipsis },
] as const;

const fieldLabels: Record<string, string> = { HEADLINE: "主標題", SUBHEADLINE: "副標題", BODY: "內容說明", CTA_LABEL: "CTA 文字", CTA_URL: "CTA 連結", PRODUCT_SLOTS: "商品槽" };

export function TeamTemplateClaimError({ state }: { state: "expired" | "disabled" | "not_team" }) {
  const message = {
    expired: "此分享連結已過期，請向來源夥伴索取新的受控分享連結。",
    disabled: "此分享連結已停用，來源夥伴已停止此模板的取得權限。",
    not_team: "此分享不屬於你的團隊，為保障團隊資料無法繼續。",
  }[state];
  return <section role="status" aria-live="polite" className="rounded-lg border border-orange-200 bg-orange-50 p-5 text-center text-sm text-orange-900">{message}</section>;
}

export function TeamTemplateClaim({ template, csrfToken, action }: { template: TeamTemplateClaimData; csrfToken: string; action: ClaimAction }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [mode, setMode] = useState<(typeof modes)[number]["value"]>("QUICK_APPLY");

  useEffect(() => { if (state.redirectTo) window.location.assign(state.redirectTo); }, [state.redirectTo]);

  return (
    <Card>
      <form action={formAction} className="grid gap-6">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="teamId" value={template.teamId} />
        <input type="hidden" name="shareCode" value={template.shareCode} />
        <input type="hidden" name="mode" value={mode} />
        <section aria-labelledby="template-origin" className="rounded-lg border border-blue-100 bg-blue-50 p-4">
          <h2 id="template-origin" className="font-semibold text-slate-950">模板來源</h2>
          <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div><dt className="text-slate-500">來源 A</dt><dd>{template.sourceOwnerName}</dd></div>
            <div><dt className="text-slate-500">模板</dt><dd>{template.templateName}</dd></div>
            <div><dt className="text-slate-500">版本</dt><dd>v{template.version}</dd></div>
            <div><dt className="text-slate-500">研討會</dt><dd>{template.webinar ?? "未綁定研討會"}</dd></div>
            <div><dt className="text-slate-500">鎖定範圍</dt><dd>{template.lockedFields.length ? template.lockedFields.map((field) => fieldLabels[field] ?? field).join("、") : "無"}</dd></div>
          </dl>
          <p className="mt-3 flex gap-2 text-xs leading-5 text-blue-800"><LockKeyhole size={15} className="mt-0.5 shrink-0" />鎖定區塊由 A 的已發布版本提供，建立後不能由夥伴改寫。</p>
        </section>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-900">選擇取得方式</legend>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {modes.map(({ value, title, description, icon: Icon }) => <label key={value} className={`cursor-pointer rounded-lg border p-4 ${mode === value ? "border-blue-600 bg-blue-50" : "border-border"}`}>
              <input className="sr-only" type="radio" name="mode-option" checked={mode === value} onChange={() => setMode(value)} />
              <Icon size={18} className="text-blue-700" /><span className="mt-2 block text-sm font-semibold text-slate-900">{title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{description}</span>
            </label>)}
          </div>
        </fieldset>

        <label className="grid gap-1.5 text-sm font-medium text-slate-700">你的公開網址（slug）
          <input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="my-webinar-page" className="h-10 rounded-md border border-border px-3 text-sm" />
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input name="confirmed" value="yes" type="checkbox" required className="mt-0.5 h-4 w-4 accent-blue-600" />我已確認建立自己的夥伴頁；內容可否編輯會依 A 的鎖定範圍決定。</label>
        {state.status !== "idle" ? <p role="status" className={state.status === "success" ? "rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" : "rounded-md bg-red-50 p-3 text-sm text-red-800"}>{state.status === "success" ? <CheckCircle2 className="mr-1 inline" size={16} /> : null}{state.message}</p> : null}
        <button disabled={pending} className="inline-flex h-10 w-fit items-center rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60">{pending ? "建立中…" : "確認並建立夥伴頁"}</button>
      </form>
    </Card>
  );
}
