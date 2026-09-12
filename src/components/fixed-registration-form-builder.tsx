"use client";

import { useActionState, type ReactNode } from "react";
import { upsertFormBuilderAction, type FormBuilderActionState } from "@/app/actions/form-actions";
import { defaultRegistrationFormBuilderFields } from "@/lib/registration-form-builder";

/** New forms start with the stable registration contract; legacy forms keep their editor. */
export function FixedRegistrationFormBuilder({ csrfField }: { csrfField: ReactNode }) {
  const [state, action, pending] = useActionState(upsertFormBuilderAction, { status: "idle", message: "" } as FormBuilderActionState);
  return <form action={action} className="grid max-w-2xl gap-5 rounded-2xl border border-slate-200 bg-white p-6">
    {csrfField}
    <input type="hidden" name="fields" value={JSON.stringify(defaultRegistrationFormBuilderFields())} />
    <input type="hidden" name="isActive" value="on" />
    <input type="hidden" name="hideExpiredSessions" value="on" />
    <input type="hidden" name="maxVisibleSessions" value="0" />
    <p className="text-sm text-slate-600">固定收集姓名、Email 與選填手機。活動介紹與行銷內容請在「一頁式網站」編輯。</p>
    {[
      ["name", "內部名稱", "例如：九月 Webinar 報名", 160],
      ["slug", "表單網址名稱", "例如：september-webinar", 80],
      ["headline", "表單標題", "立即報名 Webinar", 200],
      ["submitLabel", "送出按鈕", "送出報名", 80],
      ["successMessage", "完成訊息", "已收到你的資料，開播前會再提醒你。", 500],
    ].map(([name, label, placeholder, max]) => <label key={name} className="grid gap-2 text-sm font-medium">
      {label}<input name={String(name)} required maxLength={Number(max)} placeholder={String(placeholder)} defaultValue={name === "submitLabel" || name === "successMessage" ? String(placeholder) : undefined} className="rounded-lg border border-slate-300 px-3 py-2" />
    </label>)}
    <label className="grid gap-2 text-sm font-medium">主題色<input type="color" name="themeColor" defaultValue="#2563eb" /></label>
    {state.message ? <div role="alert" className="text-sm text-red-700">{state.message}{state.fieldErrors ? <ul>{Object.values(state.fieldErrors).map((error, index) => <li key={index}>{error}</li>)}</ul> : null}</div> : null}
    <button disabled={pending} className="rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{pending ? "儲存中…" : "建立報名表"}</button>
  </form>;
}
