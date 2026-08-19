"use client";

import type { RegistrationFormBuilderField } from "@/lib/registration-form-builder";
import { RichTextContent } from "@/components/rich-text-content";

export function FormPreview({
  headline,
  description,
  submitLabel,
  fields,
  isActive,
  themeColor,
  stickyText,
  bodyContent,
  notice,
  countdownMinutes,
  maxVisibleSessions,
  hideExpiredSessions,
}: {
  headline: string;
  description: string;
  submitLabel: string;
  fields: RegistrationFormBuilderField[];
  isActive: boolean;
  themeColor: string | null;
  stickyText: string | null;
  bodyContent: string | null;
  notice: string | null;
  countdownMinutes: number | null;
  maxVisibleSessions: number;
  hideExpiredSessions: boolean;
}) {
  const normalizedThemeColor = themeColor?.trim() ?? "";
  const safeThemeColor = /^#[\da-fA-F]{6}$/.test(normalizedThemeColor) ? normalizedThemeColor : null;
  const safeCountdownMinutes = countdownMinutes !== null
    && Number.isInteger(countdownMinutes)
    && countdownMinutes >= 0
    && countdownMinutes <= 10_080
    ? countdownMinutes
    : null;
  const safeMaxVisibleSessions = Number.isInteger(maxVisibleSessions)
    && maxVisibleSessions >= 0
    && maxVisibleSessions <= 99
    ? maxVisibleSessions
    : 0;

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

      <div
        className="rounded-lg border border-slate-200 border-t-4 bg-white p-5 shadow-sm"
        style={safeThemeColor ? { borderTopColor: safeThemeColor } : undefined}
      >
        <h3 className="text-xl font-semibold text-slate-950">{headline.trim() || "你的公開標題"}</h3>
        {description.trim() ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">{description}</p> : null}
        {stickyText?.trim() ? <p className="mt-3 rounded-md px-3 py-2 text-sm font-semibold" style={safeThemeColor ? { color: safeThemeColor } : undefined}>{stickyText.trim()}</p> : null}
        {bodyContent?.trim() ? <RichTextContent value={bodyContent} className="mt-3 text-sm leading-6 text-slate-700" /> : null}
        {notice?.trim() ? <p className="mt-3 whitespace-pre-line rounded-md bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">{notice.trim()}</p> : null}
        <div className="mt-3 grid gap-1 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p>倒數設定：{safeCountdownMinutes === null ? "未設定" : `${safeCountdownMinutes} 分鐘`}</p>
          <p>場次顯示：{safeMaxVisibleSessions === 0 ? "不限" : `最多 ${safeMaxVisibleSessions} 場`}・{hideExpiredSessions ? "隱藏過期場次" : "顯示過期場次"}</p>
        </div>
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
