"use client";

import { registrationAttributionFromSearchParams, type RegistrationAttribution } from "@/lib/registration-attribution";
import { useRegistrationRetry } from "@/components/registration-retry-context";
import { useRef, useState } from "react";
import { RegistrationSubmissionFeedback } from "@/components/registration-submission-feedback";
import { LineLoginButton } from "@/components/line-login-button";
import { formSubmissionErrorMessage, FORM_SUBMISSION_VERIFICATION_MESSAGE, postRegistrationSubmission } from "@/lib/registration-submission-client";
import { confirmedSessionFromResponse, describeLiveSessionFailure, LIVE_SESSION_CHECK_EMAIL_MESSAGE, LiveSessionPicker, useLiveSessionForm, type LiveSessionsData } from "@/components/landing-pages/live-session-picker";

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
  /** A fixed-session Live (指定場次): the open sessions the visitor must pick from. */
  fixedSessions?: LiveSessionsData;
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

/** A fixed-session Live's scheduledAt is only its last session, so its option describes the choice instead. */
function sessionTimingLabel(session: LeadFormSession) {
  if (!session.fixedSessions) return `${sessionStatusLabel(session.status)} · ${formatSessionDate(session.scheduledAt)}`;
  const count = session.fixedSessions.days.reduce((total, day) => total + day.sessions.filter((item) => !item.full).length, 0);
  return count > 0 ? `多個場次 · ${count} 個時段可報名，送出前請選擇場次` : "多個場次 · 目前沒有可報名的時段";
}

async function confirmedSessionLabel(fixed: boolean, response: Response) {
  if (!fixed) return "";
  return (await confirmedSessionFromResponse(response))?.label ?? "";
}

/** A taken, closed or already-held session gets its own message (and a refresh for the first two). */
async function leadFormFailure(fixed: boolean, response: Response, refresh: () => Promise<void>) {
  const known = fixed ? await describeLiveSessionFailure(response) : null;
  if (known?.refresh) void refresh();
  return known?.message ?? formSubmissionErrorMessage(response.status, { fixedSessions: fixed });
}

function LeadFormSessionPicker({ picker, locked, themeColor }: { picker: ReturnType<typeof useLiveSessionForm>["sessions"]; locked: boolean; themeColor: string }) {
  if (!picker.active) return null;
  return <LiveSessionPicker selection={picker} locked={locked} accentStyle={{ "--live-session-accent": themeColor, "--live-session-accent-text": "#ffffff" } as React.CSSProperties} />;
}

/** The session is named only to the registration's own browser; otherwise the confirmation email carries it. */
function ConfirmedSessionNote({ label, fixed }: { label: string; fixed: boolean }) {
  if (!fixed) return null;
  return <p className="rounded-lg border border-emerald-100 bg-white p-4 text-sm font-semibold leading-6 text-emerald-800">{label ? `你的場次：${label}` : LIVE_SESSION_CHECK_EMAIL_MESSAGE}</p>;
}

function hasFixedSessionLive(sessions: LeadFormSession[]) {
  return sessions.some((item) => Boolean(item.fixedSessions));
}

function defaultLiveId(sessions: LeadFormSession[], draftLiveId: string | null | undefined) {
  if (draftLiveId && sessions.some((item) => item.id === draftLiveId)) return draftLiveId;
  return sessions[0]?.id ?? null;
}

/** The Live the visitor picked and, for a fixed-session Live, its session picker. */
function useLeadFormLiveSessions(sessions: LeadFormSession[], draftLiveId: string | null | undefined) {
  const [selectedLiveId, setSelectedLiveId] = useState<string | null>(() => defaultLiveId(sessions, draftLiveId));
  const selectedLive = sessions.find((item) => item.id === selectedLiveId);
  const { sessions: sessionPicker, formRef, fixed, missing: sessionMissing } = useLiveSessionForm(selectedLive?.fixedSessions);
  return { selectedLiveId, setSelectedLiveId, sessionPicker, formRef, fixed, sessionMissing };
}

function sessionStatusLabel(status: LeadFormSession["status"]) {
  if (status === "live") return "直播中";
  if (status === "ended") return "回放場次";
  return "即將開始";
}

