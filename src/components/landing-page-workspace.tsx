"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceEditor, type WorkspaceEditorContent } from "@/components/landing-pages/workspace-editor";
import { FunnelEditorAssetsProvider } from "@/components/landing-pages/funnel-editor-assets";
import { LegacyConversionNotice } from "@/components/landing-pages/legacy-conversion-notice";
import { FunnelRegistrationLinkProvider } from "@/components/landing-pages/funnel-registration-links";
import type { FunnelRegistrationLinks } from "@/lib/funnel-registration-action";
import { FunnelPageDocumentRenderer, type FunnelViewport } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelPopupPreview } from "@/components/landing-pages/funnel-popup-preview";
import { panelControl } from "@/components/landing-pages/funnel-editor-panels";
import type { FunnelEditorChrome, FunnelEditorSaveState } from "@/components/landing-pages/funnel-editor-chrome";
import { UnsavedChangesDialog } from "@/components/landing-pages/unsaved-changes-dialog";
import { PublicationChip } from "@/components/landing-page-publication-chip";
import { landingPageAction } from "@/app/actions/landing-page-actions";
import type { LandingPageRenderContext } from "@/lib/landing-page-content";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import type { FunnelWebinarResources, LandingPageEditorPage, LandingPagePublicationStatus, LandingPageStoredContent } from "@/lib/landing-page-service";
import type { FunnelGoal } from "@/components/landing-pages/funnel-goal-picker";
import { getActiveFunnelStepPage, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { commerceViewForBinding, type FunnelCommerceProduct } from "@/lib/funnel-commerce";
import { landingPageEditorHref } from "@/lib/landing-page-editor-href";
import { convertParsedLegacyLandingPage, type LegacyConversionIssue } from "@/lib/legacy-landing-page-converter";

import { FunnelWebinarSettings } from "@/components/landing-pages/funnel-webinar-settings";
import { FunnelWebinarExperience } from "@/components/landing-pages/funnel-webinar-experience";

type PageInput = Omit<LandingPageEditorPage, "publishedAt" | "updatedAt" | "versions"> & { versions: Array<{ version: number }> };
type Lives = NonNullable<LandingPageRenderContext["live"]>[];
type Notice = { text: string; tone: "info" | "error" };

function starterDocument(goal: FunnelGoal = "custom"): PageDocument {
  const leaf = (id: string, type: FunnelNode["type"], props: Record<string, unknown>): FunnelNode => ({ schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {} });
  const document = createEmptyPageDocument("funnel-page", "新的一頁式網站頁面");
  if (goal === "custom" || goal === "webinar") return document;
  const copy = goal === "audience" ? { headline: "加入名單，取得最新消息", text: "留下 Email，我們會把重要內容寄給你。", button: "加入名單" } : { headline: "完成你的訂購", text: "確認方案內容，再前往安全的付款流程。", button: "選擇方案" };
  document.root = [{ schemaVersion: 1, id: "section_main", type: "section", props: {}, style: { padding: 32 }, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "row_main", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "column_main", type: "columns_2", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [leaf("headline_main", "headline", { text: copy.headline, level: "h1" }), leaf("text_main", "text", { text: copy.text }), leaf("button_main", "button", { label: copy.button })] }] }] }];
  return document;
}
function isPageDocument(content: LandingPageStoredContent): content is PageDocument { return "root" in content && "settings" in content; }
function isFunnelStepPages(content: LandingPageStoredContent): content is FunnelStepPages { return "pages" in content && "activeStepId" in content && "flow" in content; }
function isStructured(content: LandingPageStoredContent): content is WorkspaceEditorContent { return isPageDocument(content) || isFunnelStepPages(content); }
function isWebinar(content: LandingPageStoredContent): content is FunnelStepPages {
  return isFunnelStepPages(content) && content.flow.goal === "webinar";
}
/** The dirty flag compares against the last persisted snapshot (EDT-SAVE-001), so undoing back to it is clean again. */
function workspaceSnapshot(input: { content: LandingPageStoredContent; name: string; slug: string; formId: string; liveId: string }) {
  return JSON.stringify([input.content, input.name, input.slug, input.formId, input.liveId]);
}

