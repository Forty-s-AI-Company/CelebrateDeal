"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Trash2, WandSparkles } from "lucide-react";
import {
  applyLandingPageTemplateAction,
  deleteLandingPageTemplateAction,
  readLandingPageTemplateDocumentAction,
  readLandingPageTemplateTargetAction,
  renameLandingPageTemplateAction,
} from "@/app/actions/landing-page-template-actions";
import { funnelStepLabels } from "./funnel-display-labels";
import type { FunnelViewport } from "./funnel-page-document-renderer";
import { FunnelTemplatePreviewDialog, FunnelTemplateThumbnail } from "./funnel-template-preview";
import {
  filterFunnelTemplateCatalog,
  FUNNEL_TEMPLATE_PURPOSE_LABELS,
  FUNNEL_TEMPLATE_PURPOSES,
  FUNNEL_TEMPLATE_STYLE_LABELS,
  FUNNEL_TEMPLATE_STYLES,
  listFunnelTemplateCatalog,
  type FunnelTemplateCatalogEntry,
  type FunnelTemplatePurpose,
  type FunnelTemplateStyle,
} from "@/lib/funnel-template-catalog";
import type { PageDocument } from "@/lib/funnel-page-document";
import { listFunnelTemplateGallery, previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { landingPageEditorHref } from "@/lib/landing-page-editor-href";
import { LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH, LANDING_PAGE_TEMPLATE_VENDOR_LIMIT } from "@/lib/landing-page-template-document";
import type { LandingPageTemplateSummary, LandingPageTemplateTarget, LandingPageTemplateTargetStep } from "@/lib/landing-page-template-service";
import { useDialogBehavior } from "@/lib/use-dialog-behavior";

export type TemplateLibraryTab = "platform" | "mine";
type Selected =
  | { kind: "platform"; id: string; name: string; eyebrow: string; goal: FunnelTemplateCatalogEntry["goal"] }
  | { kind: "mine"; id: string; name: string; eyebrow: string };
type Preview = { selected: Selected; document: PageDocument };
type Notice = { tone: "success" | "error"; text: string } | null;

const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const chip = "min-h-9 shrink-0 rounded-full border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 aria-pressed:border-blue-700 aria-pressed:bg-blue-700 aria-pressed:text-white border-slate-300 bg-white text-slate-700 hover:border-slate-400";
const control = "min-h-11 w-full rounded-lg border border-slate-500 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50";

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeZone: "Asia/Taipei" }).format(new Date(iso));
}

export function templateCreateHref(selected: Pick<Selected, "kind" | "id"> & { goal?: string }) {
  const query = new URLSearchParams({ template: `${selected.kind}:${selected.id}` });
  if (selected.goal) query.set("goal", selected.goal);
  return `/landing-pages/new?${query.toString()}`;
}

/** Steps a template may replace: never the system step; platform templates only on the steps the gallery offers them for. */
export function templateStepAvailability(selected: Pick<Selected, "kind" | "id">, target: Pick<LandingPageTemplateTarget, "goal">, step: LandingPageTemplateTargetStep): { ok: true } | { ok: false; reason: string } {
  if (step.isSystem) return { ok: false, reason: "系統停用頁，不能套用範本" };
  if (selected.kind === "platform" && !listFunnelTemplateGallery(target.goal, step.type).some((item) => item.id === selected.id)) return { ok: false, reason: "這個範本不適用此步驟類型" };
  return { ok: true };
}

function Modal({ labelledBy, onClose, children, size = "max-w-lg", role = "dialog" }: { labelledBy: string; onClose: () => void; children: ReactNode; size?: string; role?: "dialog" | "alertdialog" }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(true, onClose);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus(); }, []);
  return <div role={role} aria-modal="true" aria-labelledby={labelledBy} className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/60 p-3 sm:p-6">
    <div ref={panelRef} className={`max-h-[92dvh] w-full ${size} overflow-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6`}>{children}</div>
  </div>;
}

