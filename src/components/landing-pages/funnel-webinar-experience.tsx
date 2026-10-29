"use client";
import { useRegistrationRetry } from "@/components/registration-retry-context";
import { RegistrationSubmissionFeedback } from "@/components/registration-submission-feedback";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import { getFunnelWebinarState, type FunnelEvergreenSession } from "@/lib/funnel-webinar";
import { EVERGREEN_SESSION_ENDPOINT, evergreenSessionTimeLabel } from "@/components/live-evergreen";
import { hasDirectWebinarVideo } from "@/lib/funnel-webinar-media";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";
import type { FunnelRenderEvent, FunnelSubmissionContext, FunnelViewport } from "@/components/landing-pages/funnel-page-document-renderer";
import { isLeadCaptureFormNode } from "@/lib/funnel-registration-surface";
import type { FunnelNode } from "@/lib/funnel-page-document";

export type WebinarExperienceResource = {
  live: { id: string; slug: string; videoId: string; videoTitle: string; isEvergreen?: true };
  form: { id: string; fields: Array<{ key: string; label: string; type?: string; required?: boolean }>; submitLabel: string; successMessage: string };
};

function funnelSourceFields(source: { landingPageId: string; stepId: string } | undefined) {
  return { landingPageId: source?.landingPageId ?? "", stepId: source?.stepId ?? "" };
}

/** Preview and public pages share the same document and state rendering path. */
const hasLeadForm = (nodes: FunnelNode[]): boolean => nodes.some((node) => isLeadCaptureFormNode(node) || hasLeadForm(node.children ?? []));
const REGISTRATION_FIELD_TYPES = new Set(["text", "email", "tel", "number", "url"]);
const WEBINAR_CONFIRMATION_NOTICE = "送出後請至 Email 完成確認，才會列入正式名單。";

/**
 * A public registration page whose design has its own lead form (webinar templates) submits through that form,
 * with the same form, live, step and redirect as `WebinarRegistrationForm`; preview never submits.
 */
function designedFormSubmission({ registration, ready, page, resource, source, thankYou, path }: { registration: boolean; ready: boolean; page: { root: FunnelNode[] }; resource?: WebinarExperienceResource; source: ReturnType<typeof funnelSourceFields>; thankYou?: { path: string }; path: (value: string) => string }): FunnelSubmissionContext | undefined {
  if (!registration || !ready || !resource || !thankYou || !hasLeadForm(page.root)) return undefined;
  const redirectTo = path(thankYou.path);
  return {
    form: { id: resource.form.id, fields: resource.form.fields.map((field) => ({ key: field.key, label: field.label, type: REGISTRATION_FIELD_TYPES.has(field.type ?? "") ? field.type as "text" : "text", required: field.required === true })), submitLabel: resource.form.submitLabel, successMessage: resource.form.successMessage },
    landingPageId: source.landingPageId, funnelStepId: source.stepId, liveId: resource.live.id, redirectTo, notice: WEBINAR_CONFIRMATION_NOTICE, nativeSubmit: true,
  };
}

