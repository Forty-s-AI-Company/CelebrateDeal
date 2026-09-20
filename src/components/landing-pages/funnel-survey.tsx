"use client";

import { useState, type FormEvent } from "react";
import type { FunnelSubmissionContext } from "./funnel-page-document-renderer";

export function FunnelSurvey({ nodeId, question, options, multiple, required, fieldKey, submission }: { nodeId: string; question: string; options: string[]; multiple: boolean; required: boolean; fieldKey: string; submission?: FunnelSubmissionContext }) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const allowedField = submission?.form.fields.find((field) => field.key === fieldKey);
  if (!submission || !allowedField) return <div className="rounded-lg border border-dashed p-4 text-sm text-slate-600">問卷尚未綁定已授權的表單欄位，已停止收集答案。</div>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selected = data.getAll(fieldKey).map(String).filter((value) => options.includes(value));
    if ((required && selected.length === 0) || (!multiple && selected.length > 1)) { setStatus("error"); setMessage("請選擇有效答案。"); return; }
    const payload = Object.fromEntries(submission!.form.fields.map((field) => [field.key, field.key === fieldKey ? selected.join(", ") : String(data.get(field.key) ?? "")]));
    setStatus("submitting"); setMessage("");
    try {
      const response = await fetch("/api/form-submissions", { method: "POST", headers: { "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" }, body: JSON.stringify({ formId: submission!.form.id, landingPageId: submission!.landingPageId, funnelStepId: submission!.funnelStepId, liveId: submission!.liveId ?? null, payload }) });
      if (!response.ok) { setStatus("error"); setMessage(response.status === 429 ? "送出次數過多，請稍後再試。" : "答案未能保存，請檢查後再試。"); return; }
      setStatus("success"); setMessage(submission!.form.successMessage);
    } catch { setStatus("error"); setMessage("連線中斷，答案尚未保存。"); }
  }

  const identityFields = submission.form.fields.filter((field) => field.key !== fieldKey);
  return <form onSubmit={submit} className="space-y-3"><fieldset disabled={status === "submitting" || status === "success"}><legend className="font-medium">{question}{required || allowedField.required ? " *" : ""}</legend>{options.map((option, index) => <label key={`${nodeId}-option-${index}`} className="mt-2 flex items-center gap-2"><input required={(required || allowedField.required) && !multiple} type={multiple ? "checkbox" : "radio"} name={fieldKey} value={option} /><span>{option}</span></label>)}</fieldset>{identityFields.map((field) => <label key={field.key} className="block space-y-1"><span className="text-sm font-medium">{field.label}{field.required ? " *" : ""}</span><input name={field.key} type={field.type} required={field.required} disabled={status === "submitting" || status === "success"} autoComplete={field.key === "email" ? "email" : field.key === "name" ? "name" : undefined} className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>)}<button type="submit" disabled={status === "submitting" || status === "success"} className="min-h-11 rounded-lg bg-amber-500 px-4 py-2 font-semibold disabled:opacity-60">{status === "submitting" ? "送出中…" : status === "success" ? "已保存" : "提交答案"}</button>{message ? <p role={status === "error" ? "alert" : "status"}>{message}</p> : null}</form>;
}

