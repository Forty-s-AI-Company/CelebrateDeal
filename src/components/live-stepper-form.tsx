"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Affiliate, InteractionScript, MessageTemplate, Product, RegistrationForm, Video } from "@prisma/client";
import { Ban, Calendar, Check, Gauge, Package, PlaySquare, Shield } from "lucide-react";
import { upsertLiveAction } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MediaUploadField } from "@/components/media-upload-field";
import {
  StreamAllocationEditor,
  type StreamAllocationMemberOption,
  type StreamAllocationPageOption,
} from "@/components/stream-allocation-editor";
import { useLiveStudioDraft } from "@/components/use-live-studio-draft";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import { createLivePreview } from "@/lib/live-preview";
import {
  getLivePublishReadiness,
  requiresLivePublishReadiness,
  type LivePublishRequirementCodeWithReminder,
} from "@/lib/live-publish-readiness";
import {
  emptyLiveStudioDraft,
  type LiveStudioDraftEnvelope,
  type LiveStudioDraftPayload,
} from "@/lib/live-studio-draft";

const steps = [
  { key: "basics", label: "基本資料", icon: Calendar },
  { key: "conversion", label: "商品與轉換", icon: Package },
  { key: "media", label: "媒體", icon: PlaySquare },
  { key: "operations", label: "直播與互動", icon: Shield },
  { key: "review", label: "預覽發布", icon: Check },
];
const requiredFieldsMessage = "請先完成本步驟的必填欄位，再繼續下一步。";

type LiveProductOption = Pick<Product, "id" | "name" | "inventory">;
type LiveFormOption = Pick<RegistrationForm, "id" | "name">;
type LiveTemplateOption = Pick<MessageTemplate, "id" | "name" | "channel" | "trigger">;
type LiveScriptOption = Pick<InteractionScript, "id" | "name">;
type LiveAffiliateOption = Pick<Affiliate, "id" | "name" | "code">;
type LiveStudioPreset = LiveStudioDraftPayload["studioPreset"];
type LiveReadinessResources = {
  studioPreset: LiveStudioPreset;
  products: LiveProductOption[];
  productIds: string[];
  videos: Array<Pick<Video, "id" | "title">>;
  videoId: string;
  forms: LiveFormOption[];
  formId: string;
  templates: LiveTemplateOption[];
  templateId: string;
  reminderTemplates: LiveTemplateOption[];
  reminderTemplateId: string;
  scripts: LiveScriptOption[];
  scriptId: string;
};

const liveStudioPresetOptions: Array<{
  value: LiveStudioPreset;
  label: string;
  description: string;
}> = [
  { value: "COMMERCE", label: "商品銷售直播", description: "適合導購、報名與開播提醒；發布前會檢查商品、Email 與互動腳本。" },
  { value: "CONTENT", label: "內容／課程直播", description: "適合分享、教學與回放；商品可留空，至少需要可播放媒體。" },
  { value: "CUSTOM", label: "從空白開始", description: "保留完整五步設定，自行決定商品、通知、互動與用量規則。" },
];

function LiveStudioPurposeStarter({
  selectedPreset,
  onSelect,
}: {
  selectedPreset: LiveStudioPreset;
  onSelect: (preset: LiveStudioPreset) => void;
}) {
  const selected = liveStudioPresetOptions.find((option) => option.value === selectedPreset) ?? liveStudioPresetOptions[2];
  return (
    <section aria-labelledby="live-studio-purpose-title" className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <div>
        <h2 id="live-studio-purpose-title" className="font-semibold text-slate-950">先選這場直播的用途</h2>
        <p className="mt-1 text-sm text-slate-700">開始器只補空白欄位與步驟提示，不會移除已選商品或覆寫既有內容。</p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {liveStudioPresetOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selectedPreset === option.value}
            onClick={() => onSelect(option.value)}
            className={`min-h-28 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              selectedPreset === option.value
                ? "border-primary bg-white text-slate-950 shadow-sm"
                : "border-blue-100 bg-blue-50/60 text-slate-700 hover:border-blue-300 hover:bg-white"
            }`}
          >
            <span className="block font-semibold">{option.label}</span>
            <span className="mt-1 block text-xs leading-5">{option.description}</span>
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-blue-900">
        已選擇：{selected?.label}。{selected?.description}
      </p>
    </section>
  );
}