export function FunnelWebinarExperience({ state, stepId, slug, resource, preview = false, viewport, initialViewport, event, funnelSource }: {
  state: FunnelStepPages; stepId: string; slug: string; resource?: WebinarExperienceResource;
  preview?: boolean; viewport?: FunnelViewport; initialViewport?: FunnelViewport; event?: FunnelRenderEvent; funnelSource?: { landingPageId: string; stepId: string };
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const step = state.flow.steps.find((item) => item.id === stepId);
  const page = state.pages[stepId];
  // Reaching the thank-you or broadcast step is the registration confirmation:
  // the server assigns this visitor's own session there. The registration page only previews.
  const evergreenSession = useFunnelEvergreenSession(preview ? undefined : resource?.live, Boolean(step) && step?.type !== "webinar_registration_page");
  if (!step || !page) return <p role="alert">找不到線上講座頁面。</p>;
  // Legacy or tampered published snapshots must not bypass the Live admission
  // boundary through the general-purpose video's raw URL renderer.
  if (step.type === "webinar_broadcast_page" && hasDirectWebinarVideo(state)) return <p role="alert" className="rounded-xl border border-amber-200 p-4">播放頁含有直接影片節點。請在編輯器移除該節點，並於頁面設定綁定活動與授權來源影片。</p>;
  const evergreen = resource?.live.isEvergreen === true;
  const status = getFunnelWebinarState(state.flow.webinar, { liveId: resource?.live.id, formId: resource?.form.id, evergreen, evergreenSession }, now);
  const thankYou = state.flow.steps.find((item) => item.type === "webinar_thank_you_page");
  const broadcast = state.flow.steps.find((item) => item.type === "webinar_broadcast_page");
  const path = (value: string) => `/lp/${encodeURIComponent(slug)}/${encodeURIComponent(value)}`;
  const ready = resource && status.status !== "missing" && status.status !== "expired";
  const source = funnelSourceFields(funnelSource);
  const submission = designedFormSubmission({ registration: step.type === "webinar_registration_page" && !preview, ready: Boolean(ready), page, resource, source, thankYou, path });
  // The page design is full width (sections draw their own backgrounds); the platform status box stays in a centred column.
  return <div className="w-full" data-webinar-state={status.status}>
    <PublicFunnelDocument document={{ ...page, flow: { ...state.flow, domain: slug } }} viewport={viewport} initialViewport={initialViewport} event={event} submission={submission} />
    {!step.isSystem ? <section className="mx-auto my-5 w-[calc(100%-2rem)] max-w-5xl rounded-xl border border-slate-200 p-5">
      <p role={status.status === "missing" ? "alert" : "status"}>{status.message}</p>
      <WebinarScheduleLine evergreen={evergreen} session={evergreenSession} settings={state.flow.webinar} />
      {step.type === "webinar_registration_page" && ready && thankYou && !submission ? <WebinarRegistrationForm resource={resource} source={source} redirectTo={path(thankYou.path)} preview={preview} /> : null}
      {step.type === "webinar_thank_you_page" && ready && broadcast ? <a className="mt-4 inline-block rounded-lg bg-blue-700 p-3 text-white" href={path(broadcast.path)}>查看播放／重播頁</a> : null}
      {ready && showsBroadcastEntry(step.type, evergreen, status.status) ? <a className="mt-4 inline-block rounded-lg bg-blue-700 p-3 text-white" href={`${path(step.path)}/play`}>前往授權播放：{resource.live.videoTitle}</a> : null}
      {status.status === "missing" ? <p className="mt-2 text-sm">{preview ? "請開啟頁面設定，選擇報名表、活動與可播放來源影片，並補齊排程後儲存。" : "活動設定尚未完成，請聯絡活動主辦方確認資源與排程。"}</p> : null}
    </section> : null}
  </div>;
}

function parseFunnelEvergreenSession(value: unknown): FunnelEvergreenSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.assigned !== "boolean" || typeof body.sessionStartAt !== "string" || typeof body.sessionEndAt !== "string" || typeof body.timezone !== "string") return null;
  if (!Number.isFinite(Date.parse(body.sessionStartAt)) || !Number.isFinite(Date.parse(body.sessionEndAt))) return null;
  return { assigned: body.assigned, sessionStartAt: body.sessionStartAt, sessionEndAt: body.sessionEndAt, timezone: body.timezone };
}

/**
 * The visitor's evergreen session for a funnel bound to an evergreen Live.
 * `claim` assigns it (thank-you / broadcast); otherwise it is only previewed.
 * The server alone computes the time; the request carries no time at all.
 */
function useFunnelEvergreenSession(live: WebinarExperienceResource["live"] | undefined, claim: boolean) {
  const [session, setSession] = useState<{ key: string; value: FunnelEvergreenSession | null }>({ key: "", value: null });
  const liveId = live?.isEvergreen ? live.id : null;
  const key = liveId ? `${liveId}:${claim ? "claim" : "read"}` : "";
  useEffect(() => {
    if (!liveId) return;
    let disposed = false;
    const headers = { "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" };
    const request = claim
      ? fetch(EVERGREEN_SESSION_ENDPOINT, { method: "POST", headers, body: JSON.stringify({ liveId, intent: "claim" }) })
      : fetch(`${EVERGREEN_SESSION_ENDPOINT}?${new URLSearchParams({ liveId }).toString()}`, { headers });
    void request
      .then(async (response) => (response.ok ? parseFunnelEvergreenSession(await response.json()) : null))
      .then((value) => { if (!disposed) setSession({ key, value }); })
      .catch(() => { if (!disposed) setSession({ key, value: null }); });
    return () => { disposed = true; };
  }, [claim, key, liveId]);
  return session.key === key ? session.value : null;
}

