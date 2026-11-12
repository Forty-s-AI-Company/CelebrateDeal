"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmActionButton } from "@/components/confirm-action-button";
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
import { SaveAsTemplateDialog } from "@/components/landing-pages/save-as-template-dialog";
import { PublicationChip } from "@/components/landing-page-publication-chip";
import { Toast, useToast } from "@/components/toast";
import { FunnelPublishDrawer, type PublishCommerceStatus, type PublishFixKind, type PublishFlowState } from "@/components/landing-pages/funnel-publish-drawer";
import type { FunnelEditorNavigation } from "@/components/landing-pages/funnel-editor-chrome";
import { landingPageAction } from "@/app/actions/landing-page-actions";
import type { LandingPageRenderContext } from "@/lib/landing-page-content";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import type { FunnelWebinarResources, LandingPageActionState, LandingPageEditorPage, LandingPagePublicationStatus, LandingPageStoredContent } from "@/lib/landing-page-service";
import type { FunnelGoal } from "@/components/landing-pages/funnel-goal-picker";
import { getActiveFunnelStepPage, type FunnelStepPages } from "@/lib/funnel-step-pages";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { commerceViewForBinding, funnelCommerceBindingStatus, type FunnelCommerceProduct } from "@/lib/funnel-commerce";
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

function WorkspaceSaveAsTemplate({ open, target, dirty, csrfName, csrfToken, onClose }: { open: boolean; target: ReturnType<typeof saveAsTemplateTarget>; dirty: boolean; csrfName: string; csrfToken: string; onClose: () => void }) {
  if (!open || !target) return null;
  return <SaveAsTemplateDialog csrfName={csrfName} csrfToken={csrfToken} {...target} blockedReason={dirty ? "你有尚未儲存的變更。範本只會存入已儲存的內容，請先按「儲存」再存成範本。" : undefined} onClose={onClose} />;
}

/** 「存成範本」 reads the stored draft on the server: offered for a saved, structured page and never for the system step. */
function saveAsTemplateTarget(page: PageInput | undefined, content: WorkspaceEditorContent, legacy: boolean, name: string) {
  if (!page || legacy) return null;
  if (!isFunnelStepPages(content)) return isPageDocument(content) ? { pageId: page.id, defaultName: name } : null;
  const active = getActiveFunnelStepPage(content);
  if (!active || active.step.isSystem) return null;
  return { pageId: page.id, stepId: active.step.id, stepName: active.step.name, defaultName: `${name}－${active.step.name}` };
}

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
        <ConfirmActionButton type="button" disabled={pending} message={DELETE_CONFIRMATION} confirmLabel="移除" destructive onConfirm={() => onRun("delete")} className={`${action} border-red-200 bg-white text-red-700 hover:bg-red-50`}>刪除一頁式網站</ConfirmActionButton>
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

/** Edits are saved this long after the last change (the save-state chip shows 儲存中… while it runs). */
export const AUTOSAVE_DELAY_MS = 3_000;

const isSaveOperation = (operation: string | null) => operation === "save" || operation === "create";
/**
 * Operations that leave the canvas editable: saving a stored page (autosave
 * must not take focus) and the publish steps, which run behind the modal
 * drawer on the stored draft. `create` stays locked: it navigates to the new
 * page, so edits made meanwhile would be lost.
 */
const UNLOCKED_OPERATIONS = new Set(["save", "check_publish", "publish"]);

function saveStateFor(pendingOperation: string | null, dirty: boolean, failed: boolean): FunnelEditorSaveState {
  if (isSaveOperation(pendingOperation)) return "saving";
  if (dirty && failed) return "error";
  return dirty ? "dirty" : "saved";
}

/** Which feedback an operation shows in the bottom notice: manual actions all, autosave only failures, the publish drawer none. */
type NoticeMode = "all" | "errors" | "none";

/** Commerce state of the step being edited, for the publish drawer's non-blocking note. */
function publishCommerceStatus(content: WorkspaceEditorContent, products: FunnelCommerceProduct[]): PublishCommerceStatus {
  if (!isFunnelStepPages(content)) return "none";
  const active = getActiveFunnelStepPage(content);
  if (!active || active.step.type !== "order_form") return "none";
  return funnelCommerceBindingStatus(active.page, products);
}

