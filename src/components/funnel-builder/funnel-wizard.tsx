"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { FUNNEL_TEMPLATES, type FunnelArchetype, type FunnelTemplate, type FunnelTemplateCategory } from "@/lib/funnel-templates";

const CATEGORY_TABS: Array<{ value: "all" | FunnelTemplateCategory; label: string }> = [
  { value: "all", label: "全部範本" }, { value: "business", label: "商業自媒體" },
  { value: "technology", label: "AI與科技" }, { value: "finance", label: "投資理財" },
  { value: "beauty", label: "身心美業" },
];
const ARCHETYPE_BUTTONS: Array<{ value: FunnelArchetype; label: string }> = [
  { value: "high_ticket", label: "高客單銷講" }, { value: "lead_magnet", label: "爆款引流" }, { value: "summit", label: "多方案大會" },
];

export function funnelModuleLabels(template: FunnelTemplate) {
  const labels: Record<string, string> = { hero_banner: "形象 Hero", carousel_slider: "輪播", countdown_timer: "倒數", pricing_table: "方案卡", lead_form: "名單表單", accordion_faq: "FAQ" };
  return [...new Set(template.pageBlocks.map((block) => labels[block.type]))].filter(Boolean);
}

export function FunnelWizard({ onApply, onBlank }: { onApply: (template: FunnelTemplate) => void; onBlank: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [category, setCategory] = useState<"all" | FunnelTemplateCategory>("all");
  const [archetype, setArchetype] = useState<FunnelArchetype | null>(null);
  const [selected, setSelected] = useState<FunnelTemplate | null>(null);
  const [preview, setPreview] = useState<FunnelTemplate | null>(null);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const templates = useMemo(() => FUNNEL_TEMPLATES.filter((template) => (category === "all" || template.category === category) && (!archetype || template.archetype === archetype)), [archetype, category]);

  function chooseTemplate(template: FunnelTemplate) { setSelected(template); setStep(3); }
  function applyTemplate() { if (selected) onApply(selected); }

  return (
    <section aria-labelledby="funnel-wizard-title" className="rounded-2xl border border-blue-200 bg-gradient-to-br from-white to-blue-50 p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-widest text-blue-700">3 秒建立銷講漏斗</p><h2 id="funnel-wizard-title" className="mt-1 text-xl font-bold text-slate-950">3 步驟建置精靈</h2></div>
        <ol aria-label="精靈進度" className="flex gap-2 text-xs font-semibold">{[1, 2, 3].map((item) => <li key={item} aria-current={step === item ? "step" : undefined} className={`rounded-full px-3 py-1.5 ${step === item ? "bg-blue-700 text-white" : "bg-white text-slate-500"}`}>步驟 {item}</li>)}</ol>
      </div>

      {step === 1 ? <div className="mt-6 grid gap-4 md:grid-cols-2">
        <button type="button" onClick={onBlank} className="min-h-40 rounded-xl border-2 border-slate-200 bg-white p-5 text-left hover:border-blue-400"><span className="text-3xl">🎨</span><strong className="mt-3 block text-lg">從空白畫布開始</strong><span className="mt-1 block text-sm text-slate-600">保留原本建立流程，從基本資料開始設定。</span></button>
        <button type="button" onClick={() => setStep(2)} className="relative min-h-40 rounded-xl border-2 border-blue-600 bg-blue-700 p-5 text-left text-white shadow-lg"><span className="absolute right-4 top-4 rounded-full bg-amber-300 px-2 py-1 text-xs font-bold text-slate-900">推薦</span><span className="text-3xl">🚀</span><strong className="mt-3 block text-lg">從高轉換範本挑選</strong><span className="mt-1 block text-sm text-blue-100">套用完整區塊與銷講文案，再快速微調。</span></button>
      </div> : null}

      {step === 2 ? <div className="mt-6">
        <div className="flex flex-wrap gap-2" aria-label="銷講類型">{ARCHETYPE_BUTTONS.map((item) => <button type="button" key={item.value} aria-pressed={archetype === item.value} onClick={() => setArchetype(archetype === item.value ? null : item.value)} className={`rounded-full px-3 py-2 text-sm font-semibold ${archetype === item.value ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>{item.label}</button>)}</div>
        <div role="tablist" aria-label="範本分類" className="mt-4 flex gap-2 overflow-x-auto pb-2">{CATEGORY_TABS.map((tab) => <button role="tab" type="button" key={tab.value} aria-selected={category === tab.value} onClick={() => setCategory(tab.value)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${category === tab.value ? "bg-blue-700 text-white" : "border bg-white text-slate-700"}`}>{tab.label}</button>)}</div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">{templates.map((template) => <article key={template.id} data-testid={`template-${template.id}`} className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <Image src={template.thumbnailUrl} alt="" width={640} height={360} className="aspect-video w-full bg-slate-100 object-cover" />
          <div className="p-4"><div className="flex items-start justify-between gap-2"><h3 className="font-bold text-slate-950">{template.name}</h3><span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">CVR {template.estimatedCvr}</span></div><p className="mt-2 text-sm leading-6 text-slate-600">{template.description}</p><div className="mt-3 flex flex-wrap gap-1">{funnelModuleLabels(template).map((label) => <span key={label} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{label}</span>)}</div><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setPreview(template); setDevice("mobile"); }} className="min-h-10 rounded-lg border font-semibold text-slate-700">視覺預覽</button><button type="button" onClick={() => chooseTemplate(template)} className="min-h-10 rounded-lg bg-blue-700 font-semibold text-white">選擇範本</button></div></div>
        </article>)}</div>
        {templates.length === 0 ? <p role="status" className="mt-6 rounded-lg bg-white p-5 text-center text-slate-600">目前此分類尚無範本，可切換「全部範本」查看。</p> : null}
      </div> : null}

      {step === 3 && selected ? <div className="mt-6 rounded-xl bg-white p-5 text-center"><span className="text-4xl">✨</span><h3 className="mt-3 text-xl font-bold">已選擇「{selected.name}」</h3><p className="mt-2 text-sm text-slate-600">將預填公開標題與 {selected.pageBlocks.length} 個完整漏斗區塊，之後仍能自由編輯。</p><div className="mt-5 flex flex-wrap justify-center gap-3"><button type="button" onClick={() => setStep(2)} className="min-h-11 rounded-lg border px-5 font-semibold">返回挑選</button><button type="button" onClick={applyTemplate} className="min-h-11 rounded-lg bg-blue-700 px-6 font-bold text-white">套用此範本</button></div></div> : null}

      {preview ? <div role="dialog" aria-modal="true" aria-label={`${preview.name}預覽`} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4"><div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-bold">{preview.name}</h3><button type="button" onClick={() => setPreview(null)} className="min-h-10 rounded-lg border px-4 font-semibold">關閉預覽</button></div><div className="mt-4 flex justify-center gap-2"><button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={`rounded-lg px-4 py-2 ${device === "mobile" ? "bg-blue-700 text-white" : "bg-slate-100"}`}>📱 手機版</button><button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={`rounded-lg px-4 py-2 ${device === "desktop" ? "bg-blue-700 text-white" : "bg-slate-100"}`}>💻 電腦版</button></div><div data-testid="template-preview" data-device={device} className={`mx-auto mt-4 overflow-hidden rounded-xl border bg-slate-50 transition-all ${device === "mobile" ? "max-w-sm" : "max-w-4xl"}`}><Image src={preview.thumbnailUrl} alt={`${preview.name}完整預覽`} width={1280} height={720} className="aspect-video w-full object-cover" /><div className="space-y-3 p-5"><h4 className="text-2xl font-black">{preview.headline}</h4>{preview.pageBlocks.map((block) => <div key={block.id} className="rounded-lg border bg-white p-3 text-sm font-semibold text-slate-700">{funnelModuleLabels({ ...preview, pageBlocks: [block] })[0]}</div>)}</div></div></div></div> : null}
    </section>
  );
}
