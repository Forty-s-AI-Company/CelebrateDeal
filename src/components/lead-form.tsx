"use client";

import { registrationAttributionFromSearchParams, type RegistrationAttribution } from "@/lib/registration-attribution";
import { useRegistrationRetry } from "@/components/registration-retry-context";
import { useRef, useState } from "react";
import { RegistrationSubmissionFeedback } from "@/components/registration-submission-feedback";
import { LineLoginButton } from "@/components/line-login-button";
import { formSubmissionErrorMessage, FORM_SUBMISSION_VERIFICATION_MESSAGE, postRegistrationSubmission } from "@/lib/registration-submission-client";

// Preserve the existing exports for callers while sharing the submission contract.
export { formSubmissionErrorMessage, FORM_SUBMISSION_VERIFICATION_MESSAGE } from "@/lib/registration-submission-client";

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
  landingPageId?: string | null;
}) {
  return {
    formId: input.formId,
    ...(input.landingPageId && /^[A-Za-z0-9_-]{1,128}$/.test(input.landingPageId) ? { landingPageId: input.landingPageId } : {}),
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

function attributionFields(value: RegistrationAttribution = {}) {
  return { shareCode: value.shareCode ?? "", referralCode: value.referralCode ?? "", landingPageId: value.landingPageId ?? "" };
}

export function LeadForm({
  formId,
  liveId,
  fields,
  sessions = [],
  submitLabel,
  successMessage,
  redirectTo,
  themeColor = "#c2410c",
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
  const retry = useRegistrationRetry(formId);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(retry?.submitted ? "success" : retry?.message ? "error" : "idle");
  const [errorMessage, setErrorMessage] = useState(retry?.message ?? "");
  const submissionInFlight = useRef(false);
  const attribution = retry?.attribution;
  const nativeAttribution = attributionFields(attribution);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React 尚未更新 disabled 前，也要擋住同一輪事件的重複送出。
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setStatus("loading");
    setErrorMessage("");
    const form = event.currentTarget;

    try {
      const formData = new FormData(form);
      const selectedLiveId = getSubmittedLiveId(formData, liveId);
      const payload = Object.fromEntries(
        [...formData.entries()].filter(([key]) => !["formId", "liveId", "referralCode", "shareCode", "landingPageId", "redirectTo", "__registrationReturnPath"].includes(key)),
      );
      // 舊有無 boundary 的互動式 caller 只在事件中讀網址，避免 SSR 初始畫面分歧。
      const query = new URLSearchParams(window.location.search);
      const source = attributionFields(attribution ?? registrationAttributionFromSearchParams(query));
      const response = await postRegistrationSubmission(buildFormSubmissionRequestBody({ formId, liveId: selectedLiveId, payload, referralCode: source.referralCode || null, shareCode: source.shareCode, landingPageId: source.landingPageId }));

      if (response.ok) {
        setStatus("success");
        form.reset();
        // 成功後移除舊重試旗標，重新整理不再誤顯示先前錯誤。
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("registrationRetry");
        cleanUrl.searchParams.delete("submitted");
        window.history.replaceState(window.history.state, "", cleanUrl);
      } else {
        submissionInFlight.current = false;
        setStatus("error");
        setErrorMessage(formSubmissionErrorMessage(response.status));
      }
    } catch {
      submissionInFlight.current = false;
      setStatus("error");
      setErrorMessage(formSubmissionErrorMessage());
    }
  }


  return (
    <form method="post" action="/api/form-submissions" onSubmit={onSubmit} aria-busy={status === "loading"} className="grid gap-4">
      {status !== "success" ? <>
      <input type="hidden" name="formId" value={formId} />
      {retry ? <input type="hidden" name="__registrationReturnPath" value={retry.sourcePath} /> : null}
      {sessions.length === 0 && liveId ? <input type="hidden" name="liveId" value={liveId} /> : null}
      <input type="hidden" name="shareCode" value={nativeAttribution.shareCode} />
      <input type="hidden" name="referralCode" value={nativeAttribution.referralCode} />
      <input type="hidden" name="landingPageId" value={nativeAttribution.landingPageId} />
      {redirectTo || retry?.sourcePath ? <input type="hidden" name="redirectTo" value={redirectTo || retry?.sourcePath} /> : null}

      {sessions.length > 0 ? (
        <fieldset className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <legend className="px-1 text-sm font-bold text-slate-900">選擇場次</legend>
          <div className="grid gap-2">
            {sessions.map((session, index) => (
              <label key={session.id} className="grid cursor-pointer gap-1 rounded-lg border border-slate-200 bg-white p-3 text-sm transition has-[:checked]:border-[var(--registration-form-theme)] has-[:checked]:ring-2 has-[:checked]:ring-blue-100" style={{ "--registration-form-theme": themeColor } as React.CSSProperties}>
                <span className="flex items-center gap-2 font-semibold text-slate-900">
                  <input type="radio" disabled={status === "loading"} name="liveId" value={session.id} required defaultChecked={retry?.draft?.liveId && sessions.some((item) => item.id === retry.draft?.liveId) ? session.id === retry.draft.liveId : index === 0} className="h-4 w-4 accent-[var(--registration-form-theme)]" />
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
            defaultValue={retry?.draft?.answers[field.key] ?? ""}
            type={field.type ?? "text"}
            required={field.required}
            disabled={status === "loading"}
            autoComplete={fieldAutoComplete(field)}
            inputMode={fieldInputMode(field)}
            className="h-11 rounded-md border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      ))}

      <button type="submit" disabled={status === "loading"} aria-disabled={status === "loading"} aria-busy={status === "loading"} style={{ backgroundColor: themeColor }} className="h-11 rounded-md text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60">
        {status === "loading" ? "送出中..." : submitLabel}
      </button>
      </> : null}
      <RegistrationSubmissionFeedback key="submission-feedback" pending={status === "loading"} errorMessage={status === "error" ? errorMessage || formSubmissionErrorMessage() : ""} successMessage={status === "success" ? successMessage : ""} focusSuccess />
      {status === "success" ? <div className="grid gap-3">
        <p className="rounded-lg border border-emerald-100 bg-white p-4 text-sm leading-6 text-emerald-800">{FORM_SUBMISSION_VERIFICATION_MESSAGE}</p>
        <LineLoginButton request={{ mode: "registration", redirectPath: retry?.sourcePath ?? (typeof window === "undefined" ? "/" : window.location.pathname) }}>
          🟢 接收 LINE 開播提醒與電子票券
        </LineLoginButton>
      </div> : null}
    </form>
  );
}