/** An evergreen watch page runs its own waiting room, so its entry is always offered. */
function showsBroadcastEntry(stepType: string, evergreen: boolean, status: string) {
  return stepType === "webinar_broadcast_page" && (evergreen || status === "live" || status === "replay");
}

/** Fixed funnel dates, or for an evergreen Live the visitor's own session time. */
function WebinarScheduleLine({ evergreen, session, settings }: {
  evergreen: boolean;
  session: FunnelEvergreenSession | null;
  settings: FunnelStepPages["flow"]["webinar"];
}) {
  if (evergreen) {
    const label = session ? evergreenSessionTimeLabel(session) : null;
    if (!session || !label) return <p className="mt-2 text-sm">場次時間：報名後依你的進場時間安排。</p>;
    return <p className="mt-2 text-sm">{session.assigned ? "你的場次" : "下一場次（報名後確認）"}：<time dateTime={session.sessionStartAt}>{label}</time></p>;
  }
  const start = settings?.startsAt;
  if (!start) return null;
  return <p className="mt-2 text-sm">開始時間：<time dateTime={start}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: settings?.timezone }).format(new Date(start))}</time> · {settings?.timezone}</p>;
}

function WebinarRegistrationForm({ resource, source, redirectTo, preview }: {
  resource: WebinarExperienceResource; source: ReturnType<typeof funnelSourceFields>; redirectTo: string; preview: boolean;
}) {
  const retry = useRegistrationRetry(resource.form.id);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    // 從瀏覽器歷史快取返回時，允許使用者重新送出。
    const reset = () => { inFlight.current = false; setPending(false); };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (preview || inFlight.current) { event.preventDefault(); return; }
    inFlight.current = true;
    // 在原生導頁開始前繪製等待狀態，避免更新被延後到離開頁面之後。
    flushSync(() => setPending(true));
    // 首次提交保留原生POST；不停用欄位，以免瀏覽器序列化時漏值。
  }
  return <form id="webinar-registration" method="post" action="/api/form-submissions" className="mt-4 grid gap-3" aria-busy={pending} onSubmit={onSubmit}>
    {retry ? <input type="hidden" name="__registrationReturnPath" value={retry.sourcePath} /> : null}
    <input type="hidden" name="formId" value={resource.form.id} />
    <input type="hidden" name="liveId" value={resource.live.id} />
    <input type="hidden" name="landingPageId" value={source.landingPageId} />
    <input type="hidden" name="funnelStepId" value={source.stepId} />
    {/* Validated server attribution (draft or page query), as LeadForm sends it. */}
    <input type="hidden" name="referralCode" value={retry?.attribution?.referralCode ?? ""} />
    <input type="hidden" name="shareCode" value={retry?.attribution?.shareCode ?? ""} />
    <input type="hidden" name="redirectTo" value={redirectTo} />
    {resource.form.fields.map((field) => <label key={field.key} className="grid gap-1 text-sm">{field.label}<input name={field.key} defaultValue={retry?.draft?.answers[field.key] ?? ""} type={["email", "tel", "number", "url"].includes(field.type ?? "") ? field.type : "text"} required={field.required} className="min-h-11 rounded-lg border px-3" /></label>)}
    <RegistrationSubmissionFeedback pending={pending} errorMessage={retry?.message ?? ""} />
    <button disabled={preview || pending} aria-busy={pending} className="min-h-11 rounded-lg bg-blue-700 px-4 text-white">{preview ? "預覽模式，不送出報名" : pending ? "送出中..." : resource.form.submitLabel}</button>
    <p className="text-sm text-slate-600">{WEBINAR_CONFIRMATION_NOTICE}</p>
  </form>;
}
