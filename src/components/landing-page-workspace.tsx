"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { LandingPageRenderer } from "@/components/landing-pages/landing-page-renderer";
import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelPopupPreview } from "@/components/landing-pages/funnel-popup-preview";
import { landingPageAction } from "@/app/actions/landing-page-actions";
import type { LandingPageContent, LandingPageRenderContext } from "@/lib/landing-page-content";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import type { FunnelWebinarResources, LandingPageEditorPage, LandingPageStoredContent } from "@/lib/landing-page-service";
import type { FunnelGoal } from "@/components/landing-pages/funnel-goal-picker";
import { getActiveFunnelStepPage, type FunnelStepPages, type FunnelStepPersistenceMutation } from "@/lib/funnel-step-pages";
import { FunnelStepPagesEditor } from "@/components/landing-pages/funnel-step-pages-editor";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { commerceViewForBinding, type FunnelCommerceProduct } from "@/lib/funnel-commerce";

import { FunnelWebinarSettings } from "@/components/landing-pages/funnel-webinar-settings";
import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";

const Editor = dynamic(() => import("@/components/landing-pages/landing-page-editor").then((module) => module.LandingPageEditor), { ssr: false, loading: () => <p className="p-8">正在載入編輯器…</p> });
const FunnelEditor = dynamic(() => import("@/components/landing-pages/funnel-page-editor").then((module) => module.FunnelPageEditor), { ssr: false, loading: () => <p className="p-8">正在載入 Funnel 編輯器…</p> });
type PageInput = Omit<LandingPageEditorPage, "publishedAt" | "updatedAt" | "versions"> & { versions: Array<{ version: number }> };
function currentPublishedVersion(version: string, page?: PageInput): string {
  return version || String(page?.versions[0]?.version ?? "");
}
function starterDocument(goal: FunnelGoal = "custom"): PageDocument {
  const leaf = (id: string, type: FunnelNode["type"], props: Record<string, unknown>): FunnelNode => ({ schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {} });
  const document = createEmptyPageDocument("funnel-page", "新的 Funnel 頁面");
  if (goal === "custom" || goal === "webinar") return document;
  const copy = goal === "audience" ? { headline: "加入名單，取得最新消息", text: "留下 Email，我們會把重要內容寄給你。", button: "加入名單" } : { headline: "完成你的訂購", text: "確認方案內容，再前往安全的付款流程。", button: "選擇方案" };
  document.root = [{ schemaVersion: 1, id: "section_main", type: "section", props: {}, style: { padding: 32 }, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "row_main", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "column_main", type: "columns_2", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [leaf("headline_main", "headline", { text: copy.headline, level: "h1" }), leaf("text_main", "text", { text: copy.text }), leaf("button_main", "button", { label: copy.button })] }] }] }];
  return document;
}
function isPageDocument(content: LandingPageStoredContent): content is PageDocument { return "root" in content && "settings" in content; }
function isFunnelStepPages(content: LandingPageStoredContent): content is FunnelStepPages { return "pages" in content && "activeStepId" in content && "flow" in content; }
function supportsFunnelCommands(content: LandingPageStoredContent): boolean { return isPageDocument(content) || isFunnelStepPages(content); }
function workspaceBlocked(input: { pending: boolean; stepPending: boolean; valid: boolean; name: string; slug: string }) {
  return input.pending || input.stepPending || !input.valid || !input.name.trim() || !input.slug.trim();
}
function saveStateLabel(dirty: boolean, stepPending: boolean) {
  if (stepPending) return "● 步驟儲存中";
  return dirty ? "● 尚未儲存" : "✓ 已儲存";
}
function WorkspacePreview({ content, forms, live, commerceProducts, viewport }: { content: LandingPageStoredContent; forms: LandingPageRenderContext["forms"]; live?: LandingPageRenderContext["live"]; commerceProducts: FunnelCommerceProduct[]; viewport: "desktop" | "mobile" }) {
  if (isFunnelStepPages(content)) {
    const active = getActiveFunnelStepPage(content);
    return active ? <><FunnelPageDocumentRenderer document={active.page} commerce={commerceViewForBinding(active.page.commerce, commerceProducts)} viewport={viewport} mode="preview" />{active.page.popups.filter((popup) => !popup.pageId || popup.pageId === active.page.id).map((popup) => <FunnelPopupPreview key={popup.id} document={active.page} popupId={popup.id} viewport={viewport} />)}</> : <p role="alert">無法預覽目前 Funnel step。</p>;
  }
  if (isPageDocument(content)) return <><FunnelPageDocumentRenderer document={content} viewport="desktop" mode="preview" />{content.popups.filter((popup) => !popup.pageId || popup.pageId === content.id).map((popup) => <FunnelPopupPreview key={popup.id} document={content} popupId={popup.id} viewport="desktop" />)}</>;
  return <LandingPageRenderer content={content} context={{ forms, live }} />;
}
function WorkspaceEditor({ content, forms, live, pending, revision, onLegacyChange, onDocumentChange, onStepMutation, onValidityChange, commerceProducts }: {
  content: LandingPageStoredContent; forms: LandingPageRenderContext["forms"]; live?: LandingPageRenderContext["live"];
  commerceProducts: FunnelCommerceProduct[];
  pending: boolean; revision: number; onLegacyChange: (content: LandingPageContent) => void; onDocumentChange: (content: PageDocument | FunnelStepPages) => void; onStepMutation: (content: FunnelStepPages, mutation: FunnelStepPersistenceMutation) => void; onValidityChange: (valid: boolean) => void;
}) {
  if (isFunnelStepPages(content)) return <FunnelStepPagesEditor state={content} commerceProducts={commerceProducts} disabled={pending} onChange={onDocumentChange} onStepMutation={onStepMutation} />;
  if (isPageDocument(content)) return <FunnelEditor key={`${content.id}-${revision}`} document={content} disabled={pending} onChange={onDocumentChange} />;
  return <Editor content={content} forms={forms} live={live} disabled={pending} onValidityChange={onValidityChange} onChange={onLegacyChange} />;
}
function CurrentWorkspacePreview({ show, content, slug, resource, viewport, commerceProducts, forms, live }: {
  show: boolean; content: LandingPageStoredContent; slug: string; resource: ReturnType<typeof resolveWebinarResource>;
  viewport: "desktop" | "mobile"; commerceProducts: FunnelCommerceProduct[]; forms: LandingPageRenderContext["forms"]; live?: LandingPageRenderContext["live"];
}) {
  if (!show) return null;
  if (isWebinar(content)) return <FunnelWebinarExperience state={content} stepId={content.activeStepId} slug={slug} resource={resource} preview viewport={viewport} />;
  return <WorkspacePreview content={content} commerceProducts={commerceProducts} viewport={viewport} forms={forms} live={live} />;
}
// Optional persisted and create-flow inputs are normalized at this single boundary.
// eslint-disable-next-line complexity
function initialWorkspace(page: PageInput | undefined, forms: LandingPageRenderContext["forms"], config?: { goal?: FunnelGoal; name?: string; slug?: string; currency?: string }) {
  let content = page?.content ?? starterDocument(config?.goal);
  if (!page && isPageDocument(content) && config?.goal && config.name && config.slug) {
    content = createGoalFunnelStepPages({ id: "funnel_flow", name: config.name, goal: config.goal, domain: config.slug, currency: config.currency ?? "TWD" }) ?? content;
  }
  return {
    content, published: page?.status === "published",
    name: page?.name ?? config?.name ?? "新的 Funnel 頁面", slug: page?.slug ?? config?.slug ?? "",
    formId: page?.formId ?? forms[0]?.id ?? "", liveId: page?.liveId ?? "",
    revision: page?.revision ?? 1, valid: Boolean(page?.content ?? true),
    version: String(page?.versions[0]?.version ?? ""),
  };
}
/** The workspace owns persistence; Puck owns only the current editing session. */
function normalizeCommerceProducts(products?: FunnelCommerceProduct[]) { return products ?? []; }
export function LandingPageWorkspace({ page, forms, lives, csrfToken, csrfName, initialGoal, initialName, initialSlug, initialCurrency, webinarResources, commerceProducts: products }: { commerceProducts?: FunnelCommerceProduct[]; webinarResources?: FunnelWebinarResources; page?: PageInput; forms: LandingPageRenderContext["forms"]; lives: NonNullable<LandingPageRenderContext["live"]>[]; csrfToken: string; csrfName: string; initialGoal?: FunnelGoal; initialName?: string; initialSlug?: string; initialCurrency?: string }) {
  const commerceProducts = normalizeCommerceProducts(products);
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
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [stepPending, setStepPending] = useState(false);
  const inFlight = useRef(false);
  const revisionRef = useRef(initial.revision);
  const stepQueue = useRef<FunnelStepPersistenceMutation[]>([]);
  const stepSaving = useRef(false);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [published, setPublished] = useState(initial.published);
  const [version, setVersion] = useState(initial.version);
  const selectedVersion = currentPublishedVersion(version, page);
  const [preview, setPreview] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<"desktop" | "mobile">("desktop");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  useEffect(() => () => { if (stepTimer.current) clearTimeout(stepTimer.current); }, []);

  async function flushStepQueue() {
    if (!page || stepSaving.current || stepQueue.current.length === 0) return;
    stepSaving.current = true;
    setMessage("正在自動儲存步驟…");
    while (stepQueue.current.length > 0) {
      const mutation = stepQueue.current.shift()!;
      const data = new FormData();
      data.set(csrfName, csrfToken);
      data.set("operation", "save_steps");
      data.set("id", page.id);
      data.set("revision", String(revisionRef.current));
      data.set("mutation", JSON.stringify(mutation));
      try {
        const result = await landingPageAction({ status: "success", message: "" }, data);
        if (result.status !== "success" || !result.revision) {
          stepQueue.current = [];
          setDirty(true);
          setMessage(result.message || "步驟自動儲存失敗；畫面內容仍保留，請重新整理後重試。");
          break;
        }
        revisionRef.current = result.revision;
        setRevision(result.revision);
        setMessage("步驟已自動儲存。");
      } catch {
        stepQueue.current = [];
        setDirty(true);
        setMessage("連線中斷，步驟變更仍保留在畫面上，請恢復連線後手動儲存。");
        break;
      }
    }
    stepSaving.current = false;
    setStepPending(false);
  }

  function queueStepMutation(next: FunnelStepPages, mutation: FunnelStepPersistenceMutation) {
    setContent(next);
    if (!page) { setDirty(true); return; }
    setStepPending(true);
    const debounced = mutation.type === "rename" || mutation.type === "set_path";
    if (debounced) {
      const last = stepQueue.current.at(-1);
      if (last?.type === mutation.type && last.stepId === mutation.stepId) stepQueue.current[stepQueue.current.length - 1] = mutation;
      else stepQueue.current.push(mutation);
      if (stepTimer.current) clearTimeout(stepTimer.current);
      stepTimer.current = setTimeout(() => { stepTimer.current = null; void flushStepQueue(); }, 700);
      return;
    }
    stepQueue.current.push(mutation);
    void flushStepQueue();
  }

  function run(operation: string) {
    if (inFlight.current || stepPending) return;
    inFlight.current = true;
    setPending(true);
    const data = new FormData();
    data.set(csrfName, csrfToken);
    data.set("operation", operation);
    if (page) data.set("id", page.id);
    data.set("revision", String(revision));
    data.set("name", name); data.set("slug", slug); data.set("formId", formId); data.set("liveId", liveId);
    data.set("content", JSON.stringify(content)); data.set("version", selectedVersion);
    startTransition(async () => {
      try {
        const result = await landingPageAction({ status: "success", message: "" }, data);
        setMessage(result.message);
        if (result.status !== "success") return;
        if (result.revision) { revisionRef.current = result.revision; setRevision(result.revision); }
        if (operation === "publish") setPublished(true);
        if (operation === "unpublish") setPublished(false);
        if (operation === "save" || operation === "create") setDirty(false);
        if ((operation === "create" || operation === "duplicate") && result.id) router.push(`/landing-pages/${result.id}`);
        // Restoring a historical snapshot intentionally starts a fresh editing
        // session. Ordinary save/publish must preserve current UI and history.
        if (operation === "rollback") window.location.reload();
        if (operation === "delete") router.push("/landing-pages");
        // The action already revalidates this route and returns its updated RSC
        // tree. A second refresh inside the same transition can keep Save pending.
      } catch { setMessage("連線中斷，內容仍保留，請稍後再試。"); }
      finally {
        inFlight.current = false;
        setPending(false);
      }
    });
  }
  function exitEditor() {
    const leavingUnsaved = dirty || stepPending;
    if (leavingUnsaved && !window.confirm("這個頁面還有尚未儲存的變更。確定要離開並捨棄變更嗎？")) return;
    router.push("/landing-pages");
  }
  const inputClass = "mt-1 min-h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-600 focus:ring-2 focus:ring-blue-100";
  const secondaryButtonClass = "min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-40";
  const selectedLive = lives.find((live) => live.id === liveId);
  const webinarResource = resolveWebinarResource(webinarResources, lives, liveId, formId);
  const blocked = workspaceBlocked({ pending, stepPending, valid, name, slug });
  return <div className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-slate-100">
    <header className="z-30 flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 shadow-sm md:px-5" aria-label="Funnel 編輯器工具列">
      <button type="button" onClick={exitEditor} className={secondaryButtonClass}>← 返回</button>
      <div className="hidden h-8 w-px bg-slate-200 sm:block" />
      <p className="mr-auto min-w-0 truncate text-sm font-bold text-slate-900">{name}</p>
      <button type="button" disabled={!supportsFunnelCommands(content)} className={secondaryButtonClass} onClick={() => window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "undo" }))}>Undo</button>
      <button type="button" disabled={!supportsFunnelCommands(content)} className={secondaryButtonClass} onClick={() => window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "redo" }))}>Redo</button>
      <button type="button" disabled={!supportsFunnelCommands(content)} className={secondaryButtonClass} title={supportsFunnelCommands(content) ? "管理本頁 Popups" : "舊版頁面需先轉換後使用 Popup"} onClick={() => document.getElementById("funnel-popups-tab")?.click()}>Popups</button>
      <button type="button" aria-pressed={settingsOpen} onClick={() => { setSettingsOpen((value) => !value); document.getElementById("funnel-page-settings-tab")?.click(); }} className={secondaryButtonClass}>頁面設定</button>
      <button type="button" disabled={!supportsFunnelCommands(content)} className={secondaryButtonClass} onClick={() => { setPreviewViewport("desktop"); window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "desktop" })); }}>桌機</button>
      <button type="button" disabled={!supportsFunnelCommands(content)} className={secondaryButtonClass} onClick={() => { setPreviewViewport("mobile"); window.dispatchEvent(new CustomEvent("celebratedeal:funnel-command", { detail: "mobile" })); }}>手機</button>
      <button type="button" disabled={pending || !valid} onClick={() => setPreview((value) => !value)} className={secondaryButtonClass}>{preview ? "返回編輯" : "Preview"}</button>
      <button type="button" disabled={blocked} onClick={() => run(page ? "save" : "create")} className="min-h-10 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "儲存中…" : "Save"}</button>
      <button type="button" onClick={exitEditor} className="min-h-10 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Exit</button>
      <span role="status" className={`w-full text-right text-xs font-semibold sm:w-auto ${dirty || stepPending ? "text-amber-700" : "text-emerald-700"}`}>{saveStateLabel(dirty, stepPending)}</span>
    </header>
    <div className="min-h-0 flex-1 overflow-auto p-3 md:p-5">
    <section aria-labelledby="landing-page-settings" className={`${settingsOpen ? "block" : "hidden"} mb-5 rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/60 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] md:p-6`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Page setup</p><h2 id="landing-page-settings" className="mt-1 text-lg font-bold tracking-tight text-slate-950">頁面設定</h2><p className="mt-1 text-sm text-slate-500">先確認頁面資訊，再開始編排招生內容。</p></div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">{page ? (published ? "已發布頁面" : "草稿頁面") : "新頁面"}</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid min-w-0 content-start gap-0.5 text-sm font-medium text-slate-700">頁面名稱<input disabled={pending} aria-label="頁面名稱" className={inputClass} value={name} maxLength={160} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></label>
        <label className="grid min-w-0 content-start gap-0.5 text-sm font-medium text-slate-700"><span>公開網址 <span className="font-normal text-slate-400">/lp/</span></span><input disabled={pending} aria-label="公開網址 slug" className={inputClass} value={slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="webinar-intro" maxLength={100} onChange={(e) => { setSlug(e.target.value); setDirty(true); }} /></label>
        <label className="grid min-w-0 content-start gap-0.5 text-sm font-medium text-slate-700">預設報名表<select disabled={pending} aria-label="預設報名表" className={inputClass} value={formId} onChange={(e) => { setFormId(e.target.value); setDirty(true); }}><option value="">不指定</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
        <label className="grid min-w-0 content-start gap-0.5 text-sm font-medium text-slate-700">活動場次<select disabled={pending} aria-label="活動場次" className={inputClass} value={liveId} onChange={(e) => { setLiveId(e.target.value); setDirty(true); }}><option value="">由報名表提供場次選擇</option>{lives.map((live) => <option key={live.id} value={live.id}>{live.title}</option>)}</select></label>
      </div>
    </section>
    <WebinarWorkspaceSettings content={content} pending={pending} resources={webinarResources} lives={lives} liveId={liveId} onValidityChange={setValid} onChange={(next) => { setContent(next); setDirty(true); }} onSelect={(id, form) => { setLiveId(id); if (form) setFormId(form); setDirty(true); }} />
    {!forms.length ? <p className="rounded-lg bg-amber-50 p-3 text-sm">目前沒有啟用中的報名表。可先建立頁面內容，再到報名管理建立表單。</p> : null}
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
      <button disabled={blocked} onClick={() => run(page ? "save" : "create")} className="min-h-10 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "處理中…" : "儲存草稿"}</button>
      <button disabled={pending || !valid} onClick={() => setPreview(!preview)} className={secondaryButtonClass}>{preview ? "返回編輯" : "預覽草稿"}</button>
      {page ? <>
        <button disabled={blocked || dirty} onClick={() => run("publish")} className={secondaryButtonClass}>發布已儲存草稿</button>
        <button disabled={pending || stepPending || dirty} onClick={() => run("duplicate")} className={secondaryButtonClass}>複製頁面</button>
        <button disabled={pending || stepPending || dirty} onClick={() => {
          if (window.confirm("確定要永久刪除這個 Funnel、草稿與所有發布歷史嗎？此操作無法復原。")) run("delete");
        }} className={`${secondaryButtonClass} border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50`}>刪除 Funnel</button>
        {published ? <><a href={`/lp/${slug}`} target="_blank" rel="noreferrer" className={secondaryButtonClass}>查看公開頁 ↗</a><button disabled={pending || stepPending || dirty} onClick={() => run("unpublish")} className={secondaryButtonClass}>取消發布</button></> : null}
        {page.versions.length ? <><select aria-label="歷史發布版本" className={secondaryButtonClass} value={selectedVersion} onChange={(e) => setVersion(e.target.value)}>{page.versions.map((v) => <option key={v.version} value={v.version}>版本 {v.version}</option>)}</select><button disabled={pending || stepPending || dirty || !selectedVersion} onClick={() => run("rollback")} className={secondaryButtonClass}>還原此版本為草稿</button></> : null}
      </> : <button disabled={pending} className={secondaryButtonClass} onClick={() => { setContent(createEmptyPageDocument("funnel-page", name)); setDirty(true); }}>使用空白頁</button>}
      <span role="status" className="ml-auto text-xs font-medium text-slate-500">{dirty ? "● 有尚未儲存的變更" : "✓ 草稿已儲存"}</span>
    </div>
    {message ? <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">{message}</p> : null}
    <CurrentWorkspacePreview show={preview} content={content} slug={slug} resource={webinarResource} viewport={previewViewport} commerceProducts={commerceProducts} forms={forms} live={selectedLive} />
    <div className={preview ? "hidden" : "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"}><WorkspaceEditor content={content} commerceProducts={commerceProducts} forms={forms} live={lives.find((live) => live.id === liveId)} pending={pending} revision={revision} onValidityChange={setValid} onStepMutation={queueStepMutation} onDocumentChange={(next) => { setContent(next); setDirty(true); }} onLegacyChange={(next) => { if (JSON.stringify(next) !== JSON.stringify(content)) { setContent(next); setDirty(true); } }} /></div>
    </div>
  </div>;
}



function isWebinar(content: LandingPageStoredContent): content is FunnelStepPages {
  return isFunnelStepPages(content) && content.flow.goal === "webinar";
}
function resolveWebinarResource(resources: FunnelWebinarResources | undefined, lives: NonNullable<LandingPageRenderContext["live"]>[], liveId: string, formId: string) {
  const live = lives.find((item) => item.id === liveId);
  const video = resources?.lives.find((item) => item.id === liveId);
  const form = resources?.forms.find((item) => item.id === formId);
  if (!video?.videoReady || !video.videoId || !live || !form || live.formId !== formId) return undefined;
  return { form, live: { id: live.id, slug: live.slug, videoId: video.videoId, videoTitle: video.videoTitle ?? "活動影片" } };
}
function WebinarWorkspaceSettings({ content, pending, resources, lives, liveId, onValidityChange, onChange, onSelect }: {
  content: LandingPageStoredContent; pending: boolean; resources?: FunnelWebinarResources; lives: NonNullable<LandingPageRenderContext["live"]>[]; liveId: string;
  onValidityChange: (valid: boolean) => void; onChange: (state: FunnelStepPages) => void; onSelect: (id: string, formId?: string) => void;
}) {
  if (!isWebinar(content)) return null;
  const selected = resources?.lives.find((live) => live.id === liveId);
  return <>
    <FunnelWebinarSettings state={content} disabled={pending} onValidityChange={onValidityChange} onChange={onChange} />
    <label className="mb-4 grid gap-1 text-sm">來源影片<select disabled={pending} aria-label="來源影片" className="min-h-10 rounded-lg border px-3" value={selected?.id ?? ""} onChange={(event) => {
      const match = resources?.lives.find((live) => live.id === event.target.value && live.videoReady);
      if (match) onSelect(match.id, lives.find((item) => item.id === match.id)?.formId);
    }}><option value="">請選擇已綁定活動的可播放影片</option>{resources?.lives.filter((live) => live.videoReady && live.videoId).map((live) => <option key={live.id} value={live.id}>{live.videoTitle} · {lives.find((item) => item.id === live.id)?.title}</option>)}</select><span>沿用活動 Studio 的來源影片；選擇影片會同步選擇其活動。實際播放仍依 Live 排程與觀看權限。</span></label>
  </>;
}
