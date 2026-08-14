"use client";

import type { RegistrationFormBuilderField } from "@/lib/registration-form-builder";

export function FormPreview({
  headline,
  description,
  submitLabel,
  fields,
  isActive,
}: {
  headline: string;
  description: string;
  submitLabel: string;
  fields: RegistrationFormBuilderField[];
  isActive: boolean;
}) {
  return (
    <aside aria-label="即時表單預覽" className="rounded-xl border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">即時預覽</p>
          <h2 className="mt-1 font-semibold text-slate-900">填寫者看到的內容</h2>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
          {isActive ? "啟用中" : "停用中"}
        </span>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-xl font-semibold text-slate-950">{headline.trim() || "你的公開標題"}</h3>
        {description.trim() ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{description}</p> : null}
        <div className="mt-5 grid gap-3">
          {fields.map((field) => (
            <label key={field.key} className="grid gap-1.5 text-sm font-medium text-slate-700">
              <span>{field.label.trim() || "尚未命名的欄位"}{field.required ? <span className="ml-1 text-red-600" aria-label="必填">*</span> : null}</span>
              <input
                disabled
                type={field.type}
                placeholder={field.type === "email" ? "name@example.com" : field.type === "url" ? "https://" : undefined}
                className="h-11 rounded-md border border-slate-200 bg-slate-50 px-3 text-base text-slate-500"
              />
            </label>
          ))}
          <button type="button" disabled className="mt-1 min-h-11 rounded-md bg-cta px-4 text-sm font-bold text-white opacity-90">
            {submitLabel.trim() || "送出報名"}
          </button>
          <p className="text-center text-xs text-slate-600">預覽模式不會送出資料</p>
        </div>
      </div>
    </aside>
  );
}
