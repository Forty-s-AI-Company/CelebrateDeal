"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
import { landingPageAction } from "@/app/actions/landing-page-actions";
import { createLandingPageContent, type LandingPageContent, type LandingPageRenderContext } from "@/lib/landing-page-content";
import type { LandingPageEditorPage } from "@/lib/landing-page-service";

const Editor = dynamic(() => import("@/components/landing-pages/landing-page-editor").then((module) => module.LandingPageEditor), { ssr: false, loading: () => <p className="p-8">正在載入編輯器…</p> });
type PageInput = Omit<LandingPageEditorPage, "publishedAt" | "updatedAt" | "versions"> & { versions: Array<{ version: number }> };
function initialWorkspace(page: PageInput | undefined, forms: LandingPageRenderContext["forms"]) {
  return {
    content: page?.content ?? createLandingPageContent("webinar", forms[0]?.id),
    name: page?.name ?? "新的 Webinar 招生頁", slug: page?.slug ?? "",
    formId: page?.formId ?? forms[0]?.id ?? "", liveId: page?.liveId ?? "",
    revision: page?.revision ?? 1, valid: Boolean(page?.content ?? true),
    version: String(page?.versions[0]?.version ?? ""),
  };
}
/** The workspace owns persistence; Puck owns only the current editing session. */
export function LandingPageWorkspace({ page, forms, lives, csrfToken, csrfName }: { page?: PageInput; forms: LandingPageRenderContext["forms"]; lives: NonNullable<LandingPageRenderContext["live"]>[]; csrfToken: string; csrfName: string }) {
  const router = useRouter();
  const [initial] = useState(() => initialWorkspace(page, forms));
  const [content, setContent] = useState<LandingPageContent>(initial.content);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [formId, setFormId] = useState(initial.formId);
  const [liveId, setLiveId] = useState(initial.liveId);
  const [revision, setRevision] = useState(initial.revision);
  const [dirty, setDirty] = useState(!page);
  const [valid, setValid] = useState(initial.valid);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [version, setVersion] = useState(initial.version);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function run(operation: string) {
    const data = new FormData();
    data.set(csrfName, csrfToken);
    data.set("operation", operation);
    if (page) data.set("id", page.id);
    data.set("revision", String(revision));
    data.set("name", name); data.set("slug", slug); data.set("formId", formId); data.set("liveId", liveId);
    data.set("content", JSON.stringify(content)); data.set("version", version);
    startTransition(async () => {
      try {
        const result = await landingPageAction({ status: "success", message: "" }, data);
        setMessage(result.message);
        if (result.status !== "success") return;
        if (result.revision) setRevision(result.revision);
        if (operation === "save" || operation === "create") setDirty(false);
        if ((operation === "create" || operation === "duplicate") && result.id) router.push(`/landing-pages/${result.id}`);
        else router.refresh();
      } catch { setMessage("連線中斷，內容仍保留，請稍後再試。"); }
    });
  }
  const inputClass = "mt-1 min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const secondaryButtonClass = "min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-40";
  const blocked = pending || !valid || !name.trim() || !slug.trim();
  return <div className="grid gap-5">
    <section aria-labelledby="landing-page-settings" className="rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Page setup</p><h2 id="landing-page-settings" className="mt-1 text-lg font-bold tracking-tight text-slate-950">頁面設定</h2><p className="mt-1 text-sm text-slate-500">先確認頁面資訊，再開始編排招生內容。</p></div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">{page ? (page.status === "published" ? "已發布頁面" : "草稿頁面") : "新頁面"}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid min-w-0 content-start gap-0.5 text-sm font-medium text-slate-700">頁面名稱<input disabled={pending} aria-label="頁面名稱" className={inputClass} value={name} maxLength={160} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></label>
        <label className="grid min-w-0 content-start gap-0.5 text-sm font-medium text-slate-700"><span>公開網址 <span className="font-normal text-slate-400">/lp/</span></span><input disabled={pending} aria-label="公開網址 slug" className={inputClass} value={slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="webinar-intro" maxLength={100} onChange={(e) => { setSlug(e.target.value); setDirty(true); }} /></label>
        <label className="grid min-w-0 content-start gap-0.5 text-sm font-medium text-slate-700">預設報名表<select disabled={pending} aria-label="預設報名表" className={inputClass} value={formId} onChange={(e) => { setFormId(e.target.value); setDirty(true); }}><option value="">不指定</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
        <label className="grid min-w-0 content-start gap-0.5 text-sm font-medium text-slate-700">活動場次<select disabled={pending} aria-label="活動場次" className={inputClass} value={liveId} onChange={(e) => { setLiveId(e.target.value); setDirty(true); }}><option value="">由報名表提供場次選擇</option>{lives.map((live) => <option key={live.id} value={live.id}>{live.title}</option>)}</select></label>
      </div>
    </section>
    {!forms.length ? <p className="rounded-lg bg-amber-50 p-3 text-sm">目前沒有啟用中的報名表。可先建立頁面內容，再到報名管理建立表單。</p> : null}
    <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
      <button disabled={blocked} onClick={() => run(page ? "save" : "create")} className="min-h-10 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "處理中…" : "儲存草稿"}</button>
      <button disabled={pending || !valid} onClick={() => setPreview(!preview)} className={secondaryButtonClass}>{preview ? "返回編輯" : "預覽草稿"}</button>
      {page ? <>
        <button disabled={blocked || dirty} onClick={() => run("publish")} className={secondaryButtonClass}>發布已儲存草稿</button>
        <button disabled={pending || dirty} onClick={() => run("duplicate")} className={secondaryButtonClass}>複製頁面</button>
        {page.status === "published" ? <><a href={`/lp/${page.slug}`} target="_blank" rel="noreferrer" className={secondaryButtonClass}>查看公開頁 ↗</a><button disabled={pending || dirty} onClick={() => run("unpublish")} className={secondaryButtonClass}>取消發布</button></> : null}
        {page.versions.length ? <><select aria-label="歷史發布版本" className={secondaryButtonClass} value={version} onChange={(e) => setVersion(e.target.value)}>{page.versions.map((v) => <option key={v.version} value={v.version}>版本 {v.version}</option>)}</select><button disabled={pending || dirty || !version} onClick={() => run("rollback")} className={secondaryButtonClass}>還原此版本為草稿</button></> : null}
      </> : <button disabled={pending} className={secondaryButtonClass} onClick={() => { setContent(createLandingPageContent("blank")); setDirty(true); }}>使用空白頁</button>}
      <span role="status" className="ml-auto text-xs font-medium text-slate-500">{dirty ? "● 有尚未儲存的變更" : "✓ 草稿已儲存"}</span>
    </div>
    {message ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">{message}</p> : null}
    {preview ? <LandingPageRenderer content={content} context={{ forms, live: lives.find((live) => live.id === liveId) }} /> : null}
    <div className={preview ? "hidden" : ""}><Editor content={content} forms={forms} live={lives.find((live) => live.id === liveId)} disabled={pending} onValidityChange={setValid} onChange={(next) => { if (JSON.stringify(next) !== JSON.stringify(content)) { setContent(next); setDirty(true); } }} /></div>
  </div>;
}