function WorkspacePreview({ content, commerceProducts, viewport }: { content: WorkspaceEditorContent; commerceProducts: FunnelCommerceProduct[]; viewport: FunnelViewport }) {
  if (isFunnelStepPages(content)) {
    const active = getActiveFunnelStepPage(content);
    return active ? <><FunnelPageDocumentRenderer document={active.page} commerce={commerceViewForBinding(active.page.commerce, commerceProducts)} viewport={viewport} mode="preview" />{active.page.popups.filter((popup) => !popup.pageId || popup.pageId === active.page.id).map((popup) => <FunnelPopupPreview key={popup.id} document={active.page} popupId={popup.id} viewport={viewport} />)}</> : <p role="alert">無法預覽目前一頁式網站步驟。</p>;
  }
  return <><FunnelPageDocumentRenderer document={content} viewport={viewport} mode="preview" />{content.popups.filter((popup) => !popup.pageId || popup.pageId === content.id).map((popup) => <FunnelPopupPreview key={popup.id} document={content} popupId={popup.id} viewport={viewport} />)}</>;
}
function CurrentWorkspacePreview({ content, slug, resource, viewport, commerceProducts }: {
  content: WorkspaceEditorContent; slug: string; resource: ReturnType<typeof resolveWebinarResource>;
  viewport: FunnelViewport; commerceProducts: FunnelCommerceProduct[];
}) {
  if (isWebinar(content)) return <FunnelWebinarExperience state={content} stepId={content.activeStepId} slug={slug} resource={resource} preview viewport={viewport} />;
  return <WorkspacePreview content={content} commerceProducts={commerceProducts} viewport={viewport} />;
}

type LegacyOpening = { issues: LegacyConversionIssue[] } | { failed: true };

/**
 * A legacy (pre-structured) draft opens as a converted PageDocument. The
 * conversion lives only in editor state: the stored legacy draft is untouched
 * until the merchant saves.
 */
function openStoredContent(page: PageInput, forms: LandingPageRenderContext["forms"], lives: Lives): { content: WorkspaceEditorContent; legacy?: LegacyOpening } {
  const stored = page.content ?? starterDocument();
  if (isStructured(stored)) return { content: stored };
  const live = page.liveId ? lives.find((item) => item.id === page.liveId) : undefined;
  const result = convertParsedLegacyLandingPage(stored, { id: page.id, name: page.name, forms, ...(live ? { live } : {}) });
  return result.ok ? { content: result.document, legacy: { issues: result.issues } } : { content: starterDocument(), legacy: { failed: true } };
}

const legacyFailed = (legacy: LegacyOpening | undefined) => Boolean(legacy && "failed" in legacy);
/** True while a converted legacy page shows exactly the conversion and nothing the merchant edited. */
const pristineConversion = (legacy: LegacyOpening | undefined, snapshot: string, converted: string | null) => Boolean(legacy && "issues" in legacy) && snapshot === converted;
function legacyNotice(legacy: LegacyOpening | undefined, published: boolean) {
  return legacy && "issues" in legacy ? <LegacyConversionNotice issues={legacy.issues} published={published} /> : undefined;
}
const DELETE_CONFIRMATION = "確定要移除這個一頁式網站嗎？曾發布或已有造訪紀錄的一頁式網站會改為封存：公開網址停止開啟，造訪與名單來源紀錄保留；從未發布的草稿會永久刪除。";