export function buildFormSubmissionRequestBody(input: {
  formId: string;
  liveId?: string | null;
  /** Only for a fixed-session Live; omitted otherwise so other Lives keep their contract. */
  liveSessionId?: string | null;
  payload: Record<string, FormDataEntryValue>;
  referralCode: string | null;
  shareCode: string;
  landingPageId?: string | null;
}) {
  return {
    formId: input.formId,
    ...(input.landingPageId && /^[A-Za-z0-9_-]{1,128}$/.test(input.landingPageId) ? { landingPageId: input.landingPageId } : {}),
    liveId: input.liveId,
    ...(input.liveSessionId ? { liveSessionId: input.liveSessionId } : {}),
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
  const retry = useRegistrationRetry(formId, { fixedSessions: hasFixedSessionLive(sessions) });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(retry?.submitted ? "success" : retry?.message ? "error" : "idle");
  const [errorMessage, setErrorMessage] = useState(retry?.message ?? "");
  const [confirmedLabel, setConfirmedLabel] = useState("");
  const submissionInFlight = useRef(false);
  const attribution = retry?.attribution;
  const nativeAttribution = attributionFields(attribution);
  const { selectedLiveId, setSelectedLiveId, sessionPicker, formRef, fixed, sessionMissing } = useLeadFormLiveSessions(sessions, retry?.draft?.liveId);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React 尚未更新 disabled 前，也要擋住同一輪事件的重複送出。
    if (submissionInFlight.current) return;
    if (sessionMissing()) return;
    submissionInFlight.current = true;
    setStatus("loading");
    setErrorMessage("");
    const form = event.currentTarget;

    try {
      const formData = new FormData(form);
      const submittedLiveId = getSubmittedLiveId(formData, liveId);
      const payload = Object.fromEntries(
        [...formData.entries()].filter(([key]) => !["formId", "liveId", "liveSessionId", "referralCode", "shareCode", "landingPageId", "redirectTo", "__registrationReturnPath"].includes(key)),
      );
      // 舊有無 boundary 的互動式 caller 只在事件中讀網址，避免 SSR 初始畫面分歧。
      const query = new URLSearchParams(window.location.search);
      const source = attributionFields(attribution ?? registrationAttributionFromSearchParams(query));
      const response = await postRegistrationSubmission(buildFormSubmissionRequestBody({ formId, liveId: submittedLiveId, liveSessionId: sessionPicker.active ? sessionPicker.sessionId : undefined, payload, referralCode: source.referralCode || null, shareCode: source.shareCode, landingPageId: source.landingPageId }));

      if (response.ok) {
        // Only the session the server confirmed is shown, never the tap alone.
        setConfirmedLabel(await confirmedSessionLabel(fixed, response));
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
        setErrorMessage(await leadFormFailure(fixed, response, sessionPicker.refresh));
      }
    } catch {
      submissionInFlight.current = false;
      setStatus("error");
      setErrorMessage(formSubmissionErrorMessage());
    }
  }


  return (
    <form ref={formRef} method="post" action="/api/form-submissions" onSubmit={onSubmit} aria-busy={status === "loading"} className="grid gap-4">
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
            {sessions.map((session) => (
              <label key={session.id} className="grid cursor-pointer gap-1 rounded-lg border border-slate-200 bg-white p-3 text-sm transition has-[:checked]:border-[var(--registration-form-theme)] has-[:checked]:ring-2 has-[:checked]:ring-blue-100" style={{ "--registration-form-theme": themeColor } as React.CSSProperties}>
                <span className="flex items-center gap-2 font-semibold text-slate-900">
                  <input type="radio" disabled={status === "loading"} name="liveId" value={session.id} required checked={session.id === selectedLiveId} onChange={() => setSelectedLiveId(session.id)} className="h-4 w-4 accent-[var(--registration-form-theme)]" />
                  {session.title}
                </span>
                <span className="pl-6 text-xs text-slate-500">{sessionTimingLabel(session)}</span>
                {session.description ? <span className="pl-6 text-sm leading-6 text-slate-600">{session.description}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <LeadFormSessionPicker picker={sessionPicker} locked={status === "loading"} themeColor={themeColor} />

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
        <ConfirmedSessionNote label={confirmedLabel} fixed={fixed} />
        <p className="rounded-lg border border-emerald-100 bg-white p-4 text-sm leading-6 text-emerald-800">{FORM_SUBMISSION_VERIFICATION_MESSAGE}</p>
        <LineLoginButton request={{ mode: "registration", redirectPath: retry?.sourcePath ?? (typeof window === "undefined" ? "/" : window.location.pathname) }}>
          🟢 接收 LINE 開播提醒與電子票券
        </LineLoginButton>
      </div> : null}
    </form>
  );
}
