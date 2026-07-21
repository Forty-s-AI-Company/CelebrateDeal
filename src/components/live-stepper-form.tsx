"use client";

import { useState } from "react";
import type { Affiliate, InteractionScript, MessageTemplate, Product, RegistrationForm, Video } from "@prisma/client";
import { Ban, Bell, Calendar, Check, ClipboardList, Gauge, Package, PlaySquare, ScrollText, Shield } from "lucide-react";
import { upsertLiveAction } from "@/app/actions";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import { createLivePreview } from "@/lib/live-preview";
import { SubmitButton } from "@/components/ui";

const steps = [
  { key: "basics", label: "基本資料", icon: Calendar },
  { key: "media", label: "影片 / Live Input", icon: PlaySquare },
  { key: "products", label: "商品", icon: Package },
  { key: "form", label: "報名頁", icon: ClipboardList },
  { key: "template", label: "通知", icon: Bell },
  { key: "script", label: "互動腳本", icon: ScrollText },
  { key: "rules", label: "規則", icon: Shield },
  { key: "review", label: "發布", icon: Check },
];

function StepPanel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return <div className={active ? "grid gap-4 rounded-lg border border-border bg-white p-5" : "hidden"}>{children}</div>;
}

export function LiveStepperForm({
  videos,
  products,
  forms,
  templates,
  scripts,
  affiliates,
  csrfToken,
  error,
}: {
  videos: Video[];
  products: Product[];
  forms: RegistrationForm[];
  templates: MessageTemplate[];
  scripts: InteractionScript[];
  affiliates: Affiliate[];
  csrfToken: string;
  error?: string;
}) {
  const [activeStep, setActiveStep] = useState(0);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewAccentCopy, setPreviewAccentCopy] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const preview = createLivePreview({
    title: previewTitle,
    accentCopy: previewAccentCopy,
    products,
    selectedProductIds,
  });

  return (
    <form action={upsertLiveAction} className="grid gap-5">
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      {error === "invalid_reference" ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          直播關聯資料無效，請重新選擇目前商店的影片、表單、模板、腳本與商品。
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <button
            key={step.key}
            type="button"
            onClick={() => setActiveStep(index)}
            className={`flex h-14 items-center justify-center gap-2 rounded-md border text-sm font-semibold transition ${
              activeStep === index ? "border-primary bg-blue-50 text-primary" : "border-border bg-white text-slate-500"
            }`}
          >
            <step.icon size={17} />
            {step.label}
          </button>
        ))}
      </div>

      <StepPanel active={activeStep === 0}>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          直播標題
          <input name="title" required onChange={(event) => setPreviewTitle(event.target.value)} className="h-10 rounded-md border border-border px-3" placeholder="例如：週五新品導購直播" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          Slug
          <input name="slug" required className="h-10 rounded-md border border-border px-3" placeholder="friday-new-arrivals" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          開播時間
          <input name="scheduledAt" type="datetime-local" required className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          直播說明
          <textarea name="description" rows={4} className="rounded-md border border-border px-3 py-2" />
        </label>
      </StepPanel>

      <StepPanel active={activeStep === 1}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            串流模式
            <select name="streamMode" className="h-10 rounded-md border border-border px-3">
              <option value="vod">Cloudflare Stream VOD</option>
              <option value="live">Cloudflare Stream Live</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            影片 / Live Input
            <select name="videoId" className="h-10 rounded-md border border-border px-3">
              <option value="">不綁定影片</option>
              {videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
            </select>
          </label>
        </div>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          Cloudflare Live Input UID
          <input name="cloudflareLiveInputUid" className="h-10 rounded-md border border-border px-3" placeholder="live input uid，可先留空" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          Hero 圖片 URL
          <input name="heroImageUrl" className="h-10 rounded-md border border-border px-3" placeholder="https://..." />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          促銷短句
          <input name="accentCopy" onChange={(event) => setPreviewAccentCopy(event.target.value)} className="h-10 rounded-md border border-border px-3" placeholder="直播限定優惠" />
        </label>
      </StepPanel>

      <StepPanel active={activeStep === 2}>
        {products.map((product) => (
          <label key={product.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <span>
              <span className="block text-sm font-semibold text-slate-900">{product.name}</span>
              <span className="block text-xs text-slate-500">庫存 {product.inventory}</span>
            </span>
            <input
              name="productIds"
              type="checkbox"
              value={product.id}
              onChange={(event) => setSelectedProductIds((currentIds) => (
                event.target.checked
                  ? [...currentIds, product.id]
                  : currentIds.filter((productId) => productId !== product.id)
              ))}
              className="h-5 w-5 accent-blue-600"
            />
          </label>
        ))}
      </StepPanel>

      <StepPanel active={activeStep === 3}>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          報名頁
          <select name="formId" className="h-10 rounded-md border border-border px-3">
            <option value="">不綁定表單</option>
            {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
          </select>
        </label>
      </StepPanel>

      <StepPanel active={activeStep === 4}>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          通知模板
          <select name="messageTemplateId" className="h-10 rounded-md border border-border px-3">
            <option value="">不綁定模板</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.channel}</option>)}
          </select>
        </label>
      </StepPanel>

      <StepPanel active={activeStep === 5}>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          互動腳本
          <select name="interactionScriptId" className="h-10 rounded-md border border-border px-3">
            <option value="">不綁定腳本</option>
            {scripts.map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}
          </select>
        </label>
      </StepPanel>

      <StepPanel active={activeStep === 6}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            允許聯盟來源
            <select name="affiliateMode" className="h-10 rounded-md border border-border px-3">
              <option value="enabled">啟用 ref 追蹤</option>
              <option value="disabled">停用</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            預設推廣碼
            <select name="defaultAffiliateCode" className="h-10 rounded-md border border-border px-3">
              <option value="">不指定</option>
              {affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.code}>{affiliate.name} · {affiliate.code}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            觀看人數上限
            <input name="maxConcurrentViewers" type="number" defaultValue={500} className="h-10 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            點數低於多少時停止推播
            <input name="stopWhenCreditsBelow" type="number" defaultValue={300} className="h-10 rounded-md border border-border px-3" />
          </label>
        </div>
        <p className="flex items-start gap-2 rounded-md bg-orange-50 p-3 text-sm text-orange-700">
          <Ban size={16} className="mt-0.5 shrink-0" />
          黑名單會在名單提交與互動事件中做風險控管；此版先套用資料模型與後台管理。
        </p>
      </StepPanel>

      <StepPanel active={activeStep === 7}>
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-700">
              <Gauge size={18} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">確認建立 Cloudflare-first 直播間</h2>
              <p className="mt-1 text-sm text-slate-500">直播頁會支援 VOD / Live Input、商品浮出、官方角色訊息、CTA 切換、聯盟來源追蹤與用量規則。</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-xs font-bold uppercase text-blue-500">Playback</p>
                  <p className="mt-1 font-semibold text-slate-950">Cloudflare Stream ready</p>
                </div>
                <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
                  <p className="text-xs font-bold uppercase text-orange-500">Sales moment</p>
                  <p className="mt-1 font-semibold text-slate-950">商品 Pop-up + CTA</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-xs font-bold uppercase text-emerald-500">Lead capture</p>
                  <p className="mt-1 font-semibold text-slate-950">報名表與通知模板</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase text-slate-500">Control</p>
                  <p className="mt-1 font-semibold text-slate-950">黑名單、聯盟與配額</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-slate-950 p-3 shadow-2xl">
            <div className="overflow-hidden rounded-[22px] bg-slate-900 text-white">
              <div className="relative aspect-[9/16] bg-[radial-gradient(circle_at_30%_20%,#475569,transparent_28%),linear-gradient(160deg,#0f172a,#111827_45%,#020617)]">
                <div className="absolute left-3 right-3 top-3 flex items-center justify-between">
                  <div className="max-w-[70%] truncate rounded-full bg-black/35 px-3 py-1.5 text-xs font-bold backdrop-blur">{preview.title}</div>
                  <div className="rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-black">LIVE</div>
                </div>
                <div className="absolute bottom-28 left-3 right-3 rounded-2xl bg-white p-3 text-slate-950 shadow-2xl">
                  <div className="flex gap-3">
                    <div className="h-16 w-16 rounded-xl bg-orange-100" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-orange-600">{preview.accentCopy}</p>
                      {preview.productNames.length > 0 ? (
                        <div className="mt-1 space-y-1 text-sm font-bold">
                          {preview.productNames.map((productName, index) => <p key={`${productName}-${index}`} className="truncate">{productName}</p>)}
                          {preview.remainingProductCount > 0 ? <p className="text-xs font-medium text-slate-500">及其他 {preview.remainingProductCount} 件商品</p> : null}
                        </div>
                      ) : (
                        <p className="mt-1 truncate font-bold text-slate-500">{preview.emptyProductLabel}</p>
                      )}
                      <button type="button" className="mt-2 h-8 w-full rounded-lg bg-orange-500 text-xs font-black text-white">立即搶購</button>
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-14 left-3 max-w-[78%] rounded-2xl bg-black/45 px-3 py-2 text-xs backdrop-blur">
                  <b>AI 主持人</b>
                  <span className="ml-2 rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px]">官方</span>
                  <p className="mt-1 text-white/85">優惠在這一段會自動跳出，不用手動場控。</p>
                </div>
                <div className="absolute bottom-0 left-0 right-0 grid grid-cols-3 gap-2 bg-black/60 p-3 backdrop-blur">
                  <span className="rounded-xl bg-white py-2 text-center text-xs font-black text-slate-950">聊天</span>
                  <span className="rounded-xl bg-white/10 py-2 text-center text-xs font-black">商品</span>
                  <span className="rounded-xl bg-white/10 py-2 text-center text-xs font-black">報名</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </StepPanel>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setActiveStep((step) => Math.max(0, step - 1))}
          className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-slate-600"
        >
          上一步
        </button>
        {activeStep < steps.length - 1 ? (
          <button
            type="button"
            onClick={() => setActiveStep((step) => Math.min(steps.length - 1, step + 1))}
            className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white"
          >
            下一步
          </button>
        ) : (
          <SubmitButton>建立直播間</SubmitButton>
        )}
      </div>
    </form>
  );
}
