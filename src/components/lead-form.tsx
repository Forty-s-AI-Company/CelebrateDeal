"use client";

import { useState } from "react";

type FieldSpec = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
};

export type LeadFormSession = {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  status: "scheduled" | "live" | "ended";
};

export function formSubmissionErrorMessage(status?: number) {
  if (status === 400) return "請確認必填欄位與資料格式後再送出。";
  if (status === 429) return "送出次數太頻繁，請稍候一分鐘再試。";
  if (status === 404 || status === 503) return "這張表單目前無法接收資料，請稍後再試。";
  return "送出失敗；內容仍保留，請檢查網路後再試。";
}

export const FORM_SUBMISSION_VERIFICATION_MESSAGE = "請到 Email 開啟確認連結；完成確認後才會列入正式名單。";

function fieldAutoComplete(field: FieldSpec) {
  if (field.key === "name") return "name";
  if (field.type === "email") return "email";
  if (field.type === "tel") return "tel";
  return undefined;
}

function fieldInputMode(field: FieldSpec): "email" | "tel" | "url" | "decimal" | undefined {
  if (field.type === "email" || field.type === "tel" || field.type === "url") return field.type;
  if (field.type === "number") return "decimal";
  return undefined;
}

function formatSessionDate(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Taipei",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function sessionStatusLabel(status: LeadFormSession["status"]) {
  if (status === "live") return "直播中";
  if (status === "ended") return "回放場次";
  return "即將開始";
}

export function buildFormSubmissionRequestBody(input: {
  formId: string;
  liveId?: string | null;
  payload: Record<string, FormDataEntryValue>;
  referralCode: string | null;
  shareCode: string;
}) {
  return {
    formId: input.formId,
    liveId: input.liveId,
    payload: input.payload,
    referralCode: input.referralCode,
    ...(input.shareCode ? { shareCode: input.shareCode } : {}),
  };
}

export function getSubmittedLiveId(formData: FormData, fallbackLiveId?: string | null) {
  const submittedLiveId = formData.get("liveId");
  return typeof submittedLiveId === "string" && submittedLiveId.trim()
    ? submittedLiveId.trim()
    : fallbackLiveId ?? null;
}

export function LeadForm({
  formId,
  liveId,
  fields,
  sessions = [],
  submitLabel,
  successMessage,
  redirectTo,
  themeColor = "#f97316",
}: {
  formId: string;
  liveId?: string | null;
  fields: FieldSpec[];
  sessions?: LeadFormSession[];
  submitLabel: string;
  successMessage: string;
  redirectTo?: string;
  themeColor?: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [shareCode] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("share") ?? "");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setErrorMessage("");
    const form = event.currentTarget;

    const formData = new FormData(form);
    const selectedLiveId = getSubmittedLiveId(formData, liveId);
    const payload = Object.fromEntries(
      [...formData.entries()].filter(([key]) => !["formId", "liveId", "referralCode", "shareCode", "redirectTo"].includes(key)),
    );
    const referralCode = new URLSearchParams(window.location.search).get("ref");
    try {
      const response = await fetch("/api/form-submissions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CelebrateDeal-Client": "web",
        },
        body: JSON.stringify(buildFormSubmissionRequestBody({ formId, liveId: selectedLiveId, payload, referralCode, shareCode })),
      });

      if (response.ok) {
        setStatus("success");
        form.reset();
      } else {
        setStatus("error");
        setErrorMessage(formSubmissionErrorMessage(response.status));
      }
    } catch {
      setStatus("error");
      setErrorMessage(formSubmissionErrorMessage());
    }
  }

  if (status === "success") {
    return (
      <div role="status" aria-live="polite" className="grid gap-3">
        <p className="rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{successMessage}</p>
        <p className="rounded-lg border border-emerald-100 bg-white p-4 text-sm leading-6 text-emerald-800">{FORM_SUBMISSION_VERIFICATION_MESSAGE}</p>
      </div>
    );
  }

  return (
    <form method="post" action="/api/form-submissions" onSubmit={onSubmit} aria-busy={status === "loading"} className="grid gap-4">
      <input type="hidden" name="formId" value={formId} />
      {sessions.length === 0 && liveId ? <input type="hidden" name="liveId" value={liveId} /> : null}
      <input type="hidden" name="shareCode" value={shareCode} />
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      {sessions.length > 0 ? (
        <fieldset className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <legend className="px-1 text-sm font-bold text-slate-900">選擇場次</legend>
          <div className="grid gap-2">
            {sessions.map((session, index) => (
              <label key={session.id} className="grid cursor-pointer gap-1 rounded-lg border border-slate-200 bg-white p-3 text-sm transition has-[:checked]:border-[var(--registration-form-theme)] has-[:checked]:ring-2 has-[:checked]:ring-blue-100" style={{ "--registration-form-theme": themeColor } as React.CSSProperties}>
                <span className="flex items-center gap-2 font-semibold text-slate-900">
                  <input type="radio" name="liveId" value={session.id} required defaultChecked={index === 0} className="h-4 w-4 accent-[var(--registration-form-theme)]" />
                  {session.title}
                </span>
                <span className="pl-6 text-xs text-slate-500">{sessionStatusLabel(session.status)} · {formatSessionDate(session.scheduledAt)}</span>
                {session.description ? <span className="pl-6 text-sm leading-6 text-slate-600">{session.description}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {fields.map((field) => (
        <label key={field.key} className="grid gap-1.5 text-sm font-medium text-slate-700">
          {field.label}
          <input
            name={field.key}
            type={field.type ?? "text"}
            required={field.required}
            disabled={status === "loading"}
            autoComplete={fieldAutoComplete(field)}
            inputMode={fieldInputMode(field)}
            className="h-11 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      ))}
      {status === "error" ? <p role="alert" aria-live="assertive" className="text-sm text-red-700">{errorMessage || formSubmissionErrorMessage()}</p> : null}
      <button type="submit" disabled={status === "loading"} aria-disabled={status === "loading"} aria-busy={status === "loading"} style={{ backgroundColor: themeColor }} className="h-11 rounded-md text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60">
        {status === "loading" ? "送出中..." : submitLabel}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{status === "loading" ? "正在送出，請勿重複操作。" : ""}</span>
    </form>
  );
}
