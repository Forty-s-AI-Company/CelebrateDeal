"use client";

import { useRegistrationRetry } from "@/components/registration-retry-context";
import { FORM_SUBMISSION_VERIFICATION_MESSAGE } from "@/lib/registration-submission-client";

/** 截止頁只提供原來源綁定的結果及唯讀草稿，不提供任何送出入口。 */
export function RegistrationClosedFeedback({ formId, fields = [], destination }: {
  formId?: string;
  fields?: Array<{ key: string; label: string }>;
  destination?: string;
}) {
  const retry = useRegistrationRetry(formId ?? "");
  return <main className="mx-auto grid max-w-2xl gap-4 px-6 py-16">
    <h1 className="text-2xl font-bold">此活動已截止</h1>
    <p>目前無法再次送出報名。</p>
    {retry?.submitted ? <p role="status">{FORM_SUBMISSION_VERIFICATION_MESSAGE}</p>
      : <p role="alert">{retry?.draft ? "先前送出未完成。以下保留當時填寫的內容，僅供查看。" : "無法確認先前的送出結果，也沒有可恢復的填寫內容。若您已報名，請查看確認信。"}</p>}
    {!retry?.submitted && retry?.draft ? <div className="grid gap-3">
      {fields.filter((field) => Object.hasOwn(retry.draft!.answers, field.key)).map((field) => <label key={field.key} className="grid gap-1 text-sm">
        {field.label}<input readOnly value={retry.draft!.answers[field.key]} className="min-h-11 rounded border bg-slate-50 px-3" />
      </label>)}
    </div> : null}
    {destination ? <a href={destination} className="underline">前往活動指定頁面</a> : null}
  </main>;
}