function publishedToast(result: LandingPageActionState, slug: string) {
  const url = `${window.location.origin}/lp/${slug}`;
  const version = result.version ? `版本 v${result.version}` : "";
  const unavailable = result.publication && !result.publication.available ? `（${result.publication.message}）` : "";
  return { text: `已發布${version}。公開網址：${url}${unavailable}`, tone: unavailable ? "info" as const : "success" as const, link: { href: `/lp/${slug}`, label: "開啟公開頁", external: true } };
}

type WorkspaceProps = { initialPublication?: LandingPagePublicationStatus; commerceProducts?: FunnelCommerceProduct[]; webinarResources?: FunnelWebinarResources; page?: PageInput; forms: LandingPageRenderContext["forms"]; lives: Lives; csrfToken: string; csrfName: string; initialGoal?: FunnelGoal; initialName?: string; initialSlug?: string; initialCurrency?: string; returnHref?: string; managementHref?: string };

/**
 * Persistence owner of the full-screen editor: save (manual and automatic),
 * exit, page metadata, version restore, the publication chip and in-editor
 * publishing. The canvas editor renders the shared toolbar; legacy pages open
 * converted, with a notice, and keep their stored legacy draft until the
 * merchant saves (they are never autosaved).
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
  // Read by the publish flow after an await, when this render's values may be stale.
  const savedSnapshotRef = useRef(savedSnapshot);
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
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<Promise<LandingPageActionState | null> | null>(null);
  const revisionRef = useRef(initial.revision);
  const [published, setPublished] = useState(initial.published);
  const [version, setVersion] = useState(initial.version);
  // The last failed save: the content it tried to store and, for a revision conflict, a stop to autosave.
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);
  const { toast: publishToast, showToast, dismissToast } = useToast();
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

  function currentSnapshot() { return workspaceSnapshot({ content: contentRef.current, name, slug, formId, liveId }); }

  /** Runs one action; resolves with its result, or null when another one is still running or the request failed. */
  function execute(operation: string, noticeMode: NoticeMode = "all"): Promise<LandingPageActionState | null> {
    if (inFlight.current) return Promise.resolve(null);
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
    const saving = isSaveOperation(operation);
    const started = new Promise<LandingPageActionState | null>((resolve) => {
      startTransition(async () => {
        let outcome: LandingPageActionState | null = null;
        try {
          const result = await landingPageAction({ status: "success", message: "" }, data);
          outcome = result;
          const ok = result.status === "success";
          if (noticeMode === "all" || (noticeMode === "errors" && !ok)) setNotice({ text: result.message, tone: ok ? "info" : "error" });
          if (!ok) {
            setExitQueued(false); setExitPrompt(false);
            if (saving) setSaveFailure({ snapshot: sentSnapshot, conflict: result.code === "landing_page_conflict" });
            return;
          }
          if (result.revision) { revisionRef.current = result.revision; setRevision(result.revision); }
          if (result.publication) setPublicationResult({ source: initialPublication, value: result.publication });
          if (operation === "publish") setPublished(true);
          if (operation === "unpublish") setPublished(false);
          if (saving) { savedSnapshotRef.current = sentSnapshot; setSavedSnapshot(sentSnapshot); setLegacy(undefined); setSaveFailure(null); }
          if ((operation === "create" || operation === "duplicate") && result.id) router.push(landingPageEditorHref(result.id));
          // Restoring a historical snapshot intentionally starts a fresh editing
          // session. Ordinary save/publish must preserve current UI and history.
          if (operation === "rollback") window.location.reload();
          if (operation === "delete") router.push("/landing-pages");
        } catch {
          setExitQueued(false); setExitPrompt(false);
          if (saving) setSaveFailure({ snapshot: sentSnapshot, conflict: false });
          if (noticeMode !== "none") setNotice({ text: "連線中斷，內容仍保留，請稍後再試。", tone: "error" });
        } finally {
          inFlight.current = false;
          request.current = null;
          setPendingOperation(null);
          resolve(outcome);
        }
      });
    });
    request.current = started;
    return started;
  }
  function run(operation: string) { void execute(operation); }
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
  const { locked, settingsIncomplete, saveBlocked, saveFailed, autosave, autosaveEnabled, autosaveDue } = saveFlags({ pendingOperation, dirty, snapshot, saveFailure, stored: Boolean(page), legacy: Boolean(legacy), valid, name, slug });
  useAutosave({ enabled: autosaveEnabled, due: autosaveDue, snapshot, save: () => { void execute("save", "errors"); } });
  const publishing = usePublishFlow({
    canPublish: Boolean(page && managementHref),
    waitForIdle: () => request.current ?? Promise.resolve(null),
    needsSave: () => currentSnapshot() !== savedSnapshotRef.current,
    saveBlocked: settingsIncomplete,
    execute,
    onCommerceRefused: () => router.refresh(),
    onPublished: (result) => { const message = publishedToast(result, slug); showToast(message.text, { tone: message.tone, link: message.link, duration: 12_000 }); },
  });
  const webinarResource = resolveWebinarResource(webinarResources, lives, liveId, formId);
  // Registration buttons resolve the form slug and the currently selected live at render time.
  const selectedLive = lives.find((live) => live.id === liveId);
  const registrationLinks = useMemo<FunnelRegistrationLinks>(() => ({ forms, ...(selectedLive ? { live: selectedLive } : {}) }), [forms, selectedLive]);
  const settings = <WorkspaceSettingsFields name={name} slug={slug} formId={formId} liveId={liveId} forms={forms} lives={lives} disabled={locked} onName={setName} onSlug={setSlug} onForm={setFormId} onLive={setLiveId}>
    <WebinarWorkspaceSettings content={content} pending={locked} resources={webinarResources} lives={lives} liveId={liveId} onValidityChange={setValid} onChange={updateContent} onSelect={(id, form) => { setLiveId(id); if (form) setFormId(form); }} />
  </WorkspaceSettingsFields>;
  // Publish, unpublish, duplicate, delete and restore act on the stored draft; only real edits make them misleading.
  const editedSinceSave = dirty && !pristineConversion(legacy, snapshot, convertedSnapshot);
  const versions = page?.versions.length ? <VersionHistory versions={page.versions} selected={selectedVersion} disabled={pending || editedSinceSave} dirty={editedSinceSave} onSelect={setVersion} onRestore={() => run("rollback")} /> : undefined;
  const legacyActions = page && !managementHref ? <LegacyPublishActions published={published} disabled={pending || editedSinceSave} onRun={run} /> : undefined;
  const templateTarget = saveAsTemplateTarget(page, content, Boolean(legacy), name);
  const chrome: FunnelEditorChrome = {
    title: name, saveState: saveStateFor(pendingOperation, dirty, saveFailed), saveBlocked, onSave: save, onExit: exitEditor, autosave,
    status: page ? <PublicationChip published={published} publication={publication} slug={slug} publishInEditor={publishing.available} onManage={managementHref ? () => { if (dirty) setExitPrompt(true); else router.push(exitHref); } : undefined} actions={legacyActions} /> : null,
    pageSettings: settings, versions,
    renderPreview: (viewport) => <CurrentWorkspacePreview content={content} slug={slug} resource={webinarResource} viewport={viewport} commerceProducts={commerceProducts} />,
    notice: legacyNotice(legacy, published),
    onSaveAsTemplate: templateTarget ? () => setTemplateDialogOpen(true) : undefined,
    ...publishChrome({ publishing, published, locked, managementHref, commerce: () => publishCommerceStatus(content, commerceProducts) }),
  };
  const toast = notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={`fixed bottom-4 left-1/2 z-[150] max-w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-semibold shadow-lg ${notice.tone === "error" ? "bg-red-700 text-white" : "bg-slate-900 text-white"}`}>{notice.text}{notice.tone === "error" ? <button type="button" aria-label="關閉訊息" className="ml-3 cursor-pointer underline" onClick={() => setNotice(null)}>關閉</button> : null}</p> : null;
  if (legacyFailed(legacy)) return <LegacyConversionFailure published={published} pending={pending} onRun={run} onExit={() => router.push(exitHref)} toast={toast} />;
  return <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100">
    <FunnelRegistrationLinkProvider value={registrationLinks}>
      <div className="min-h-0 flex-1"><FunnelEditorAssetsProvider csrfToken={csrfToken}><WorkspaceEditor content={content} commerceProducts={commerceProducts} pending={locked} revision={revision} onDocumentChange={updateContent} chrome={chrome} /></FunnelEditorAssetsProvider></div>
    </FunnelRegistrationLinkProvider>
    {toast}
    <Toast toast={publishToast} onDismiss={dismissToast} />
    <WorkspaceSaveAsTemplate open={templateDialogOpen} target={templateTarget} dirty={dirty} csrfName={csrfName} csrfToken={csrfToken} onClose={() => setTemplateDialogOpen(false)} />
    {exitPrompt ? <UnsavedChangesDialog saving={isSaveOperation(pendingOperation)} saveBlocked={saveBlocked && !pending} onCancel={() => setExitPrompt(false)} onDiscard={() => { setExitPrompt(false); router.push(exitHref); }} onSave={() => { setExitQueued(true); save(); }} /> : null}
  </div>;
}