function TemplateCard({ document, title, eyebrow, badges, description, children }: { document: PageDocument | null; title: string; eyebrow: string; badges?: ReactNode; description?: ReactNode; children: ReactNode }) {
  return <li className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors hover:border-slate-300">
    {document ? <FunnelTemplateThumbnail document={document} className="m-2 mb-0 h-44 sm:h-48" /> : <div data-template-unreadable className="m-2 mb-0 grid h-44 place-items-center rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-900 sm:h-48">無法讀取這個範本的內容</div>}
    <div className="flex min-w-0 flex-1 flex-col p-3">
      <span className="text-xs font-semibold text-slate-500">{eyebrow}</span>
      <h3 data-template-title className="mt-0.5 break-words text-base font-bold text-slate-950">{title}</h3>
      {badges ? <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div> : null}
      {description ? <div className="mt-2 line-clamp-2 break-words text-xs leading-5 text-slate-600">{description}</div> : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-3">{children}</div>
    </div>
  </li>;
}

function Tag({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "blue" | "amber" }) {
  const tones = { gray: "bg-slate-100 text-slate-700", blue: "bg-blue-50 text-blue-800", amber: "bg-amber-50 text-amber-900" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function FilterGroup<T extends string>({ label, options, labels, value, onChange }: { label: string; options: readonly T[]; labels: Readonly<Record<T, string>>; value: T | null; onChange: (value: T | null) => void }) {
  return <div role="group" aria-label={label} className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
    <span className="shrink-0 text-xs font-bold text-slate-600">{label}</span>
    <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={chip}>全部</button>
    {options.map((option) => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(value === option ? null : option)} className={chip}>{labels[option]}</button>)}
  </div>;
}

export function LandingPageTemplateLibrary({ csrfName, csrfToken, myTemplates, sites, initialTab = "platform" }: {
  csrfName: string;
  csrfToken: string;
  myTemplates: LandingPageTemplateSummary[];
  /** null when no sales project is selected (applying and creating need one). */
  sites: Array<{ id: string; name: string }> | null;
  initialTab?: TemplateLibraryTab;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TemplateLibraryTab>(initialTab);
  const [purpose, setPurpose] = useState<FunnelTemplatePurpose | null>(null);
  const [style, setStyle] = useState<FunnelTemplateStyle | null>(null);
  const [mine, setMine] = useState(myTemplates);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<FunnelViewport>("desktop");
  const [using, setUsing] = useState<Selected | null>(null);
  const [renaming, setRenaming] = useState<LandingPageTemplateSummary | null>(null);
  const [deleting, setDeleting] = useState<LandingPageTemplateSummary | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const platformTabRef = useRef<HTMLButtonElement>(null);
  const mineTabRef = useRef<HTMLButtonElement>(null);
  // A refreshed server list replaces the local copy (render-time sync, no effect).
  const [mineSource, setMineSource] = useState(myTemplates);
  if (mineSource !== myTemplates) { setMineSource(myTemplates); setMine(myTemplates); }

  const catalog = useMemo(() => listFunnelTemplateCatalog(), []);
  const documents = useMemo(() => new Map(catalog.map((entry) => [entry.id, previewFunnelTemplate(entry.id, `library_preview_${entry.id}`)])), [catalog]);
  const visible = filterFunnelTemplateCatalog(catalog, { purpose, style });

  const platformSelection = (entry: FunnelTemplateCatalogEntry): Selected => ({ kind: "platform", id: entry.id, name: entry.name, eyebrow: entry.purposes.map((item) => FUNNEL_TEMPLATE_PURPOSE_LABELS[item]).join("・"), goal: entry.goal });
  const mineSelection = (template: LandingPageTemplateSummary): Selected => ({ kind: "mine", id: template.id, name: template.name, eyebrow: "我的範本" });
  const openPreview = (selected: Selected, document: PageDocument) => { setViewport("desktop"); setPreview({ selected, document }); };
  /** The list only carries a thumbnail; the full document of an own template is read when it is previewed. */
  async function openMinePreview(template: LandingPageTemplateSummary) {
    if (loadingPreviewId) return;
    setLoadingPreviewId(template.id);
    try {
      const response = await readLandingPageTemplateDocumentAction(template.id);
      if (response.ok) openPreview(mineSelection(template), response.document);
      else setNotice({ tone: "error", text: response.message });
    } catch {
      setNotice({ tone: "error", text: "無法讀取範本內容，請稍後再試。" });
    } finally {
      setLoadingPreviewId(null);
    }
  }
  const openUse = (selected: Selected) => { setPreview(null); setUsing(selected); };

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next: TemplateLibraryTab = event.key === "Home" ? "platform" : event.key === "End" ? "mine" : tab === "platform" ? "mine" : "platform";
    setTab(next);
    (next === "platform" ? platformTabRef : mineTabRef).current?.focus();
  }

  return <div className="min-w-0">
    <div role="tablist" aria-label="範本來源" className="mb-5 flex gap-1 border-b border-slate-200">
      <button ref={platformTabRef} id="template-tab-platform" role="tab" type="button" aria-selected={tab === "platform"} aria-controls="template-panel-platform" tabIndex={tab === "platform" ? 0 : -1} onKeyDown={onTabKey} onClick={() => setTab("platform")} className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${tab === "platform" ? "border-blue-700 text-slate-950" : "border-transparent text-slate-600 hover:text-slate-900"}`}>平台範本 <span className="ml-1 text-xs font-normal text-slate-500">{catalog.length}</span></button>
      <button ref={mineTabRef} id="template-tab-mine" role="tab" type="button" aria-selected={tab === "mine"} aria-controls="template-panel-mine" tabIndex={tab === "mine" ? 0 : -1} onKeyDown={onTabKey} onClick={() => setTab("mine")} className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${tab === "mine" ? "border-blue-700 text-slate-950" : "border-transparent text-slate-600 hover:text-slate-900"}`}>我的範本 <span className="ml-1 text-xs font-normal text-slate-500">{mine.length}</span></button>
    </div>

    {notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border p-3 text-sm ${notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{notice.text}</p> : null}

    {tab === "platform" ? <section id="template-panel-platform" role="tabpanel" aria-labelledby="template-tab-platform">
      <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <FilterGroup label="用途" options={FUNNEL_TEMPLATE_PURPOSES} labels={FUNNEL_TEMPLATE_PURPOSE_LABELS} value={purpose} onChange={setPurpose} />
        <FilterGroup label="風格" options={FUNNEL_TEMPLATE_STYLES} labels={FUNNEL_TEMPLATE_STYLE_LABELS} value={style} onChange={setStyle} />
      </div>
      <p role="status" className="mb-3 text-sm text-slate-600">{purpose || style ? `符合條件的範本：${visible.length} 個` : `共 ${visible.length} 個範本`}</p>
      {visible.length ? <ul aria-label="平台範本" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((entry) => <TemplateCard key={entry.id} document={documents.get(entry.id)!} title={entry.name} eyebrow={entry.category}
          badges={<>{entry.purposes.map((item) => <Tag key={item} tone="blue">{FUNNEL_TEMPLATE_PURPOSE_LABELS[item]}</Tag>)}{entry.styles.map((item) => <Tag key={item}>{FUNNEL_TEMPLATE_STYLE_LABELS[item]}</Tag>)}{entry.status === "limited" ? <Tag tone="amber">需綁定商品</Tag> : null}</>}
          description={entry.description}>
          <button type="button" aria-label={`預覽 ${entry.name}`} onClick={() => openPreview(platformSelection(entry), documents.get(entry.id)!)} className={secondaryButton}><Eye size={16} aria-hidden />預覽</button>
          <button type="button" aria-label={`使用 ${entry.name}`} onClick={() => openUse(platformSelection(entry))} className={primaryButton}>使用這個範本</button>
        </TemplateCard>)}
      </ul> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><p className="font-semibold text-slate-900">沒有符合條件的範本</p><p className="mt-1 text-sm text-slate-600">換一個用途或風格，或清除篩選看全部範本。</p><button type="button" onClick={() => { setPurpose(null); setStyle(null); }} className={`${secondaryButton} mt-4`}>清除篩選</button></div>}
    </section> : <section id="template-panel-mine" role="tabpanel" aria-labelledby="template-tab-mine">
      <p className="mb-3 text-sm text-slate-600">在編輯器或網站管理頁按「存成範本」，就能把做好的頁面留著重複使用。每個商家最多 {LANDING_PAGE_TEMPLATE_VENDOR_LIMIT} 個。</p>
      {mine.length ? <ul aria-label="我的範本" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {mine.map((template) => <TemplateCard key={template.id} document={template.thumbnail} title={template.name} eyebrow={`更新於 ${formatDate(template.updatedAt)}`} description={template.readable ? undefined : "內容格式已無法讀取，不能預覽或使用；刪除後即可釋出名額。"}>
          {template.readable ? <>
            <button type="button" aria-label={`預覽 ${template.name}`} disabled={loadingPreviewId !== null} onClick={() => void openMinePreview(template)} className={secondaryButton}><Eye size={16} aria-hidden />{loadingPreviewId === template.id ? "讀取中…" : "預覽"}</button>
            <button type="button" aria-label={`使用 ${template.name}`} onClick={() => openUse(mineSelection(template))} className={primaryButton}>使用</button>
            <button type="button" aria-label={`改名 ${template.name}`} onClick={() => setRenaming(template)} className={secondaryButton}><Pencil size={16} aria-hidden />改名</button>
          </> : null}
          <button type="button" aria-label={`刪除 ${template.name}`} onClick={() => setDeleting(template)} className={`${secondaryButton} border-red-200 text-red-700 hover:bg-red-50`}><Trash2 size={16} aria-hidden />刪除</button>
        </TemplateCard>)}
      </ul> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><p className="font-semibold text-slate-900">還沒有自己的範本</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-600">打開任一個一頁式網站的編輯器，按工具列的「存成範本」，或在網站管理頁的步驟設定按「存成範本」。</p><Link href="/landing-pages" className={`${secondaryButton} mt-4`}>前往一頁式網站</Link></div>}
    </section>}

    {preview ? <FunnelTemplatePreviewDialog eyebrow={preview.selected.eyebrow} title={preview.selected.name} document={preview.document} viewport={viewport} onViewport={setViewport} onClose={() => setPreview(null)} actionLabel="使用這個範本" onAction={() => openUse(preview.selected)} note="預覽與使用後的頁面內容與顯示方式相同。" /> : null}
    {using ? <UseTemplateDialog csrfName={csrfName} csrfToken={csrfToken} selected={using} sites={sites} onClose={() => setUsing(null)} /> : null}
    {renaming ? <RenameTemplateDialog csrfName={csrfName} csrfToken={csrfToken} template={renaming} onClose={() => setRenaming(null)} onRenamed={(name) => { setMine((items) => items.map((item) => item.id === renaming.id ? { ...item, name } : item)); setNotice({ tone: "success", text: `範本已改名為「${name}」。` }); setRenaming(null); router.refresh(); }} /> : null}
    {deleting ? <DeleteTemplateDialog csrfName={csrfName} csrfToken={csrfToken} template={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setMine((items) => items.filter((item) => item.id !== deleting.id)); setNotice({ tone: "success", text: `已刪除範本「${deleting.name}」；已套用過的網站內容不受影響。` }); setDeleting(null); router.refresh(); }} /> : null}
  </div>;
}

function UseTemplateDialog({ csrfName, csrfToken, selected, sites, onClose }: { csrfName: string; csrfToken: string; selected: Selected; sites: Array<{ id: string; name: string }> | null; onClose: () => void }) {
  const [mode, setMode] = useState<"create" | "apply">("create");
  const [siteId, setSiteId] = useState("");
  const [target, setTarget] = useState<LandingPageTemplateTarget | null>(null);
  const [loadError, setLoadError] = useState("");
  const [stepId, setStepId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string; conflict?: boolean; href?: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [applying, startApplying] = useTransition();
  const loadGeneration = useRef(0);
  const step = target?.steps.find((item) => item.id === stepId);
  const busy = loading || applying;
  const applied = result?.tone === "success";

  function load(id: string) {
    const generation = ++loadGeneration.current;
    setSiteId(id); setTarget(null); setStepId(""); setConfirmed(false); setLoadError(""); setResult(null);
    if (!id) return;
    startLoading(async () => {
      try {
        const response = await readLandingPageTemplateTargetAction(id);
        if (generation !== loadGeneration.current) return;
        if (!response.ok) { setLoadError(response.message); return; }
        setTarget(response.target);
        const first = response.target.steps.find((item) => templateStepAvailability(selected, response.target, item).ok);
        setStepId(first?.id ?? "");
      } catch {
        if (generation === loadGeneration.current) setLoadError("無法讀取這個網站的步驟，請稍後再試。");
      }
    });
  }

  function apply() {
    if (!target || !step || !confirmed || busy) return;
    const data = new FormData();
    data.set(csrfName, csrfToken);
    data.set("templateKind", selected.kind); data.set("templateId", selected.id);
    data.set("pageId", target.id); data.set("stepId", step.id); data.set("revision", String(target.revision));
    startApplying(async () => {
      try {
        const response = await applyLandingPageTemplateAction({ status: "idle", message: "" }, data);
        if (response.status === "success") {
          setResult({ tone: "success", text: response.message, href: landingPageEditorHref(target.id, step.id) });
          if (response.revision) setTarget({ ...target, revision: response.revision });
        } else setResult({ tone: "error", text: response.message, conflict: response.code === "conflict" });
      } catch {
        setResult({ tone: "error", text: "連線中斷，頁面內容沒有變更，請稍後再試。" });
      }
    });
  }

  return <Modal labelledBy="use-template-title" onClose={() => { if (!applying) onClose(); }} size="max-w-xl">
    <h2 id="use-template-title" className="text-lg font-bold text-slate-950">使用「{selected.name}」</h2>
    <fieldset className="mt-4 grid gap-2 sm:grid-cols-2" disabled={busy || applied}>
      <legend className="sr-only">使用方式</legend>
      <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${mode === "create" ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}><input data-autofocus type="radio" name="template-use-mode" checked={mode === "create"} onChange={() => setMode("create")} className="mt-1" /><span><strong className="block text-slate-950">建立新網站</strong><span className="text-slate-600">用這個範本當作新網站的第一個頁面。</span></span></label>
      <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm ${mode === "apply" ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}><input type="radio" name="template-use-mode" checked={mode === "apply"} onChange={() => setMode("apply")} className="mt-1" /><span><strong className="block text-slate-950">套用到現有網站</strong><span className="text-slate-600">取代某個步驟目前的頁面內容。</span></span></label>
    </fieldset>

    {mode === "create" ? <div className="mt-5 grid gap-3">
      <p className="text-sm leading-6 text-slate-600">下一步填寫網站名稱與網址{selected.kind === "platform" ? "，網站目標會依範本設定" : "，並選擇網站目標"}。範本裡的報名表、商品與步驟連結需要建立後再設定。</p>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={onClose} className={secondaryButton}>取消</button><Link href={templateCreateHref(selected.kind === "platform" ? { kind: "platform", id: selected.id, goal: selected.goal } : { kind: "mine", id: selected.id })} className={primaryButton}><WandSparkles size={16} aria-hidden />前往建立</Link></div>
    </div> : <div className="mt-5 grid gap-4">
      {sites === null ? <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">請先在左上角選擇一個銷售專案，才能把範本套用到該專案的網站。<Link href="/projects" className="ml-1 font-semibold underline">前往銷售專案</Link></p>
        : sites.length === 0 ? <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">目前專案還沒有一頁式網站，請改用「建立新網站」。</p>
          : <>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">選擇網站
              <select className={control} value={siteId} disabled={busy || applied} onChange={(event) => load(event.currentTarget.value)}><option value="">請選擇網站</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select>
            </label>
            {loading ? <p role="status" className="text-sm text-slate-600">正在讀取步驟…</p> : null}
            {loadError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{loadError}</p> : null}
            {target ? <fieldset disabled={busy || applied} className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold text-slate-700">選擇要取代的步驟</legend>
              {target.steps.map((item) => {
                const availability = templateStepAvailability(selected, target, item);
                return <label key={item.id} className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${availability.ok ? "cursor-pointer border-slate-200 hover:bg-slate-50" : "border-slate-100 bg-slate-50 text-slate-500"} ${stepId === item.id ? "border-blue-600 bg-blue-50" : ""}`}>
                  <input type="radio" name="template-target-step" value={item.id} checked={stepId === item.id} disabled={!availability.ok} onChange={() => { setStepId(item.id); setConfirmed(false); setResult(null); }} className="mt-1" />
                  <span className="min-w-0"><strong className="block break-words text-slate-900">{item.name}</strong><span className="text-xs">{funnelStepLabels[item.type]}{availability.ok ? "" : `・${availability.reason}`}</span></span>
                </label>;
              })}
            </fieldset> : null}
            {step ? <label className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <input type="checkbox" checked={confirmed} disabled={busy || applied} onChange={(event) => setConfirmed(event.currentTarget.checked)} className="mt-1" />
              <span>我了解套用後會<strong>取代「{step.name}」目前的頁面內容</strong>。步驟的商品綁定會保留；範本內的報名表與步驟連結需要重新設定。已發布的網站在重新發布前不會改變。</span>
            </label> : null}
            {result ? <p role={result.tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${result.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{result.text}{result.href ? <> <Link href={result.href} className="font-semibold underline">前往編輯器</Link></> : null}{result.conflict ? <> <button type="button" onClick={() => load(siteId)} className="font-semibold underline">重新讀取網站</button></> : null}</p> : null}
            <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={applying} onClick={onClose} className={secondaryButton}>{applied ? "完成" : "取消"}</button>{!applied ? <button type="button" disabled={!step || !confirmed || busy} onClick={apply} className={primaryButton}>{applying ? "套用中…" : "套用範本"}</button> : null}</div>
          </>}
    </div>}
  </Modal>;
}

function RenameTemplateDialog({ csrfName, csrfToken, template, onClose, onRenamed }: { csrfName: string; csrfToken: string; template: LandingPageTemplateSummary; onClose: () => void; onRenamed: (name: string) => void }) {
  const [name, setName] = useState(template.name);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const trimmed = name.trim();
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || pending) return;
    const data = new FormData();
    data.set(csrfName, csrfToken); data.set("templateId", template.id); data.set("name", trimmed);
    startTransition(async () => {
      try {
        const response = await renameLandingPageTemplateAction({ status: "idle", message: "" }, data);
        if (response.status === "success") onRenamed(trimmed); else setError(response.message);
      } catch { setError("連線中斷，名稱沒有變更，請稍後再試。"); }
    });
  }
  return <Modal labelledBy="rename-template-title" onClose={() => { if (!pending) onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="rename-template-title" className="text-lg font-bold text-slate-950">範本改名</h2>
      <label className="mt-4 grid gap-1.5 text-sm font-semibold text-slate-700">範本名稱<input data-autofocus required maxLength={LANDING_PAGE_TEMPLATE_NAME_MAX_LENGTH} value={name} disabled={pending} onChange={(event) => setName(event.currentTarget.value)} className={control} /></label>
      {error ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={pending} onClick={onClose} className={secondaryButton}>取消</button><button type="submit" disabled={!trimmed || pending || trimmed === template.name} className={primaryButton}>{pending ? "儲存中…" : "儲存名稱"}</button></div>
    </form>
  </Modal>;
}

function DeleteTemplateDialog({ csrfName, csrfToken, template, onClose, onDeleted }: { csrfName: string; csrfToken: string; template: LandingPageTemplateSummary; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function remove() {
    if (pending) return;
    const data = new FormData();
    data.set(csrfName, csrfToken); data.set("templateId", template.id);
    startTransition(async () => {
      try {
        const response = await deleteLandingPageTemplateAction({ status: "idle", message: "" }, data);
        if (response.status === "success") onDeleted(); else setError(response.message);
      } catch { setError("連線中斷，範本沒有刪除，請稍後再試。"); }
    });
  }
  return <Modal role="alertdialog" labelledBy="delete-template-title" onClose={() => { if (!pending) onClose(); }}>
    <h2 id="delete-template-title" className="text-lg font-bold text-slate-950">刪除範本「{template.name}」？</h2>
    <p className="mt-2 text-sm leading-6 text-slate-600">刪除後無法復原。已經用這個範本建立或套用的網站內容不會受影響。</p>
    {error ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
    <div className="mt-5 flex flex-wrap justify-end gap-2"><button data-autofocus type="button" disabled={pending} onClick={onClose} className={secondaryButton}>取消</button><button type="button" disabled={pending} onClick={remove} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-red-700 px-3 text-sm font-bold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-50">{pending ? "刪除中…" : "刪除範本"}</button></div>
  </Modal>;
}
