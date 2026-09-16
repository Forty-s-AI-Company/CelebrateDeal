"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelPopupPreview } from "@/components/landing-pages/funnel-popup-preview";
import { landingPageAction } from "@/app/actions/landing-page-actions";
import type { LandingPageContent, LandingPageRenderContext } from "@/lib/landing-page-content";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import type { LandingPageEditorPage, LandingPageStoredContent } from "@/lib/landing-page-service";
import type { FunnelGoal } from "@/components/landing-pages/funnel-goal-picker";
import { createFunnelFlow } from "@/lib/funnel-flow";

const Editor = dynamic(() => import("@/components/landing-pages/landing-page-editor").then((module) => module.LandingPageEditor), { ssr: false, loading: () => <p className="p-8">正在載入編輯器…</p> });
const FunnelEditor = dynamic(() => import("@/components/landing-pages/funnel-page-editor").then((module) => module.FunnelPageEditor), { ssr: false, loading: () => <p className="p-8">正在載入 Funnel 編輯器…</p> });
type PageInput = Omit<LandingPageEditorPage, "publishedAt" | "updatedAt" | "versions"> & { versions: Array<{ version: number }> };
function starterDocument(goal: Exclude<FunnelGoal, "webinar"> = "custom"): PageDocument {
  const leaf = (id: string, type: FunnelNode["type"], props: Record<string, unknown>): FunnelNode => ({ schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {} });
  const document = createEmptyPageDocument("funnel-page", "新的 Funnel 頁面");
  if (goal === "custom") return document;
  const copy = goal === "audience" ? { headline: "加入名單，取得最新消息", text: "留下 Email，我們會把重要內容寄給你。", button: "加入名單" } : { headline: "完成你的訂購", text: "確認方案內容，再前往安全的付款流程。", button: "選擇方案" };
  document.root = [{ schemaVersion: 1, id: "section_main", type: "section", props: {}, style: { padding: 32 }, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "row_main", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "column_main", type: "columns_2", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [leaf("headline_main", "headline", { text: copy.headline, level: "h1" }), leaf("text_main", "text", { text: copy.text }), leaf("button_main", "button", { label: copy.button })] }] }] }];
  return document;
}
function isPageDocument(content: LandingPageStoredContent): content is PageDocument { return "root" in content && "settings" in content; }
function WorkspacePreview({ content, forms, live }: { content: LandingPageStoredContent; forms: LandingPageRenderContext["forms"]; live?: LandingPageRenderContext["live"] }) {
  if (isPageDocument(content)) return <><FunnelPageDocumentRenderer document={content} viewport="desktop" mode="preview" />{content.popups.filter((popup) => !popup.pageId || popup.pageId === content.id).map((popup) => <FunnelPopupPreview key={popup.id} document={content} popupId={popup.id} viewport="desktop" />)}</>;
  return <LandingPageRenderer content={content} context={{ forms, live }} />;
}
function WorkspaceEditor({ content, forms, live, pending, revision, onLegacyChange, onDocumentChange, onValidityChange }: {
  content: LandingPageStoredContent; forms: LandingPageRenderContext["forms"]; live?: LandingPageRenderContext["live"];
  pending: boolean; revision: number; onLegacyChange: (content: LandingPageContent) => void; onDocumentChange: (content: PageDocument) => void; onValidityChange: (valid: boolean) => void;
}) {
  if (isPageDocument(content)) return <FunnelEditor key={`${content.id}-${revision}`} document={content} disabled={pending} onChange={onDocumentChange} />;
  return <Editor content={content} forms={forms} live={live} disabled={pending} onValidityChange={onValidityChange} onChange={onLegacyChange} />;
}
// Optional persisted and create-flow inputs are normalized at this single boundary.
// eslint-disable-next-line complexity
function initialWorkspace(page: PageInput | undefined, forms: LandingPageRenderContext["forms"], config?: { goal?: Exclude<FunnelGoal, "webinar">; name?: string; slug?: string; currency?: string }) {
  const content = page?.content ?? starterDocument(config?.goal);
  if (!page && isPageDocument(content) && config?.goal && config.name && config.slug) {
    content.flow = createFunnelFlow({ id: "funnel_flow", name: config.name, goal: config.goal, domain: config.slug, currency: config.currency ?? "TWD" }) ?? undefined;
  }
  return {
    content,
    name: page?.name ?? config?.name ?? "新的 Funnel 頁面", slug: page?.slug ?? config?.slug ?? "",
    formId: page?.formId ?? forms[0]?.id ?? "", liveId: page?.liveId ?? "",
    revision: page?.revision ?? 1, valid: Boolean(page?.content ?? true),
    version: String(page?.versions[0]?.version ?? ""),
  };
}
/** The workspace owns persistence; Puck owns only the current editing session. */
export function LandingPageWorkspace({ page, forms, lives, csrfToken, csrfName, initialGoal, initialName, initialSlug, initialCurrency }: { page?: PageInput; forms: LandingPageRenderContext["forms"]; lives: NonNullable<LandingPageRenderContext["live"]>[]; csrfToken: string; csrfName: string; initialGoal?: Exclude<FunnelGoal, "webinar">; initialName?: string; initialSlug?: string; initialCurrency?: string }) {
  const router = useRouter();
  const [initial] = useState(() => initialWorkspace(page, forms, { goal: initialGoal, name: initialName, slug: initialSlug, currency: initialCurrency }));
  const [content, setContent] = useState<LandingPageStoredContent>(initial.content);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  function exitEditor() {
    if (dirty && !window.confirm("這個頁面還有尚未儲存的變更。確定要離開並捨棄變更嗎？")) return;
    router.push("/landing-pages");
  }
  const inputClass = "mt-1 min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const secondaryButtonClass = "min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-40";
  const blocked = pending || !valid || !name.trim() || !slug.trim();
  return <div className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-slate-100">
    <header className="z-30 flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm md:px-5" aria-label="Funnel 編輯器工具列">
      <button type="button" onClick={exitEditor} className={secondaryButtonClass}>← 返回</button>
      <div className="hidden h-8 w-px bg-slate-200 sm:block" />
      <p className="mr-auto min-w-0 truncate text-sm font-bold text-slate-900">{name || "未命名 Funnel 頁面"}</p>
      <button type="button" disabled={!isPageDocument(content)} className={secondaryButtonClass} onClick={() => window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "undo" }))}>Undo</button>
      <button type="button" disabled={!isPageDocument(content)} className={secondaryButtonClass} onClick={() => window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "redo" }))}>Redo</button>
      <button type="button" disabled={!isPageDocument(content)} className={secondaryButtonClass} title={isPageDocument(content) ? "管理本頁 Popups" : "舊版頁面需先轉換後使用 Popup"} onClick={() => document.getElementById("funnel-popups-tab")?.click()}>Popups</button>
      <button type="button" aria-pressed={settingsOpen} onClick={() => { setSettingsOpen((value) => !value); document.getElementById("funnel-page-settings-tab")?.click(); }} className={secondaryButtonClass}>頁面設定</button>
      <button type="button" disabled={!isPageDocument(content)} className={secondaryButtonClass} onClick={() => window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "desktop" }))}>桌機</button>
      <button type="button" disabled={!isPageDocument(content)} className={secondaryButtonClass} onClick={() => window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "mobile" }))}>手機</button>
      <button type="button" disabled={pending || !valid} onClick={() => setPreview((value) => !value)} className={secondaryButtonClass}>{preview ? "返回編輯" : "Preview"}</button>
      <button type="button" disabled={blocked} onClick={() => run(page ? "save" : "create")} className="min-h-10 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "儲存中…" : "Save"}</button>
      <button type="button" onClick={exitEditor} className="min-h-10 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Exit</button>
      <span role="status" className={`w-full text-right text-xs font-semibold sm:w-auto ${dirty ? "text-amber-700" : "text-emerald-700"}`}>{dirty ? "● 尚未儲存" : "✓ 已儲存"}</span>
    </header>
    <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
    <section aria-labelledby="landing-page-settings" className={`${settingsOpen ? "block" : "hidden"} mb-5 rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] md:p-6`}>
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
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
      <button disabled={blocked} onClick={() => run(page ? "save" : "create")} className="min-h-10 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "處理中…" : "儲存草稿"}</button>
      <button disabled={pending || !valid} onClick={() => setPreview(!preview)} className={secondaryButtonClass}>{preview ? "返回編輯" : "預覽草稿"}</button>
      {page ? <>
        <button disabled={blocked || dirty} onClick={() => run("publish")} className={secondaryButtonClass}>發布已儲存草稿</button>
        <button disabled={pending || dirty} onClick={() => run("duplicate")} className={secondaryButtonClass}>複製頁面</button>
        {page.status === "published" ? <><a href={`/lp/${page.slug}`} target="_blank" rel="noreferrer" className={secondaryButtonClass}>查看公開頁 ↗</a><button disabled={pending || dirty} onClick={() => run("unpublish")} className={secondaryButtonClass}>取消發布</button></> : null}
        {page.versions.length ? <><select aria-label="歷史發布版本" className={secondaryButtonClass} value={version} onChange={(e) => setVersion(e.target.value)}>{page.versions.map((v) => <option key={v.version} value={v.version}>版本 {v.version}</option>)}</select><button disabled={pending || dirty || !version} onClick={() => run("rollback")} className={secondaryButtonClass}>還原此版本為草稿</button></> : null}
      </> : <button disabled={pending} className={secondaryButtonClass} onClick={() => { setContent(createEmptyPageDocument("funnel-page", name)); setDirty(true); }}>使用空白頁</button>}
      <span role="status" className="ml-auto text-xs font-medium text-slate-500">{dirty ? "● 有尚未儲存的變更" : "✓ 草稿已儲存"}</span>
    </div>
    {message ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">{message}</p> : null}
    {preview ? <WorkspacePreview content={content} forms={forms} live={lives.find((live) => live.id === liveId)} /> : null}
    <div className={preview ? "hidden" : "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"}><WorkspaceEditor content={content} forms={forms} live={lives.find((live) => live.id === liveId)} pending={pending} revision={revision} onValidityChange={setValid} onDocumentChange={(next) => { setContent(next); setDirty(true); }} onLegacyChange={(next) => { if (JSON.stringify(next) !== JSON.stringify(content)) { setContent(next); setDirty(true); } }} /></div>
    </div>
  </div>;
}