type SaveFailure = { snapshot: string; conflict: boolean };

/**
 * Save-related flags. Saving and the publish steps never lock the canvas or
 * the settings (autosave would steal focus from an input); other operations do. Autosave runs only
 * for a stored page, never for a pristine legacy conversion, never twice for
 * content whose save failed, and not at all after a revision conflict.
 */
function saveFlags(input: { pendingOperation: string | null; dirty: boolean; snapshot: string; saveFailure: SaveFailure | null; stored: boolean; legacy: boolean; valid: boolean; name: string; slug: string }) {
  const pending = input.pendingOperation !== null;
  const locked = pending && !UNLOCKED_OPERATIONS.has(input.pendingOperation ?? "");
  const settingsIncomplete = !input.valid || !input.name.trim() || !input.slug.trim();
  const saveBlocked = locked || settingsIncomplete;
  const conflict = Boolean(input.saveFailure?.conflict);
  const saveFailed = conflict || input.saveFailure?.snapshot === input.snapshot;
  const autosave = input.stored && !input.legacy;
  return { locked, settingsIncomplete, saveBlocked, saveFailed, autosave, autosaveEnabled: autosave && !conflict, autosaveDue: input.dirty && !pending && !saveBlocked && !saveFailed };
}

/** Toolbar 發布 and its drawer, only for funnels (they have a management page). */
function publishChrome({ publishing, published, locked, managementHref, commerce }: {
  publishing: ReturnType<typeof usePublishFlow>; published: boolean; locked: boolean; managementHref?: string; commerce: () => PublishCommerceStatus;
}): Pick<FunnelEditorChrome, "publish" | "renderOverlay"> {
  if (!publishing.available) return {};
  const state = publishing.state;
  return {
    // Not disabled while the (modal) drawer is open: a disabled trigger would drop the focus the drawer returns to.
    publish: { label: published ? "更新發布" : "發布", disabled: locked, onPublish: publishing.open },
    renderOverlay: state ? (navigation) => <FunnelPublishDrawer state={state} published={published} commerce={commerce()} managementHref={managementHref}
      onPublish={publishing.confirm} onRetry={publishing.open} onClose={publishing.close} onFix={(kind) => publishing.fix(kind, navigation)} /> : undefined,
  };
}

