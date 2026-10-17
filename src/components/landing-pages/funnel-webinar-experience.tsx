"use client";
import { useRegistrationRetry } from "@/components/registration-retry-context";
import { RegistrationSubmissionFeedback } from "@/components/registration-submission-feedback";
import { WebinarCalendarDownload } from "@/components/webinar-calendar-download";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import { getFunnelWebinarState } from "@/lib/funnel-webinar";
import { hasDirectWebinarVideo } from "@/lib/funnel-webinar-media";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";

export type WebinarExperienceResource = {
  live: { id: string; slug: string; title?: string; videoId: string; videoTitle: string };
  form: { id: string; fields: Array<{ key: string; label: string; type?: string; required?: boolean }>; submitLabel: string; successMessage: string };
};

function funnelSourceFields(source: { landingPageId: string; stepId: string } | undefined) {
  return { landingPageId: source?.landingPageId ?? "", stepId: source?.stepId ?? "" };
}

/** Preview and public pages share the same document and state rendering path. */
export function FunnelWebinarExperience({ state, stepId, slug, resource, preview = false, viewport, funnelSource }: {
  state: FunnelStepPages; stepId: string; slug: string; resource?: WebinarExperienceResource;
  preview?: boolean; viewport?: "desktop" | "mobile"; funnelSource?: { landingPageId: string; stepId: string };
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const step = state.flow.steps.find((item) => item.id === stepId);
  const page = state.pages[stepId];
  if (!step || !page) return <p role="alert">找不到線上講座頁面。</p>;
  // Legacy or tampered published snapshots must not bypass the Live admission
  // boundary through the general-purpose video's raw URL renderer.
  if (step.type === "webinar_broadcast_page" && hasDirectWebinarVideo(state)) return <p role="alert" className="rounded-xl border border-amber-200 p-4">播放頁含有直接影片節點。請在編輯器移除該節點，並於頁面設定綁定活動與授權來源影片。</p>;
  const status = getFunnelWebinarState(state.flow.webinar, { liveId: resource?.live.id, formId: resource?.form.id }, now);
  const thankYou = state.flow.steps.find((item) => item.type === "webinar_thank_you_page");
  const broadcast = state.flow.steps.find((item) => item.type === "webinar_broadcast_page");
  const path = (value: string) => `/lp/${encodeURIComponent(slug)}/${encodeURIComponent(value)}`;
  const ready = resource && status.status !== "missing" && status.status !== "expired";
  const start = state.flow.webinar?.startsAt;
  const source = funnelSourceFields(funnelSource);
  return <div className="mx-auto w-full max-w-5xl p-4" data-webinar-state={status.status}>
    <PublicFunnelDocument document={{ ...page, flow: { ...state.flow, domain: slug } }} viewport={viewport} />
    {!step.isSystem ? <section className="mt-5 rounded-xl border border-slate-200 p-5">
      <p role={status.status === "missing" ? "alert" : "status"}>{status.message}</p>
      {start ? <p className="mt-2 text-sm">開始時間：<time dateTime={start}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: state.flow.webinar?.timezone }).format(new Date(start))}</time> · {state.flow.webinar?.timezone}</p> : null}
      {step.type === "webinar_registration_page" && ready && thankYou ? <WebinarRegistrationForm resource={resource} source={source} redirectTo={path(thankYou.path)} preview={preview} /> : null}
      {step.type === "webinar_thank_you_page" && ready && broadcast ? <>
        <a className="mt-4 inline-block rounded-lg bg-blue-700 p-3 text-white" href={path(broadcast.path)}>查看播放／重播頁</a>
        <WebinarCalendarDownload event={{ liveId: resource.live.id, title: resource.live.title ?? resource.live.videoTitle, schedule: state.flow.webinar, slug, broadcastPath: broadcast.path }} upcoming={status.status === "waiting"} preview={preview} />
      </> : null}
      {step.type === "webinar_broadcast_page" && ready && (status.status === "live" || status.status === "replay") ? <a className="mt-4 inline-block rounded-lg bg-blue-700 p-3 text-white" href={`${path(step.path)}/play`}>前往授權播放：{resource.live.videoTitle}</a> : null}
      {status.status === "missing" ? <p className="mt-2 text-sm">{preview ? "請開啟頁面設定，選擇報名表、活動與可播放來源影片，並補齊排程後儲存。" : "活動設定尚未完成，請聯絡活動主辦方確認資源與排程。"}</p> : null}
    </section> : null}
  </div>;
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
        <input type="hidden" name="redirectTo" value={redirectTo} />
        {resource.form.fields.map((field) => <label key={field.key} className="grid gap-1 text-sm">{field.label}<input name={field.key} defaultValue={retry?.draft?.answers[field.key] ?? ""} type={["email", "tel", "number", "url"].includes(field.type ?? "") ? field.type : "text"} required={field.required} className="min-h-11 rounded-lg border px-3" /></label>)}
        <RegistrationSubmissionFeedback pending={pending} errorMessage={retry?.message ?? ""} />
        <button disabled={preview || pending} aria-busy={pending} className="min-h-11 rounded-lg bg-blue-700 px-4 text-white">{preview ? "預覽模式，不送出報名" : pending ? "送出中..." : resource.form.submitLabel}</button>
        <p className="text-sm text-slate-600">送出後請至 Email 完成確認，才會列入正式名單。</p>
      </form>;
}
