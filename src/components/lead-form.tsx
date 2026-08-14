"use client";

import { useState } from "react";

type FieldSpec = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
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

export function LeadForm({
  formId,
  liveId,
  fields,
  submitLabel,
  redirectTo,
}: {
  formId: string;
  liveId?: string | null;
  fields: FieldSpec[];
  submitLabel: string;
  successMessage: string;
  redirectTo?: string;
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
        body: JSON.stringify(buildFormSubmissionRequestBody({ formId, liveId, payload, referralCode, shareCode })),
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
    return <p role="status" aria-live="polite" className="rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-700">{FORM_SUBMISSION_VERIFICATION_MESSAGE}</p>;
  }

  return (
    <form method="post" action="/api/form-submissions" onSubmit={onSubmit} aria-busy={status === "loading"} className="grid gap-3">
      <input type="hidden" name="formId" value={formId} />
      {liveId ? <input type="hidden" name="liveId" value={liveId} /> : null}
      <input type="hidden" name="shareCode" value={shareCode} />
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
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
      <button disabled={status === "loading"} aria-disabled={status === "loading"} aria-busy={status === "loading"} className="h-11 rounded-md bg-orange-700 text-sm font-bold text-white transition hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60">
        {status === "loading" ? "送出中..." : submitLabel}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{status === "loading" ? "正在送出，請勿重複操作。" : ""}</span>
    </form>
  );
}