/** The page cannot be edited, but it can still be taken offline or removed (these never send content). */
function LegacyConversionFailure({ published, pending, onRun, onExit, toast }: { published: boolean; pending: boolean; onRun: (operation: string) => void; onExit: () => void; toast: React.ReactNode }) {
  const action = "min-h-10 cursor-pointer rounded-lg border px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-40";
  return <main className="grid min-h-dvh place-items-center bg-slate-100 p-6">
    <div role="alert" className="max-w-lg rounded-xl border border-red-200 bg-white p-6 text-sm leading-6 text-slate-800 shadow-sm">
      <h1 className="text-base font-bold text-red-800">無法開啟這個舊版頁面</h1>
      <p className="mt-2">這個舊版頁面無法自動轉換成新版編輯器格式，原本的內容沒有被改動，公開頁也維持原樣。請聯絡客服協助轉換。</p>
      <p className="mt-2">在轉換完成前，你仍可以取消發布或刪除這個一頁式網站。</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onExit} className="min-h-10 cursor-pointer rounded-lg bg-slate-900 px-4 font-semibold text-white hover:bg-slate-700">返回管理頁</button>
        {published ? <button type="button" disabled={pending} onClick={() => onRun("unpublish")} className={`${action} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>取消發布</button> : null}
        <button type="button" disabled={pending} onClick={() => { if (window.confirm(DELETE_CONFIRMATION)) onRun("delete"); }} className={`${action} border-red-200 bg-white text-red-700 hover:bg-red-50`}>刪除一頁式網站</button>
      </div>
    </div>
    {toast}
  </main>;
}

// Optional persisted and create-flow inputs are normalized at this single boundary.
// eslint-disable-next-line complexity
function initialWorkspace(page: PageInput | undefined, forms: LandingPageRenderContext["forms"], lives: Lives, config?: { goal?: FunnelGoal; name?: string; slug?: string; currency?: string }) {
  const opened = page ? openStoredContent(page, forms, lives) : { content: starterDocument(config?.goal) as WorkspaceEditorContent };
  let content = opened.content;
  if (!page && isPageDocument(content) && config?.goal && config.name && config.slug) {
    content = createGoalFunnelStepPages({ id: "funnel_flow", name: config.name, goal: config.goal, domain: config.slug, currency: config.currency ?? "TWD" }) ?? content;
  }
  return {
    content, legacy: opened.legacy,
    // The saved snapshot is what is stored: a converted legacy page starts with unsaved changes.
    storedContent: (page?.content ?? content) as LandingPageStoredContent,
    published: page?.status === "published",
    name: page?.name ?? config?.name ?? "新的一頁式網站頁面", slug: page?.slug ?? config?.slug ?? "",
    formId: page?.formId ?? forms[0]?.id ?? "", liveId: page?.liveId ?? "",
    revision: page?.revision ?? 1, valid: Boolean(page?.content ?? true),
    version: String(page?.versions[0]?.version ?? ""),
  };
}

function saveStateFor(pendingOperation: string | null, dirty: boolean): FunnelEditorSaveState {
  if (pendingOperation === "save" || pendingOperation === "create") return "saving";
  return dirty ? "dirty" : "saved";
}

type WorkspaceProps = { initialPublication?: LandingPagePublicationStatus; commerceProducts?: FunnelCommerceProduct[]; webinarResources?: FunnelWebinarResources; page?: PageInput; forms: LandingPageRenderContext["forms"]; lives: Lives; csrfToken: string; csrfName: string; initialGoal?: FunnelGoal; initialName?: string; initialSlug?: string; initialCurrency?: string; returnHref?: string; managementHref?: string };

/**
 * Persistence owner of the full-screen editor: save/exit, page metadata,
 * version restore and the publication chip. The canvas editor renders the
 * shared toolbar; legacy pages open converted, with a notice, and keep their
 * stored legacy draft until the merchant saves.
 */
export function LandingPageWorkspace({ initialPublication, page, forms, lives, csrfToken, csrfName, initialGoal, initialName, initialSlug, initialCurrency, webinarResources, commerceProducts: products, returnHref, managementHref }: WorkspaceProps) {
  const commerceProducts = products ?? [];
  const router = useRouter();
  const [initial] = useState(() => initialWorkspace(page, forms, lives, { goal: initialGoal, name: initialName, slug: initialSlug, currency: initialCurrency }));
  const [content, setContent] = useState<WorkspaceEditorContent>(initial.content);
  const contentRef = useRef<WorkspaceEditorContent>(initial.content);
  // Cleared once the converted page has been saved in the new format.
  const [legacy, setLegacy] = useState(initial.legacy);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [formId, setFormId] = useState(initial.formId);
  const [liveId, setLiveId] = useState(initial.liveId);
  const [revision, setRevision] = useState(initial.revision);
  const snapshot = useMemo(() => workspaceSnapshot({ content, name, slug, formId, liveId }), [content, name, slug, formId, liveId]);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(() => page ? workspaceSnapshot({ ...initial, content: initial.storedContent }) : null);
  const dirty = snapshot !== savedSnapshot;
  // A legacy page opens with conversion-only "changes"; they must not block actions that never send content.
  const [convertedSnapshot] = useState(() => initial.legacy && "issues" in initial.legacy ? workspaceSnapshot(initial) : null);
  const [valid, setValid] = useState(initial.valid);
  const [notice, setNotice] = useState<Notice | null>(null);
  // An action result overrides the server diagnosis until the server sends a newer one.
  const [publicationResult, setPublicationResult] = useState<{ source?: LandingPagePublicationStatus; value: LandingPagePublicationStatus }>();
  const publication = publicationResult && publicationResult.source === initialPublication ? publicationResult.value : initialPublication;
  const [, startTransition] = useTransition();
  const [pendingOperation, setPendingOperation] = useState<string | null>(null);
  const pending = pendingOperation !== null;
  const [exitQueued, setExitQueued] = useState(false);
  const [exitPrompt, setExitPrompt] = useState(false);
  const inFlight = useRef(false);
  const revisionRef = useRef(initial.revision);
  const [published, setPublished] = useState(initial.published);
  const [version, setVersion] = useState(initial.version);
  const selectedVersion = version || String(page?.versions[0]?.version ?? "");
  const exitHref = returnHref ?? "/landing-pages";
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    if (!exitQueued || pending || dirty || inFlight.current) return;
    router.push(exitHref);
  }, [dirty, exitQueued, pending, exitHref, router]);
  useEffect(() => {
    if (notice?.tone !== "info") return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function run(operation: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingOperation(operation);
    const data = new FormData();
    data.set(csrfName, csrfToken);
    data.set("operation", operation);
    if (page) data.set("id", page.id);
    data.set("revision", String(revisionRef.current));
    data.set("name", name); data.set("slug", slug); data.set("formId", formId); data.set("liveId", liveId);
    // Read the synchronous snapshot so a rapid sequence of controlled input
    // events cannot save the previous render's content.
    const sentContent = contentRef.current;
    const sentSnapshot = workspaceSnapshot({ content: sentContent, name, slug, formId, liveId });
    data.set("content", JSON.stringify(sentContent)); data.set("version", selectedVersion);
    startTransition(async () => {
      try {
        const result = await landingPageAction({ status: "success", message: "" }, data);
        setNotice({ text: result.message, tone: result.status === "success" ? "info" : "error" });
        if (result.status !== "success") { setExitQueued(false); setExitPrompt(false); return; }
        if (result.revision) { revisionRef.current = result.revision; setRevision(result.revision); }
        if (result.publication) setPublicationResult({ source: initialPublication, value: result.publication });
        if (operation === "publish") setPublished(true);
        if (operation === "unpublish") setPublished(false);
        if (operation === "save" || operation === "create") { setSavedSnapshot(sentSnapshot); setLegacy(undefined); }
        if ((operation === "create" || operation === "duplicate") && result.id) router.push(landingPageEditorHref(result.id));
        // Restoring a historical snapshot intentionally starts a fresh editing
        // session. Ordinary save/publish must preserve current UI and history.
        if (operation === "rollback") window.location.reload();
        if (operation === "delete") router.push("/landing-pages");
      } catch { setExitQueued(false); setExitPrompt(false); setNotice({ text: "連線中斷，內容仍保留，請稍後再試。", tone: "error" }); }
      finally {
        inFlight.current = false;
        setPendingOperation(null);
      }
    });
  }
  function updateContent(next: WorkspaceEditorContent) {
    contentRef.current = next;
    setContent(next);
  }
  function save() { run(page ? "save" : "create"); }
  function exitEditor() {
    if (inFlight.current) {
      if (pendingOperation === "save") {
        setExitQueued(true);
        setNotice({ text: "儲存完成後會返回管理頁。", tone: "info" });
      }
      return;
    }
    if (dirty) { setExitPrompt(true); return; }
    router.push(exitHref);
  }
  const saveBlocked = pending || !valid || !name.trim() || !slug.trim();
  const webinarResource = resolveWebinarResource(webinarResources, lives, liveId, formId);
  // Registration buttons resolve the form slug and the currently selected live at render time.
  const selectedLive = lives.find((live) => live.id === liveId);
  const registrationLinks = useMemo<FunnelRegistrationLinks>(() => ({ forms, ...(selectedLive ? { live: selectedLive } : {}) }), [forms, selectedLive]);
  const settings = <WorkspaceSettingsFields name={name} slug={slug} formId={formId} liveId={liveId} forms={forms} lives={lives} disabled={pending} onName={setName} onSlug={setSlug} onForm={setFormId} onLive={setLiveId}>
    <WebinarWorkspaceSettings content={content} pending={pending} resources={webinarResources} lives={lives} liveId={liveId} onValidityChange={setValid} onChange={updateContent} onSelect={(id, form) => { setLiveId(id); if (form) setFormId(form); }} />
  </WorkspaceSettingsFields>;
  // Publish, unpublish, duplicate, delete and restore act on the stored draft; only real edits make them misleading.
  const editedSinceSave = dirty && !pristineConversion(legacy, snapshot, convertedSnapshot);
  const versions = page?.versions.length ? <VersionHistory versions={page.versions} selected={selectedVersion} disabled={pending || editedSinceSave} dirty={editedSinceSave} onSelect={setVersion} onRestore={() => run("rollback")} /> : undefined;
  const legacyActions = page && !managementHref ? <LegacyPublishActions published={published} disabled={pending || editedSinceSave} onRun={run} /> : undefined;
  const chrome: FunnelEditorChrome = {
    title: name, saveState: saveStateFor(pendingOperation, dirty), saveBlocked, onSave: save, onExit: exitEditor,
    status: page ? <PublicationChip published={published} publication={publication} slug={slug} onManage={managementHref ? () => { if (dirty) setExitPrompt(true); else router.push(exitHref); } : undefined} actions={legacyActions} /> : null,
    pageSettings: settings, versions,
    renderPreview: (viewport) => <CurrentWorkspacePreview content={content} slug={slug} resource={webinarResource} viewport={viewport} commerceProducts={commerceProducts} />,
    notice: legacyNotice(legacy, published),
  };
  const toast = notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={`fixed bottom-4 left-1/2 z-[150] max-w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-semibold shadow-lg ${notice.tone === "error" ? "bg-red-700 text-white" : "bg-slate-900 text-white"}`}>{notice.text}{notice.tone === "error" ? <button type="button" aria-label="關閉訊息" className="ml-3 cursor-pointer underline" onClick={() => setNotice(null)}>關閉</button> : null}</p> : null;
  if (legacyFailed(legacy)) return <LegacyConversionFailure published={published} pending={pending} onRun={run} onExit={() => router.push(exitHref)} toast={toast} />;
  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100">
    <FunnelRegistrationLinkProvider value={registrationLinks}>
      <div className="min-h-0 flex-1"><FunnelEditorAssetsProvider csrfToken={csrfToken}><WorkspaceEditor content={content} commerceProducts={commerceProducts} pending={pending} revision={revision} onDocumentChange={updateContent} chrome={chrome} /></FunnelEditorAssetsProvider></div>
    </FunnelRegistrationLinkProvider>
    {toast}
    {exitPrompt ? <UnsavedChangesDialog saving={pendingOperation === "save" || pendingOperation === "create"} saveBlocked={saveBlocked && !pending} onCancel={() => setExitPrompt(false)} onDiscard={() => { setExitPrompt(false); router.push(exitHref); }} onSave={() => { setExitQueued(true); save(); }} /> : null}
  </div>;
}

function WorkspaceSettingsFields({ name, slug, formId, liveId, forms, lives, disabled, onName, onSlug, onForm, onLive, children }: { name: string; slug: string; formId: string; liveId: string; forms: LandingPageRenderContext["forms"]; lives: Lives; disabled: boolean; onName: (value: string) => void; onSlug: (value: string) => void; onForm: (value: string) => void; onLive: (value: string) => void; children?: React.ReactNode }) {
  const label = "grid min-w-0 content-start gap-1 text-sm font-semibold text-slate-700";
  return <div className="grid gap-3">
    <label className={label}>頁面名稱<input disabled={disabled} aria-label="頁面名稱" className={panelControl} value={name} maxLength={160} onChange={(event) => onName(event.target.value)} /></label>
    <label className={label}><span>公開網址 <span className="font-normal text-slate-500">/lp/</span></span><input disabled={disabled} aria-label="公開網址" className={panelControl} value={slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="webinar-intro" maxLength={100} onChange={(event) => onSlug(event.target.value)} /></label>
    <label className={label}>預設報名表<select disabled={disabled} aria-label="預設報名表" className={panelControl} value={formId} onChange={(event) => onForm(event.target.value)}><option value="">不指定</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
    {!forms.length ? <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">目前沒有啟用中的報名表。可先建立頁面內容，再到報名管理建立表單。</p> : null}
    <label className={label}>活動場次<select disabled={disabled} aria-label="活動場次" className={panelControl} value={liveId} onChange={(event) => onLive(event.target.value)}><option value="">由報名表提供場次選擇</option>{lives.map((live) => <option key={live.id} value={live.id}>{live.title}</option>)}</select></label>
    {children}
  </div>;
}

function VersionHistory({ versions, selected, disabled, dirty, onSelect, onRestore }: { versions: Array<{ version: number }>; selected: string; disabled: boolean; dirty: boolean; onSelect: (version: string) => void; onRestore: () => void }) {
  return <div className="grid gap-3">
    <p className="text-sm leading-6 text-slate-600">每次發布都會保留一個版本。還原後會把該版本變成新的草稿；公開頁面在再次發布前不會改變。</p>
    <label className="grid gap-1 text-sm font-semibold text-slate-700">歷史發布版本<select aria-label="歷史發布版本" className={panelControl} value={selected} onChange={(event) => onSelect(event.target.value)}>{versions.map((item) => <option key={item.version} value={item.version}>版本 {item.version}</option>)}</select></label>
    <button type="button" disabled={disabled || !selected} onClick={onRestore} className="min-h-10 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">還原此版本為草稿</button>
    {dirty ? <p role="status" className="text-xs text-amber-800">請先儲存或復原目前的變更，再還原歷史版本。</p> : null}
  </div>;
}

/** Only for pages without a management page (legacy content); funnels publish there. */
function LegacyPublishActions({ published, disabled, onRun }: { published: boolean; disabled: boolean; onRun: (operation: string) => void }) {
  const button = "min-h-9 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
  return <div className="grid gap-2 border-t border-slate-200 pt-3">
    {disabled ? <p className="text-xs text-slate-500">請先儲存變更再發布或管理。</p> : null}
    <button type="button" disabled={disabled} onClick={() => onRun("publish")} className={button}>發布已儲存草稿</button>
    {published ? <button type="button" disabled={disabled} onClick={() => onRun("unpublish")} className={button}>取消發布</button> : null}
    <button type="button" disabled={disabled} onClick={() => onRun("duplicate")} className={button}>複製頁面</button>
    <button type="button" disabled={disabled} onClick={() => { if (window.confirm(DELETE_CONFIRMATION)) onRun("delete"); }} className={`${button} border-red-200 text-red-700 hover:bg-red-50`}>刪除一頁式網站</button>
  </div>;
}

function resolveWebinarResource(resources: FunnelWebinarResources | undefined, lives: Lives, liveId: string, formId: string) {
  const live = lives.find((item) => item.id === liveId);
  const video = resources?.lives.find((item) => item.id === liveId);
  const form = resources?.forms.find((item) => item.id === formId);
  if (!video?.videoReady || !video.videoId || !live || !form || live.formId !== formId) return undefined;
  return { form, live: { id: live.id, slug: live.slug, videoId: video.videoId, videoTitle: video.videoTitle ?? "活動影片" } };
}
function WebinarWorkspaceSettings({ content, pending, resources, lives, liveId, onValidityChange, onChange, onSelect }: {
  content: LandingPageStoredContent; pending: boolean; resources?: FunnelWebinarResources; lives: Lives; liveId: string;
  onValidityChange: (valid: boolean) => void; onChange: (state: FunnelStepPages) => void; onSelect: (id: string, formId?: string) => void;
}) {
  if (!isWebinar(content)) return null;
  const selected = resources?.lives.find((live) => live.id === liveId);
  return <>
    <FunnelWebinarSettings state={content} disabled={pending} onValidityChange={onValidityChange} onChange={onChange} />
    <label className="grid gap-1 text-sm font-semibold text-slate-700">來源影片<select disabled={pending} aria-label="來源影片" className={panelControl} value={selected?.id ?? ""} onChange={(event) => {
      const match = resources?.lives.find((live) => live.id === event.target.value && live.videoReady);
      if (match) onSelect(match.id, lives.find((item) => item.id === match.id)?.formId);
    }}><option value="">請選擇已綁定活動的可播放影片</option>{resources?.lives.filter((live) => live.videoReady && live.videoId).map((live) => <option key={live.id} value={live.id}>{live.videoTitle} · {lives.find((item) => item.id === live.id)?.title}</option>)}</select><span className="text-xs font-normal leading-5 text-slate-600">沿用活動 Studio 的來源影片；選擇影片會同步選擇其活動。實際播放仍依 Live 排程與觀看權限。</span></label>
  </>;
}
