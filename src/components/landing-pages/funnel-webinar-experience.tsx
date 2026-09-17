"use client";

import { useEffect, useState } from "react";
import { PublicFunnelDocument } from "@/components/landing-pages/public-funnel-document";
import { getFunnelWebinarState } from "@/lib/funnel-webinar";
import { hasDirectWebinarVideo } from "@/lib/funnel-webinar-media";
import type { FunnelStepPages } from "@/lib/funnel-step-pages";

export type WebinarExperienceResource = {
  live: { id: string; slug: string; videoId: string; videoTitle: string };
  form: { id: string; fields: Array<{ key: string; label: string; type?: string; required?: boolean }>; submitLabel: string; successMessage: string };
};

/** Preview and public pages share the same document and state rendering path. */
export function FunnelWebinarExperience({ state, stepId, slug, resource, preview = false, viewport }: {
  state: FunnelStepPages; stepId: string; slug: string; resource?: WebinarExperienceResource;
  preview?: boolean; viewport?: "desktop" | "mobile";
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const step = state.flow.steps.find((item) => item.id === stepId);
  const page = state.pages[stepId];
  if (!step || !page) return <p role="alert">找不到 Webinar 頁面。</p>;
  // Legacy or tampered published snapshots must not bypass the Live admission
  // boundary through the general-purpose video's raw URL renderer.
  if (step.type === "webinar_broadcast_page" && hasDirectWebinarVideo(state)) return <p role="alert" className="rounded-xl border border-amber-200 p-4">播放頁含有直接影片節點。請在編輯器移除該節點，並於頁面設定綁定活動與授權來源影片。</p>;
  const status = getFunnelWebinarState(state.flow.webinar, { liveId: resource?.live.id, formId: resource?.form.id }, now);
  const thankYou = state.flow.steps.find((item) => item.type === "webinar_thank_you_page");
  const broadcast = state.flow.steps.find((item) => item.type === "webinar_broadcast_page");
  const path = (value: string) => `/lp/${encodeURIComponent(slug)}/${encodeURIComponent(value)}`;
  const ready = resource && status.status !== "missing" && status.status !== "expired";
  const start = state.flow.webinar?.startsAt;
  return <div className="mx-auto w-full max-w-5xl p-4" data-webinar-state={status.status}>
    <PublicFunnelDocument document={{ ...page, flow: { ...state.flow, domain: slug } }} viewport={viewport} />
    {!step.isSystem ? <section className="mt-5 rounded-xl border border-slate-200 p-5">
      <p role={status.status === "missing" ? "alert" : "status"}>{status.message}</p>
      {start ? <p className="mt-2 text-sm">開始時間：<time dateTime={start}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: state.flow.webinar?.timezone }).format(new Date(start))}</time> · {state.flow.webinar?.timezone}</p> : null}
      {step.type === "webinar_registration_page" && ready && thankYou ? <form method="post" action="/api/form-submissions" className="mt-4 grid gap-3" onSubmit={preview ? (event) => event.preventDefault() : undefined}>
        <input type="hidden" name="formId" value={resource.form.id} />
        <input type="hidden" name="liveId" value={resource.live.id} />
        <input type="hidden" name="redirectTo" value={path(thankYou.path)} />
        {resource.form.fields.map((field) => <label key={field.key} className="grid gap-1 text-sm">{field.label}<input name={field.key} type={["email", "tel", "number", "url"].includes(field.type ?? "") ? field.type : "text"} required={field.required} className="min-h-11 rounded-lg border px-3" /></label>)}
        <button disabled={preview} className="min-h-11 rounded-lg bg-blue-700 px-4 text-white">{preview ? "預覽模式，不送出報名" : resource.form.submitLabel}</button>
        <p className="text-sm text-slate-600">送出後請至 Email 完成確認，才會列入正式名單。</p>
      </form> : null}
      {step.type === "webinar_thank_you_page" && ready && broadcast ? <a className="mt-4 inline-block rounded-lg bg-blue-700 p-3 text-white" href={path(broadcast.path)}>查看播放／重播頁</a> : null}
      {step.type === "webinar_broadcast_page" && ready && (status.status === "live" || status.status === "replay") ? <a className="mt-4 inline-block rounded-lg bg-blue-700 p-3 text-white" href={`${path(step.path)}/play`}>前往授權播放：{resource.live.videoTitle}</a> : null}
      {status.status === "missing" ? <p className="mt-2 text-sm">{preview ? "請開啟頁面設定，選擇報名表、活動與可播放來源影片，並補齊排程後儲存。" : "活動設定尚未完成，請聯絡活動主辦方確認資源與排程。"}</p> : null}
    </section> : null}
  </div>;
}
