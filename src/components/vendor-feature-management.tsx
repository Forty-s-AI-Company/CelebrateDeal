"use client";

import { useState, useTransition } from "react";
import { BarChart3, CalendarCheck, Handshake, Radio, ReceiptText, Rows3 } from "lucide-react";
import { updateVendorFeaturesAction } from "@/app/(app)/settings/features/actions";
import { ALL_VENDOR_FEATURE_MODULES, FEATURE_PRESETS, type VendorFeatureModule } from "@/lib/vendor-feature-toggles";

const MODULE_COPY = {
  funnel_builder: { title: "一頁式銷講漏斗", description: "漏斗頁、名單收集與報名表單。", Icon: Rows3 },
  live_webinar: { title: "直播銷講研討會", description: "直播間、回放與即時互動工具。", Icon: Radio },
  affiliate_program: { title: "團隊分銷與推廣夥伴", description: "推廣夥伴、分潤規則與佣金結算。", Icon: Handshake },
  tax_remuneration: { title: "勞報單與稅務出款", description: "台灣二代健保、勞報單審核與稅務匯出。", Icon: ReceiptText },
  analytics_advanced: { title: "進階數據分析", description: "直播、回放及漏斗成效分析。", Icon: BarChart3 },
  consultation_booking: { title: "諮詢預約工作台", description: "可預約時段、一對一諮詢與到場狀態管理。", Icon: CalendarCheck },
} satisfies Record<VendorFeatureModule, { title: string; description: string; Icon: typeof Rows3 }>;

const PRESET_COPY = [
  { key: "live_course", label: "🎯 純直播賣課模式", description: "漏斗頁＋直播間＋基礎金流" },
  { key: "high_ticket_consulting", label: "💼 高客單諮詢模式", description: "漏斗頁＋預約工作台＋數據看板" },
  { key: "flagship", label: "🚀 全功能旗艦模式", description: "解鎖全站所有進階功能" },
] as const;

export function VendorFeatureManagement({ initialModules, csrfToken }: { initialModules: VendorFeatureModule[]; csrfToken: string }) {
  const [modules, setModules] = useState(initialModules);
  const [message, setMessage] = useState("設定已同步");
  const [isPending, startTransition] = useTransition();

  function save(next: readonly VendorFeatureModule[]) {
    const normalized = ALL_VENDOR_FEATURE_MODULES.filter((module) => next.includes(module));
    const previous = modules;
    setModules(normalized);
    setMessage("儲存中…");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("_csrf", csrfToken);
      formData.set("enabledModules", JSON.stringify(normalized));
      try {
        const result = await updateVendorFeaturesAction(formData);
        setModules(result.enabledModules);
        setMessage("已儲存，側邊欄已更新");
      } catch {
        setModules(previous);
        setMessage("儲存失敗，已還原原本設定");
      }
    });
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="preset-heading">
        <h2 id="preset-heading" className="text-lg font-bold text-slate-950">快速預設模式</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {PRESET_COPY.map((preset) => (
            <button key={preset.key} type="button" disabled={isPending} onClick={() => save(FEATURE_PRESETS[preset.key])} className="min-h-24 rounded-xl border border-border bg-white p-4 text-left transition hover:border-primary hover:bg-blue-50 disabled:opacity-60">
              <span className="block font-semibold text-slate-950">{preset.label}</span>
              <span className="mt-1 block text-sm text-slate-600">{preset.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="module-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="module-heading" className="text-lg font-bold text-slate-950">個別模組</h2>
          <p role="status" aria-live="polite" className="text-sm text-slate-600">{message}</p>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {ALL_VENDOR_FEATURE_MODULES.map((module) => {
            const { title, description, Icon } = MODULE_COPY[module];
            const enabled = modules.includes(module);
            return (
              <article key={module} className="flex items-start gap-4 rounded-xl border border-border bg-white p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-blue-50 text-primary"><Icon size={21} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-950">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{description}</p></div>
                <button type="button" role="switch" aria-checked={enabled} aria-label={`${title}：${enabled ? "已啟用" : "已停用"}`} disabled={isPending} onClick={() => save(enabled ? modules.filter((item) => item !== module) : [...modules, module])} className={`relative h-7 w-12 shrink-0 rounded-full transition ${enabled ? "bg-primary" : "bg-slate-300"}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${enabled ? "left-6" : "left-1"}`} />
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