/**
 * Debounced autosave: `due` while there are unsaved, savable changes and
 * nothing else runs. Every edit (new snapshot) restarts the delay, so one
 * pause saves once; a save that failed is not retried for the same content.
 * Saves go through the same revision-checked action as 儲存, which refuses
 * to overwrite a newer stored version.
 */
function useAutosave({ enabled, due, snapshot, save }: { enabled: boolean; due: boolean; snapshot: string; save: () => void }) {
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });
  useEffect(() => {
    if (!enabled || !due) return;
    const timer = window.setTimeout(() => saveRef.current(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, due, snapshot]);
}

/**
 * 發布 in the editor: wait for a running save, save unsaved changes, run the
 * server's publish check, and publish only after the merchant confirms. Every
 * step is the existing CSRF-protected page action; nothing is decided here.
 */
function usePublishFlow({ canPublish, waitForIdle, needsSave, saveBlocked, execute, onCommerceRefused, onPublished }: {
  canPublish: boolean;
  waitForIdle: () => Promise<unknown>;
  needsSave: () => boolean;
  saveBlocked: boolean;
  execute: (operation: string, noticeMode: NoticeMode) => Promise<LandingPageActionState | null>;
  onCommerceRefused: () => void;
  onPublished: (result: LandingPageActionState) => void;
}) {
  const [state, setState] = useState<PublishFlowState | null>(null);
  // A closed (or restarted) flow ignores results that arrive later.
  const run = useRef(0);
  const refused = (result: LandingPageActionState | null): PublishFlowState => ({ phase: "blocked", message: result?.message ?? "連線中斷，網站沒有變更，請稍後再試。", code: result?.code, publication: result?.publication });

  async function open() {
    const id = ++run.current;
    const current = () => run.current === id;
    setState({ phase: "saving" });
    await waitForIdle();
    if (!current()) return;
    if (needsSave()) {
      if (saveBlocked) { setState({ phase: "save_failed", message: "頁面名稱、公開網址或頁面設定尚未完成，草稿無法儲存。請先修正再發布。", code: "settings_invalid" }); return; }
      const saved = await execute("save", "none");
      if (!current()) return;
      if (saved?.status !== "success") { setState({ phase: "save_failed", message: saved?.message ?? "連線中斷，內容仍保留在編輯器，請稍後再試。", code: saved?.code }); return; }
    }
    setState({ phase: "checking" });
    const checked = await execute("check_publish", "none");
    if (!current()) return;
    if (checked?.status !== "success") {
      setState(refused(checked));
      // The editor's catalog may be stale; reload it so the in-place picker shows the current products.
      if (checked?.code === "landing_page_commerce_invalid") onCommerceRefused();
      return;
    }
    setState({ phase: "ready", publication: checked.publication });
  }
  async function confirm() {
    const id = run.current;
    setState((value) => ({ phase: "publishing", publication: value && "publication" in value ? value.publication : undefined }));
    const result = await execute("publish", "none");
    if (run.current !== id) return;
    if (result?.status !== "success") { setState(refused(result)); return; }
    run.current += 1;
    setState(null);
    onPublished(result);
  }
  function close() { run.current += 1; setState(null); }
  function fix(kind: PublishFixKind, navigation: FunnelEditorNavigation) {
    if (kind === "reload") { window.location.reload(); return; }
    close();
    if (kind === "commerce" && navigation.selectCommerceElement()) return;
    if (kind === "commerce" || kind === "page_settings") navigation.openPageSettings();
  }
  return { available: canPublish, state, open: () => { void open(); }, confirm: () => { void confirm(); }, close, fix };
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
    <ConfirmActionButton type="button" disabled={disabled} message={DELETE_CONFIRMATION} confirmLabel="移除" destructive onConfirm={() => onRun("delete")} className={`${button} border-red-200 text-red-700 hover:bg-red-50`}>刪除一頁式網站</ConfirmActionButton>
  </div>;
}

function resolveWebinarResource(resources: FunnelWebinarResources | undefined, lives: Lives, liveId: string, formId: string) {
  const live = lives.find((item) => item.id === liveId);
  const video = resources?.lives.find((item) => item.id === liveId);
  const form = resources?.forms.find((item) => item.id === formId);
  if (!video?.videoReady || !video.videoId || !live || !form || live.formId !== formId) return undefined;
  return { form, live: { id: live.id, slug: live.slug, videoId: video.videoId, videoTitle: video.videoTitle ?? "活動影片", ...(video.isEvergreen ? { isEvergreen: true as const } : {}) } };
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
    {selected?.isEvergreen ? <p role="note" className="rounded-md border border-blue-100 bg-blue-50/60 p-2 text-xs leading-5 text-slate-700">這個活動已啟用常青 Webinar：每位訪客在感謝頁或播放頁會依活動的常青排程取得自己的場次，上方固定的開始／結束時間不會用來開放播放，可以留空。</p> : null}
  </>;
}
