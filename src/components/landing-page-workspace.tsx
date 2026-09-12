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
  const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  const blocked = pending || !valid || !name.trim() || !slug.trim();
  return <div className="grid gap-4">
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="grid gap-1 text-sm">頁面名稱<input className={inputClass} value={name} maxLength={160} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></label>
      <label className="grid gap-1 text-sm">公開網址 /lp/<input className={inputClass} value={slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="webinar-intro" maxLength={100} onChange={(e) => { setSlug(e.target.value); setDirty(true); }} /></label>
      <label className="grid gap-1 text-sm">預設報名表<select className={inputClass} value={formId} onChange={(e) => { setFormId(e.target.value); setDirty(true); }}><option value="">不指定</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">活動場次<select className={inputClass} value={liveId} onChange={(e) => { setLiveId(e.target.value); setDirty(true); }}><option value="">由報名表提供場次選擇</option>{lives.map((live) => <option key={live.id} value={live.id}>{live.title}</option>)}</select></label>
    </div>
    {!forms.length ? <p className="rounded-lg bg-amber-50 p-3 text-sm">目前沒有啟用中的報名表。可先建立頁面內容，再到報名管理建立表單。</p> : null}
    <div className="flex flex-wrap items-center gap-3">
      <button disabled={blocked} onClick={() => run(page ? "save" : "create")} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-40">{pending ? "處理中…" : "儲存草稿"}</button>
      <button disabled={pending || !valid} onClick={() => setPreview(!preview)} className={inputClass}>{preview ? "返回編輯" : "預覽草稿"}</button>
      {page ? <>
        <button disabled={blocked || dirty} onClick={() => run("publish")} className={inputClass}>發布已儲存草稿</button>
        <button disabled={pending || dirty} onClick={() => run("duplicate")} className={inputClass}>複製頁面</button>
        {page.status === "published" ? <><a href={`/lp/${page.slug}`} target="_blank" rel="noreferrer" className={inputClass}>查看公開頁</a><button disabled={pending || dirty} onClick={() => run("unpublish")} className={inputClass}>取消發布</button></> : null}
        {page.versions.length ? <><select aria-label="歷史發布版本" className={inputClass} value={version} onChange={(e) => setVersion(e.target.value)}>{page.versions.map((v) => <option key={v.version} value={v.version}>版本 {v.version}</option>)}</select><button disabled={pending || dirty || !version} onClick={() => run("rollback")} className={inputClass}>還原此版本為草稿</button></> : null}
      </> : <button disabled={pending} className={inputClass} onClick={() => { setContent(createLandingPageContent("blank")); setDirty(true); }}>使用空白頁</button>}
      <span className="text-sm text-slate-500">{dirty ? "有尚未儲存的變更" : "草稿已儲存"}</span>
    </div>
    {message ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">{message}</p> : null}
    {preview ? <LandingPageRenderer content={content} context={{ forms, live: lives.find((live) => live.id === liveId) }} /> : <Editor content={content} forms={forms} live={lives.find((live) => live.id === liveId)} disabled={pending} onValidityChange={setValid} onChange={(next) => { if (JSON.stringify(next) !== JSON.stringify(content)) { setContent(next); setDirty(true); } }} />}
  </div>;
}