function applyLiveStudioPreset(form: HTMLFormElement | null, preset: LiveStudioPreset) {
  if (!form) return null;
  const presetControl = form.elements.namedItem("studioPreset");
  if (presetControl instanceof HTMLInputElement) presetControl.value = preset;
  const accentControl = form.elements.namedItem("accentCopy");
  if (preset !== "COMMERCE" || !(accentControl instanceof HTMLInputElement) || accentControl.value.trim()) return null;
  accentControl.value = "直播限定優惠";
  return accentControl.value;
}

function useLiveStudioPresetSave(preset: LiveStudioPreset, scheduleSave: () => void) {
  const previousPresetRef = useRef(preset);
  useEffect(() => {
    if (previousPresetRef.current === preset) return;
    previousPresetRef.current = preset;
    scheduleSave();
  }, [preset, scheduleSave]);
}

function StepPanel({
  active,
  index,
  children,
}: {
  active: boolean;
  index: number;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`live-step-panel-${index}`}
      data-step-index={index}
      hidden={!active}
      className="grid gap-4 rounded-lg border border-border bg-white p-5"
    >
      {children}
    </div>
  );
}

function ProductSelection({
  products,
  selectedProductIds,
  onSelectionChange,
}: {
  products: LiveProductOption[];
  selectedProductIds: string[];
  onSelectionChange: (productId: string, checked: boolean) => void;
}) {
  if (products.length === 0) {
    return (
      <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
        目前沒有可綁定的啟用商品。你仍可先建立草稿，之後再從編輯頁補上商品。
      </p>
    );
  }

  return products.map((product) => (
    <label key={product.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <span>
        <span className="block text-sm font-semibold text-slate-900">{product.name}</span>
        <span className="block text-xs text-slate-500">庫存 {product.inventory}</span>
      </span>
      <input
        name="productIds"
        type="checkbox"
        value={product.id}
        defaultChecked={selectedProductIds.includes(product.id)}
        onChange={(event) => onSelectionChange(product.id, event.target.checked)}
        className="h-5 w-5 accent-blue-600"
      />
    </label>
  ));
}

function updateSelectedProductIds(currentIds: string[], productId: string, checked: boolean) {
  return checked
    ? [...currentIds, productId]
    : currentIds.filter((currentProductId) => currentProductId !== productId);
}

function buildLivePreview(title: string, accentCopy: string, products: LiveProductOption[], selectedProductIds: string[]) {
  return createLivePreview({ title, accentCopy, products, selectedProductIds });
}

function buildLivePublishReadiness(resources: LiveReadinessResources) {
  return getLivePublishReadiness({
    studioPreset: resources.studioPreset,
    productCount: resources.productIds.length,
    productsReady: resources.productIds.every((productId) => resources.products.some((product) => product.id === productId)),
    videoReady: resources.videos.some((video) => video.id === resources.videoId),
    formReady: resources.forms.some((form) => form.id === resources.formId),
    registrationEmailReady: resources.templates.some((template) => template.id === resources.templateId),
    liveReminderEmailReady: resources.reminderTemplates.some((template) => template.id === resources.reminderTemplateId),
    interactionScriptReady: resources.scripts.some((script) => script.id === resources.scriptId),
  });
}

function liveStatusAction(status: string) {
  switch (status) {
    case "draft": return { value: "scheduled", label: "排程發布", confirm: "確定要讓這場直播進入已排程、可公開存取的狀態嗎？" };
    case "scheduled": return { value: "live", label: "開始直播", confirm: "確定要將這場直播標記為直播中嗎？" };
    case "live": return { value: "ended", label: "結束直播", confirm: "確定要結束這場直播嗎？" };
    case "ended": return { value: "scheduled", label: "重新排程", confirm: "確定要重新排程並開放這場直播嗎？" };
    default: return null;
  }
}

const readinessCopy: Record<LivePublishRequirementCodeWithReminder, { label: string; step: number; action: string }> = {
  media: { label: "可播放的影片或 Live Input", step: 2, action: "前往媒體" },
  products: { label: "啟用且已確認履約類型的商品", step: 1, action: "前往商品與轉換" },
  registration_form: { label: "有效的報名表單", step: 1, action: "前往商品與轉換" },
  registration_email: { label: "可寄送的報名成功 Email", step: 1, action: "前往商品與轉換" },
  live_reminder_email: { label: "可寄送的開播提醒 Email", step: 1, action: "前往商品與轉換" },
  interaction_script: { label: "已發布的互動腳本", step: 3, action: "前往直播與互動" },
};

function LiveReviewPanel({
  preview,
  readiness,
  onFix,
}: {
  preview: ReturnType<typeof buildLivePreview>;
  readiness: ReturnType<typeof getLivePublishReadiness>;
  onFix: (step: number) => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="grid gap-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <Gauge size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-950">確認直播間設定</h2>
            <p className="mt-1 text-sm text-slate-500">直播頁會支援 VOD / Live Input、商品浮出、官方角色訊息、CTA 切換、聯盟來源追蹤與用量規則。</p>
          </div>
        </div>

        <section
          aria-labelledby="live-publish-readiness-title"
          aria-live="polite"
          className={`rounded-xl border p-4 ${readiness.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
        >
          <h3 id="live-publish-readiness-title" className="font-semibold text-slate-950">
            {readiness.mode === "commerce" ? "銷售型直播發布檢查" : "內容直播發布檢查"}
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {readiness.mode === "commerce"
              ? "已選擇商品。公開前需要完整的播放、報名、通知與互動路徑。"
              : "目前沒有選擇商品，會以內容直播發布；公開前仍需播放、報名與兩種通知 Email。"}
          </p>
          <p className={`mt-3 text-sm font-semibold ${readiness.ready ? "text-emerald-800" : "text-amber-900"}`}>
            {readiness.ready ? "發布條件已完成" : `還有 ${readiness.blockers.length} 項需要完成`}
          </p>
          <ul className="mt-3 grid gap-2">
            {readiness.requirements.map((requirement) => {
              const copy = readinessCopy[requirement.code];
              return (
                <li key={requirement.code} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/80 px-3 py-2 text-sm">
                  <span className={requirement.ready ? "font-medium text-emerald-800" : "font-medium text-amber-950"}>
                    {requirement.ready ? "已完成" : "待完成"} · {copy.label}
                  </span>
                  {!requirement.ready ? (
                    <button type="button" onClick={() => onFix(copy.step)} className="min-h-9 rounded-md border border-amber-300 bg-white px-3 font-semibold text-amber-900">
                      {copy.action}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-bold text-blue-700">播放設定</p>
              <p className="mt-1 font-semibold text-slate-950">建立後驗證串流狀態</p>
            </div>
            <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
              <p className="text-xs font-bold text-orange-700">導購時刻</p>
              <p className="mt-1 font-semibold text-slate-950">商品 Pop-up + CTA</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs font-bold text-emerald-700">名單收集</p>
              <p className="mt-1 font-semibold text-slate-950">報名表與通知模板</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold text-slate-600">營運控制</p>
              <p className="mt-1 font-semibold text-slate-950">黑名單、聯盟與配額</p>
            </div>
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <LivePhonePreview preview={preview} />
      </div>
    </div>
  );
}

function LivePhonePreview({ preview }: { preview: ReturnType<typeof buildLivePreview> }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-950 p-3">
      <div className="overflow-hidden rounded-xl bg-slate-900 text-white">
        <div className="relative aspect-[9/16] bg-[radial-gradient(circle_at_30%_20%,#475569,transparent_28%),linear-gradient(160deg,#0f172a,#111827_45%,#020617)]">
          <div className="absolute left-3 right-3 top-3 flex items-center justify-between">
            <div className="max-w-[70%] truncate rounded-full bg-slate-950 px-3 py-1.5 text-xs font-bold text-white">{preview.title}</div>
            <div className="rounded-full bg-red-700 px-2.5 py-1 text-[10px] font-black text-white">LIVE</div>
          </div>
          <div className="absolute bottom-28 left-3 right-3 rounded-2xl bg-white p-3 text-slate-950 shadow-2xl">
            <div className="flex gap-3">
              <div className="h-16 w-16 rounded-xl bg-orange-100" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-orange-800">{preview.accentCopy}</p>
                {preview.productNames.length > 0 ? (
                  <div className="mt-1 space-y-1 text-sm font-bold">
                    {preview.productNames.map((productName, index) => <p key={`${productName}-${index}`} className="truncate">{productName}</p>)}
                    {preview.remainingProductCount > 0 ? <p className="text-xs font-medium text-slate-500">及其他 {preview.remainingProductCount} 件商品</p> : null}
                  </div>
                ) : (
                  <p className="mt-1 truncate font-bold text-slate-700">{preview.emptyProductLabel}</p>
                )}
                <span aria-hidden="true" className="mt-2 grid h-8 w-full place-items-center rounded-lg bg-orange-700 text-xs font-black text-white">立即搶購</span>
              </div>
            </div>
          </div>
          <div className="absolute bottom-14 left-3 max-w-[78%] rounded-2xl bg-slate-950 px-3 py-2 text-xs text-white">
            <b>AI 主持人</b>
            <span className="ml-2 rounded-full bg-blue-700 px-1.5 py-0.5 text-[10px] text-white">官方</span>
            <p className="mt-1 text-white">優惠在這一段會自動跳出，不用手動場控。</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 grid grid-cols-3 gap-2 bg-black p-3">
            <span className="rounded-xl bg-white py-2 text-center text-xs font-black text-slate-950">聊天</span>
            <span className="rounded-xl bg-slate-800 py-2 text-center text-xs font-black text-white">商品</span>
            <span className="rounded-xl bg-slate-800 py-2 text-center text-xs font-black text-white">報名</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileLivePreviewToggle({ preview }: { preview: ReturnType<typeof buildLivePreview> }) {
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3 lg:hidden">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        查看即時手機預覽
      </summary>
      <div className="mx-auto mt-3 max-w-[320px]">
        <LivePhonePreview preview={preview} />
      </div>
    </details>
  );
}

function handleLiveFormInvalid(
  event: { preventDefault: () => void; target: unknown },
  invalidFocusPendingRef: { current: boolean },
  setActiveStep: (step: number) => void,
  setValidationMessage: (message: string) => void,
) {
  event.preventDefault();
  const control = event.target;
  if (!(control instanceof HTMLElement)) return;
  if (invalidFocusPendingRef.current) return;
  invalidFocusPendingRef.current = true;
  const panel = control.closest<HTMLElement>("[data-step-index]");
  const invalidStep = Number(panel?.dataset.stepIndex);
  if (Number.isInteger(invalidStep)) setActiveStep(invalidStep);
  setValidationMessage(requiredFieldsMessage);
  requestAnimationFrame(() => {
    control.focus();
    invalidFocusPendingRef.current = false;
  });
}

function submitOnlyAfterLatestDraft(
  event: FormEvent<HTMLFormElement>,
  activeStep: number,
  draft: Pick<ReturnType<typeof useLiveStudioDraft>, "getCurrentClaim" | "isCurrentFormSaved" | "saveNow">,
  form: HTMLFormElement | null,
) {
  const writeClaim = (claim: { draftId: string; revision: number }) => {
    if (!form) return false;
    const draftIdControl = form.elements.namedItem("liveDraftId") as HTMLInputElement | null;
    const revisionControl = form.elements.namedItem("liveDraftRevision") as HTMLInputElement | null;
    if (!draftIdControl || !revisionControl) return false;
    draftIdControl.value = claim.draftId;
    revisionControl.value = String(claim.revision);
    return true;
  };
  if (draft.isCurrentFormSaved(activeStep)) {
    const claim = draft.getCurrentClaim();
    if (!claim || !writeClaim(claim)) event.preventDefault();
    return;
  }
  event.preventDefault();
  const submitter = (event.nativeEvent as SubmitEvent).submitter;
  void draft.saveNow(activeStep).then((claim) => {
    if (!claim || !writeClaim(claim) || !form) return;
    form.requestSubmit(submitter instanceof HTMLButtonElement ? submitter : undefined);
  });
}

function LiveRulesFields({
  affiliates,
  initialValues,
  streamMembers,
  streamPages,
}: {
  affiliates: LiveAffiliateOption[];
  initialValues: LiveStudioDraftPayload;
  streamMembers: StreamAllocationMemberOption[];
  streamPages: StreamAllocationPageOption[];
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          允許聯盟來源
          <select name="affiliateMode" defaultValue={initialValues.affiliateMode} className="h-10 rounded-md border border-border px-3">
            <option value="enabled">啟用 ref 追蹤</option>
            <option value="disabled">停用</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          預設推廣碼
          <select name="defaultAffiliateCode" defaultValue={initialValues.defaultAffiliateCode} className="h-10 rounded-md border border-border px-3">
            <option value="">不指定</option>
            {affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.code}>{affiliate.name} · {affiliate.code}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          觀看人數上限
          <input name="maxConcurrentViewers" type="number" inputMode="numeric" min={1} defaultValue={initialValues.maxConcurrentViewers} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          點數低於多少時停止推播
          <input name="stopWhenCreditsBelow" type="number" inputMode="numeric" min={0} defaultValue={initialValues.stopWhenCreditsBelow} className="h-10 rounded-md border border-border px-3" />
        </label>
      </div>
      <StreamAllocationEditor initialValues={initialValues} members={streamMembers} pages={streamPages} />
      <p className="flex items-start gap-2 rounded-md bg-orange-50 p-3 text-sm text-orange-700">
        <Ban size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        成員／推廣頁額度會在 immutable usage ledger 寫入前 fail closed；額度用完會拒絕後續 heartbeat，不會自動扣款。
      </p>
    </>
  );
}

function liveFormError(error?: string) {
  const messages: Record<string, string> = {
    invalid_reference: "直播關聯資料無效，請重新選擇目前商店的影片、表單、模板、腳本與商品。",
    invalid_policy: "用量或聯盟來源規則無效，請確認模式、推廣碼與數值範圍。",
    payment_method_required: "啟用成員／推廣頁 Stream 額度前，必須先由 payment provider 驗證付款方式 reference；目前不會自動扣款。",
    draft_conflict: "這份直播草稿已有較新的版本；系統沒有覆蓋它。請確認目前載入內容後再繼續。",
    invalid_status: "直播狀態轉換無效，內容尚未發布。",
    invalid_draft: "直播草稿內容不完整或格式無效；系統沒有發布任何變更。請修正欄位並重新儲存草稿。",
    publish_not_ready: "公開條件尚未完成，系統保留目前草稿且沒有變更公開狀態。請依第五步檢查清單補齊後再發布。",
  };
  const message = error ? messages[error] : undefined;
  return message ? (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  ) : null;
}

function LiveSubmitActions({
  canSubmit,
  currentStatus,
  liveId,
  publishReady,
  replayEnabled,
  statusAction,
}: {
  canSubmit: boolean;
  currentStatus: string;
  liveId: string;
  publishReady: boolean;
  replayEnabled: boolean;
  statusAction: ReturnType<typeof liveStatusAction>;
}) {
  const canUnpublish = Boolean(liveId && ["scheduled", "ended"].includes(currentStatus));
  const saveDisabled = !canSubmit
    || (requiresLivePublishReadiness(currentStatus, replayEnabled) && !publishReady);
  const actionDisabled = !canSubmit
    || Boolean(statusAction && requiresLivePublishReadiness(statusAction.value, replayEnabled) && !publishReady);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <FormSubmitButton name="status" value={liveId ? currentStatus : "draft"} disabled={saveDisabled} pendingChildren="儲存中…" pendingMessage="正在儲存直播間，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark">
        {liveId ? "儲存變更" : "建立草稿並預覽"}
      </FormSubmitButton>
      {!liveId ? (
        <FormSubmitButton name="status" value="scheduled" disabled={!canSubmit || (requiresLivePublishReadiness("scheduled", replayEnabled) && !publishReady)} confirmMessage="確定要建立並排程這場直播嗎？" pendingChildren="排程中…" pendingMessage="正在建立並排程直播間，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md bg-cta px-4 text-sm font-semibold text-white transition hover:bg-cta-dark">
          建立並排程
        </FormSubmitButton>
      ) : statusAction ? (
        <FormSubmitButton name="status" value={statusAction.value} disabled={actionDisabled} confirmMessage={statusAction.confirm} pendingChildren="處理中…" pendingMessage="正在更新直播公開狀態，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md bg-cta px-4 text-sm font-semibold text-white transition hover:bg-cta-dark">
          {statusAction.label}
        </FormSubmitButton>
      ) : null}
      {canUnpublish ? (
        <FormSubmitButton name="status" value="draft" disabled={!canSubmit} confirmMessage="確定要將這場直播下架並回到草稿嗎？公開連結會立即停止顯示。" pendingChildren="下架中…" pendingMessage="正在將直播下架為草稿，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
          下架為草稿
        </FormSubmitButton>
      ) : null}
    </div>
  );
}

export function LiveStepperForm({
  videos,
  products,
  forms,
  templates,
  scripts,
  affiliates,
  streamMembers,
  streamPages,
  csrfToken,
  error,
  initialDraft,
  initialValues: suppliedInitialValues,
  liveId = "",
  currentStatus = "draft",
}: {
  videos: Array<Pick<Video, "id" | "title">>;
  products: LiveProductOption[];
  forms: LiveFormOption[];
  templates: LiveTemplateOption[];
  scripts: LiveScriptOption[];
  affiliates: LiveAffiliateOption[];
  streamMembers: StreamAllocationMemberOption[];
  streamPages: StreamAllocationPageOption[];
  csrfToken: string;
  error?: string;
  initialDraft?: LiveStudioDraftEnvelope;
  initialValues?: LiveStudioDraftPayload;
  liveId?: string;
  currentStatus?: string;
}) {
  const initialValues = initialDraft?.payload ?? suppliedInitialValues ?? emptyLiveStudioDraft();
  const registrationTemplates = templates.filter((template) => template.trigger === "registration_confirmed");
  const reminderTemplates = templates.filter((template) => template.trigger === "live_reminder");
  const [activeStep, setActiveStep] = useState(initialValues.activeStep);
  const [previewTitle, setPreviewTitle] = useState(initialValues.title);
  const [previewAccentCopy, setPreviewAccentCopy] = useState(initialValues.accentCopy);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(initialValues.productIds);
  const [validationMessage, setValidationMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const invalidFocusPendingRef = useRef(false);
  const [selectedVideoId, setSelectedVideoId] = useState(initialValues.videoId);
  const [selectedFormId, setSelectedFormId] = useState(initialValues.formId);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialValues.messageTemplateId);
  const [selectedScriptId, setSelectedScriptId] = useState(initialValues.interactionScriptId);
  const [replayEnabled, setReplayEnabled] = useState(initialValues.replayEnabled);
  const [studioPreset, setStudioPreset] = useState<LiveStudioPreset>(initialValues.studioPreset);
  const [selectedReminderTemplateId, setSelectedReminderTemplateId] = useState(initialValues.liveReminderTemplateId);
  const draft = useLiveStudioDraft({
    activeStep,
    csrfToken,
    formRef,
    initialDraft,
    liveId,
    saveOnMount: Boolean(liveId && !initialDraft),
  });
  useLiveStudioPresetSave(studioPreset, draft.scheduleSave);
  const preview = buildLivePreview(previewTitle, previewAccentCopy, products, selectedProductIds); const statusAction = liveId ? liveStatusAction(currentStatus) : null;
  const publishReadiness = buildLivePublishReadiness({ studioPreset, products, productIds: selectedProductIds, videos, videoId: selectedVideoId, forms, formId: selectedFormId, templates: registrationTemplates, templateId: selectedTemplateId, reminderTemplates, reminderTemplateId: selectedReminderTemplateId, scripts, scriptId: selectedScriptId });
  function validateCurrentStep() {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step-index="${activeStep}"]`);
    const invalidControl = panel?.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input:invalid, select:invalid, textarea:invalid");
    if (!invalidControl) {
      setValidationMessage("");
      return true;
    }

    setValidationMessage(requiredFieldsMessage);
    invalidControl.reportValidity();
    return false;
  }

  function moveToStep(nextStep: number) {
    if (nextStep > activeStep && !validateCurrentStep()) return;
    setValidationMessage(""); setActiveStep(nextStep); draft.scheduleSave(nextStep);
  }

  function selectStudioPreset(preset: LiveStudioPreset) {
    const accentCopy = applyLiveStudioPreset(formRef.current, preset);
    setStudioPreset(preset);
    if (accentCopy) setPreviewAccentCopy(accentCopy);
  }

  return (
    <form
      ref={formRef}
      action={upsertLiveAction}
      className="grid gap-5"
      onChange={() => draft.scheduleSave()}
      onInvalid={(event) => handleLiveFormInvalid(event, invalidFocusPendingRef, setActiveStep, setValidationMessage)}
      onSubmit={(event) => submitOnlyAfterLatestDraft(event, activeStep, draft, formRef.current)}
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      {liveId ? <input type="hidden" name="id" value={liveId} /> : null}
      <input type="hidden" name="liveDraftId" value={draft.draftId} readOnly />
      <input type="hidden" name="liveDraftRevision" value={draft.revision ?? ""} readOnly />
      <input type="hidden" name="studioPreset" value={studioPreset} readOnly />
      {liveFormError(error)}
      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-red-700">
        {validationMessage}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
        <p
          role={draft.status === "conflict" || draft.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`text-sm font-medium ${draft.status === "conflict" || draft.status === "error" ? "text-red-700" : "text-slate-700"}`}
        >
          {draft.message}
        </p>
        <button
          type="button"
          onClick={() => void draft.saveNow()}
          disabled={draft.status === "saving" || draft.status === "conflict"}
          aria-busy={draft.status === "saving"}
          className="min-h-10 rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {draft.status === "saving" ? "儲存中…" : "立即儲存草稿"}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((step, index) => (
          <button
            key={step.key}
            type="button"
            onClick={() => moveToStep(index)}
            aria-controls={`live-step-panel-${index}`}
            aria-current={activeStep === index ? "step" : undefined}
            className={`flex h-14 items-center justify-center gap-2 rounded-md border text-sm font-semibold transition ${
              activeStep === index
                ? "border-primary bg-blue-50 text-primary"
                : "border-border bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <step.icon size={17} aria-hidden="true" />
            {step.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="grid min-w-0 gap-5">
          {activeStep !== steps.length - 1 ? (
            <MobileLivePreviewToggle preview={preview} />
          ) : null}

      <StepPanel active={activeStep === 0} index={0}>
        {!liveId ? <LiveStudioPurposeStarter selectedPreset={studioPreset} onSelect={selectStudioPreset} /> : null}
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          直播標題
          <input name="title" required autoComplete="off" defaultValue={initialValues.title} onChange={(event) => setPreviewTitle(event.target.value)} className="h-10 rounded-md border border-border px-3" placeholder="例如：週五新品導購直播" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          Slug
          <input name="slug" required autoComplete="off" spellCheck={false} defaultValue={initialValues.slug} className="h-10 rounded-md border border-border px-3" placeholder="friday-new-arrivals" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          開播時間
          <input name="scheduledAt" type="datetime-local" required autoComplete="off" defaultValue={initialValues.scheduledAt} className="h-10 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          直播說明
          <textarea name="description" rows={4} autoComplete="off" defaultValue={initialValues.description} className="rounded-md border border-border px-3 py-2" />
        </label>
      </StepPanel>

      <StepPanel active={activeStep === 1} index={1}>
        <div>
          <h2 className="text-base font-semibold text-slate-950">商品與轉換</h2>
          <p className="mt-1 text-sm text-slate-500">先選這場直播要賣什麼，再決定報名頁與開播通知。</p>
        </div>
        <ProductSelection
          products={products}
          selectedProductIds={selectedProductIds}
          onSelectionChange={(productId, checked) => setSelectedProductIds(
            (currentIds) => updateSelectedProductIds(currentIds, productId, checked),
          )}
        />
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          促銷短句
          <input name="accentCopy" autoComplete="off" defaultValue={initialValues.accentCopy} onChange={(event) => setPreviewAccentCopy(event.target.value)} className="h-10 rounded-md border border-border px-3" placeholder="直播限定優惠" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            報名頁
            <select name="formId" defaultValue={initialValues.formId} onChange={(event) => setSelectedFormId(event.target.value)} className="h-10 rounded-md border border-border px-3">
              <option value="">不綁定表單</option>
              {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            報名成功 Email
            <select name="messageTemplateId" defaultValue={initialValues.messageTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} className="h-10 rounded-md border border-border px-3">
              <option value="">不綁定模板</option>
              {registrationTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.channel}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            開播提醒 Email
            <select name="liveReminderTemplateId" defaultValue={initialValues.liveReminderTemplateId} onChange={(event) => setSelectedReminderTemplateId(event.target.value)} className="h-10 rounded-md border border-border px-3">
              <option value="">不寄送開播提醒</option>
              {reminderTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.channel}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            提前多久寄送
            <select name="liveReminderOffsetMinutes" defaultValue={initialValues.liveReminderOffsetMinutes} className="h-10 rounded-md border border-border px-3">
              <option value="15">15 分鐘</option>
              <option value="30">30 分鐘</option>
              <option value="60">1 小時</option>
              <option value="180">3 小時</option>
              <option value="1440">1 天</option>
            </select>
          </label>
        </div>
        <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          只有完成 Email 驗證的報名者會進入開播提醒排程；直播時間已過時不會建立提醒。
        </p>
      </StepPanel>

      <StepPanel active={activeStep === 2} index={2}>
        <div>
          <h2 className="text-base font-semibold text-slate-950">媒體</h2>
          <p className="mt-1 text-sm text-slate-500">選擇既有 Stream 影片或 Live Input，並直接上傳直播封面。</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            串流模式
            <select name="streamMode" defaultValue={initialValues.streamMode} className="h-10 rounded-md border border-border px-3">
              <option value="vod">Cloudflare Stream VOD</option>
              <option value="live">Cloudflare Stream Live</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            影片 / Live Input
            <select name="videoId" defaultValue={initialValues.videoId} onChange={(event) => setSelectedVideoId(event.target.value)} className="h-10 rounded-md border border-border px-3">
              <option value="">不綁定影片</option>
              {videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
            </select>
          </label>
        </div>
        <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-slate-600">
          Cloudflare Live Input UID 會由受保護的串流建立流程自動綁定，不接受表單手動輸入。
        </p>
        <MediaUploadField
          kind="image"
          label="直播封面"
          description="直接上傳直播主視覺；完成後可在最後一步預覽，URL 僅保留為進階相容選項。"
          defaultUrl={initialValues.heroImageUrl}
          defaultAssetId={initialValues.heroImageAssetId}
          urlInputName="heroImageUrl"
          assetIdInputName="heroImageAssetId"
          onValueChange={() => draft.scheduleSave()}
        />
      </StepPanel>

      <StepPanel active={activeStep === 3} index={3}>
        <div>
          <h2 className="text-base font-semibold text-slate-950">直播與互動</h2>
          <p className="mt-1 text-sm text-slate-500">選擇已發布的互動腳本，再設定聯盟來源、觀看上限與 Stream 用量歸屬。</p>
        </div>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          互動腳本
          <select name="interactionScriptId" defaultValue={initialValues.interactionScriptId} onChange={(event) => setSelectedScriptId(event.target.value)} className="h-10 rounded-md border border-border px-3">
            <option value="">不綁定腳本</option>
            {scripts.map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}
          </select>
        </label>
        <LiveRulesFields affiliates={affiliates} initialValues={initialValues} streamMembers={streamMembers} streamPages={streamPages} />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input name="replayEnabled" type="checkbox" defaultChecked={initialValues.replayEnabled} onChange={(event) => setReplayEnabled(event.target.checked)} className="h-4 w-4 accent-blue-600" />
          直播結束後允許回放
        </label>
      </StepPanel>

      <StepPanel active={activeStep === 4} index={4}>
        <LiveReviewPanel preview={preview} readiness={publishReadiness} onFix={moveToStep} />
      </StepPanel>

      <div className="flex justify-between">
        <button type="button" onClick={() => moveToStep(Math.max(0, activeStep - 1))} disabled={activeStep === 0} className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
          上一步
        </button>
        {activeStep < steps.length - 1 ? (
          <button type="button" onClick={() => moveToStep(Math.min(steps.length - 1, activeStep + 1))} className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
            下一步
          </button>
        ) : (
          <LiveSubmitActions
            canSubmit={draft.canSubmit}
            currentStatus={currentStatus}
            liveId={liveId}
            publishReady={publishReadiness.ready}
            replayEnabled={replayEnabled}
            statusAction={statusAction}
          />
        )}
      </div>
        </div>

        <aside aria-labelledby="live-studio-preview-title" className="sticky top-4 hidden lg:block">
          <div className="mb-3">
            <h2 id="live-studio-preview-title" className="font-semibold text-slate-950">即時手機預覽</h2>
            <p className="mt-1 text-xs text-slate-700">修改標題、促銷短句或商品時會同步更新。</p>
          </div>
          <LivePhonePreview preview={preview} />
        </aside>
      </div>
    </form>
  );
}
