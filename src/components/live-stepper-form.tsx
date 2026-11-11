"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Affiliate, InteractionScript, MessageTemplate, Product, RegistrationForm, Video } from "@prisma/client";
import {
  Ban,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FileVideo,
  Gauge,
  Mail,
  Send,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { upsertLiveAction } from "@/app/actions";
import { formatTimeZoneLabel } from "@/lib/format";
import { LiveSlugField } from "@/components/live-slug-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { LIVE_DRAFT_SAVE_FAILED_EVENT, LiveConfirmedSubmitButton, LiveFormPendingLock } from "@/components/live-submit-confirmation";
import { MediaUploadField } from "@/components/media-upload-field";
import { MessageTemplateQuickCreateDrawer, RegistrationFormQuickCreateDrawer, VideoQuickCreateDrawer } from "@/components/live-resource-drawers";
import { LivePendingVideos, type LivePendingVideo, type LivePendingVideoProblem } from "@/components/live-pending-videos";
import {
  liveQuickTemplateCopy,
  mergeLiveResourceOptions,
  type LiveQuickFormOption,
  type LiveQuickTemplateOption,
  type LiveQuickTemplateTrigger,
  type LiveQuickVideoOption,
} from "@/lib/live-resource-quick-create";
import {
  LiveFixedSessionSettingsFields,
  LiveFixedSessionsEditor,
  type StoredFixedSessionSummary,
} from "@/components/live-fixed-sessions-editor";
import type { FixedSessionDraftRow } from "@/lib/live-fixed-sessions";
import { formatZonedDateTimeLocal } from "@/lib/zoned-date-time";
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
  LIVE_STUDIO_FLOW_VERSION,
  type LiveStudioDraftEnvelope,
  type LiveStudioDraftPayload,
} from "@/lib/live-studio-draft";
import {
  isLiveStudioStepKey,
  LIVE_STUDIO_STEPS,
  liveStudioStepAt,
  liveStudioStepIndex,
  type LiveStudioStepKey,
} from "@/lib/live-studio-steps";
import {
  createSuggestedLiveNotificationRules,
  expectedTemplateTrigger,
  LIVE_NOTIFICATION_RULE_LIMITS,
  LIVE_NOTIFICATION_RULE_TRIGGERS,
  type LiveNotificationRuleDraft,
  type LiveNotificationRuleTrigger,
} from "@/lib/live-notification-rules";

const stepIcons: Record<LiveStudioStepKey, LucideIcon> = {
  content: FileVideo,
  sales: ShoppingBag,
  notifications: Mail,
  publish: Send,
};
const steps = LIVE_STUDIO_STEPS.map((step) => ({ ...step, icon: stepIcons[step.key] }));

/**
 * A step's badge: every required item is done, a required item is still
 * missing, or nothing required is missing but optional items (products, an
 * interaction script, extra notifications) are not set. Each state has its own
 * text and icon, so it never relies on colour alone.
 */
type LiveStudioStepStatus = "complete" | "required" | "optional";
const stepStatusCopy: Record<LiveStudioStepStatus, { label: string; shortLabel: string; icon: LucideIcon; className: string }> = {
  complete: { label: "已完成", shortLabel: "完成", icon: CircleCheck, className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  required: { label: "尚有必填", shortLabel: "待補", icon: CircleAlert, className: "border-amber-300 bg-amber-50 text-amber-900" },
  optional: { label: "選配未設定", shortLabel: "選配", icon: CircleDashed, className: "border-slate-300 bg-white text-slate-600" },
};
const requiredFieldsMessage = "請先完成本步驟的必填欄位，再繼續下一步。";
const inlineCreateButtonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-primary hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

/** Secondary way out of the drawer: the full editor in a new tab, so the studio keeps its state. */
function FullEditorLink({ href }: { href: string }) {
  return (
    <Link href={href} target="_blank" rel="noopener" className="text-sm font-semibold text-primary underline">
      用完整編輯器建立<span className="sr-only">（另開新分頁）</span>
    </Link>
  );
}

/** Which 「就地建立」 drawer is open; a template drawer remembers the rule group it was opened from. */
type LiveResourceDrawer =
  | { kind: "video" }
  | { kind: "form" }
  | { kind: "template"; trigger: LiveQuickTemplateTrigger; ruleTrigger?: LiveNotificationRuleTrigger };

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
  { value: "CUSTOM", label: "從空白開始", description: "保留完整設定，自行決定商品、通知、互動與用量規則。" },
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

/**
 * The studio's only step navigation: one responsive row of buttons (full
 * labels and descriptions on wide screens, number, short label and short
 * status on phones) plus 上一步／下一步 below the panels.
 */
export function LiveStudioStepNav({
  activeStep,
  statuses,
  onSelect,
}: {
  activeStep: LiveStudioStepKey;
  statuses: Readonly<Record<LiveStudioStepKey, LiveStudioStepStatus>>;
  onSelect: (step: LiveStudioStepKey) => void;
}) {
  const position = liveStudioStepIndex(activeStep);
  return (
    <nav aria-label="直播設定步驟" className="grid gap-2">
      <p className="text-sm font-semibold text-slate-900 md:hidden">
        第 {position + 1} 步／共 {steps.length} 步：{steps[position]?.label}
      </p>
      <ol className="grid grid-cols-4 gap-2">
        {steps.map((step, index) => {
          const current = step.key === activeStep;
          const status = stepStatusCopy[statuses[step.key]];
          return (
            <li key={step.key} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(step.key)}
                aria-controls={`live-step-panel-${step.key}`}
                aria-current={current ? "step" : undefined}
                className={`flex h-full min-h-14 w-full flex-col items-center justify-center gap-1.5 rounded-md border px-1 py-2 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 md:items-start md:justify-start md:px-3 md:py-3 md:text-left ${
                  current
                    ? "border-primary bg-blue-50 text-primary"
                    : "border-border bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className={`hidden h-7 w-7 shrink-0 place-items-center rounded-full md:grid ${current ? "bg-white text-primary" : "bg-slate-100 text-slate-600"}`}>
                    <step.icon size={15} />
                  </span>
                  <span className="block">{index + 1}. {step.label}</span>
                </span>
                <span className="hidden text-xs font-normal text-slate-600 xl:block">{step.description}</span>
                <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium ${status.className}`}>
                  <status.icon size={12} aria-hidden="true" className="shrink-0" />
                  <span aria-hidden="true" className="md:hidden">{status.shortLabel}</span>
                  <span className="sr-only md:not-sr-only">{status.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Optional fields of a step, collapsed by default. A native <details> keeps
 * them in the form (they are always submitted) and is keyboard and screen
 * reader operable; `revealCollapsedAncestors` opens it for validation errors.
 */
function AdvancedSettings({
  step,
  summary,
  children,
}: {
  step: LiveStudioStepKey;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details data-advanced-settings={step} className="group rounded-lg border border-border bg-slate-50">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-2 text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block">進階設定</span>
          <span className="block break-all text-xs font-normal text-slate-600">{summary}</span>
        </span>
        <ChevronDown size={18} aria-hidden="true" className="shrink-0 group-open:rotate-180 motion-safe:transition-transform" />
      </summary>
      <div className="grid gap-4 rounded-b-lg border-t border-border bg-white p-4">{children}</div>
    </details>
  );
}

/** Opens every collapsed 「進階設定」 (or other <details>) that contains `control`. */
function revealCollapsedAncestors(control: { parentElement?: Element | null }) {
  let details = control.parentElement?.closest("details") ?? null;
  while (details) {
    details.open = true;
    details = details.parentElement?.closest("details") ?? null;
  }
}

function StepPanel({
  active,
  step,
  children,
}: {
  active: boolean;
  step: LiveStudioStepKey;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`live-step-panel-${step}`}
      data-step-key={step}
      hidden={!active}
      className="grid gap-4 rounded-lg border border-border bg-white p-5"
    >
      {children}
    </div>
  );
}

function ScheduleDateTimeField({ timeZone, defaultValue, onChange }: { timeZone: string; defaultValue: string; onChange?: (value: string) => void }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      開播時間（{formatTimeZoneLabel(timeZone)}）
      <input name="scheduledAt" type="datetime-local" required autoComplete="off" defaultValue={defaultValue} onChange={(event) => onChange?.(event.target.value)} className="h-11 rounded-md border border-border px-3" />
      <span className="text-xs font-normal text-slate-500">請依商家時區輸入，提醒與公開頁會使用同一時間。</span>
    </label>
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
      <div data-readiness-focus="products" tabIndex={-1} className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <p>目前沒有可綁定的啟用商品。你仍可先建立草稿，或先建立商品。</p>
        <Link href="/products/new" className="mt-2 inline-flex font-semibold text-primary underline">新增商品</Link>
      </div>
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
    interactionScriptReady: resources.scripts.some((script) => script.id === resources.scriptId),
  });
}

/** A fixed-session Live plays each session by itself: no manual "開始直播". */
function fixedSessionStatusAction(action: ReturnType<typeof liveStatusAction>, sessionMode: string) {
  return sessionMode === "fixed_sessions" && action?.value === "live" ? null : action;
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

const readinessCopy: Record<LivePublishRequirementCodeWithReminder, { label: string; step: LiveStudioStepKey; action: string }> = {
  media: { label: "可播放的影片或即時直播", step: "content", action: "前往媒體" },
  products: { label: "啟用且已確認履約類型的商品", step: "sales", action: "前往商品優惠" },
  registration_form: { label: "有效的報名表單", step: "content", action: "前往報名頁" },
  registration_email: { label: "可寄送的報名成功 Email", step: "notifications", action: "前往 Email" },
  live_reminder_email: { label: "可寄送的開播提醒 Email", step: "notifications", action: "前往 Email" },
  interaction_script: { label: "已發布的互動腳本（虛擬使用者發言）", step: "sales", action: "前往互動設定" },
};

const readinessFocusSelector: Record<LivePublishRequirementCodeWithReminder, string> = {
  media: '[name="videoId"]',
  products: '[data-readiness-focus="products"]',
  registration_form: '[name="formId"]',
  registration_email: '[name="messageTemplateId"]',
  live_reminder_email: '[name="liveReminderTemplateId"]',
  interaction_script: '[name="interactionScriptId"]',
};

function ReadinessRecommendations({
  recommendations,
  onFix,
}: {
  recommendations: ReturnType<typeof getLivePublishReadiness>["recommendations"];
  onFix: (code: LivePublishRequirementCodeWithReminder) => void;
}) {
  const pending = recommendations.filter((item) => !item.ready);
  if (pending.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-sm">
      <p className="font-semibold text-slate-700">建議（選配，不影響發布）</p>
      <ul className="mt-2 grid gap-2">
        {pending.map((item) => (
          <li key={item.code} className="flex flex-wrap items-center justify-between gap-2 text-slate-700">
            <span>尚未設定 · {readinessCopy[item.code].label}</span>
            <button type="button" onClick={() => onFix(item.code)} className="min-h-9 rounded-md border border-slate-300 bg-white px-3 font-semibold text-slate-700">
              {readinessCopy[item.code].action}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveReviewPanel({
  preview,
  readiness,
  onFix,
}: {
  preview: ReturnType<typeof buildLivePreview>;
  readiness: ReturnType<typeof getLivePublishReadiness>;
  onFix: (code: LivePublishRequirementCodeWithReminder) => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-5">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <Gauge size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-950">確認直播間設定</h2>
            <p className="mt-1 text-sm text-slate-600">確認發布條件，再用直播頁預覽切換桌機與手機，檢查觀眾看到的畫面。</p>
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
              ? "已選擇商品。公開前需要播放、商品、報名與報名成功 Email；互動腳本是選配，建議準備但不會擋住發布。"
              : "目前沒有選擇商品，會以內容直播發布；公開前仍需播放、報名與報名成功 Email。"}
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
                    <button type="button" onClick={() => onFix(requirement.code)} className="min-h-9 rounded-md border border-amber-300 bg-white px-3 font-semibold text-amber-900">
                      {copy.action}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <ReadinessRecommendations recommendations={readiness.recommendations} onFix={onFix} />
        </section>

      </div>

      <LivePreviewSwitcher preview={preview} />
    </div>
  );
}

function LiveDesktopPreview({ preview }: { preview: ReturnType<typeof buildLivePreview> }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
      <div className="aspect-video rounded-xl bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-lg font-black">{preview.title}</p>
          <span className="rounded-full bg-red-700 px-3 py-1 text-xs font-black">LIVE</span>
        </div>
        <div className="mt-12 rounded-xl bg-white p-4 text-slate-950 shadow-2xl">
          <p className="text-sm font-black text-orange-800">{preview.accentCopy}</p>
          <p className="mt-2 font-bold">
            {preview.productNames.length > 0 ? preview.productNames.join("、") : preview.emptyProductLabel}
          </p>
          {preview.remainingProductCount > 0 ? <p className="mt-1 text-xs text-slate-500">及其他 {preview.remainingProductCount} 件商品</p> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The publish step's single preview: one device at a time, switched with
 * two toggle buttons (aria-pressed), instead of separate desktop, phone and
 * side previews.
 */
function LivePreviewSwitcher({ preview }: { preview: ReturnType<typeof buildLivePreview> }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("mobile");
  return (
    <section aria-labelledby="live-publish-preview-title" className="grid content-start gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="live-publish-preview-title" className="text-sm font-semibold text-slate-900">直播頁預覽</h3>
        <div role="group" aria-label="預覽裝置" className="inline-flex rounded-md border border-border bg-white p-0.5">
          {([["desktop", "桌機預覽"], ["mobile", "手機預覽"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={device === value}
              onClick={() => setDevice(value)}
              className={`min-h-10 rounded px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${device === value ? "bg-primary text-white" : "text-slate-700 hover:bg-slate-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {device === "desktop" ? (
        <LiveDesktopPreview preview={preview} />
      ) : (
        <div className="mx-auto w-full max-w-[320px]">
          <LivePhonePreview preview={preview} />
        </div>
      )}
    </section>
  );
}

function LivePhonePreview({ preview }: { preview: ReturnType<typeof buildLivePreview> }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-950 p-3">
      <div className="overflow-hidden rounded-xl bg-slate-900 text-white">
        <div className="relative aspect-[9/16] bg-slate-900">
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

/**
 * While editing (every step but 發布) one live phone preview follows the form:
 * beside it on wide screens, collapsed above it on narrow ones. The 發布 step
 * shows its own switchable preview instead, so these render nothing there.
 */
function LiveSidePreview({ preview, hidden }: { preview: ReturnType<typeof buildLivePreview>; hidden: boolean }) {
  if (hidden) return null;
  return (
    <aside aria-labelledby="live-studio-preview-title" className="sticky top-4 hidden lg:block">
      <div className="mb-3">
        <h2 id="live-studio-preview-title" className="font-semibold text-slate-950">即時手機預覽</h2>
        <p className="mt-1 text-xs text-slate-700">修改標題、促銷短句或商品時會同步更新。</p>
      </div>
      <LivePhonePreview preview={preview} />
    </aside>
  );
}

function liveStudioWorkspaceClass(onPublishStep: boolean) {
  return onPublishStep ? "grid gap-5" : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start";
}

function MobileLivePreviewToggle({ preview, hidden }: { preview: ReturnType<typeof buildLivePreview>; hidden: boolean }) {
  if (hidden) return null;
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
  setActiveStep: (step: LiveStudioStepKey) => void,
  setValidationMessage: (message: string) => void,
) {
  event.preventDefault();
  const control = event.target;
  if (!(control instanceof HTMLElement)) return;
  if (invalidFocusPendingRef.current) return;
  invalidFocusPendingRef.current = true;
  const invalidStep = control.closest<HTMLElement>("[data-step-key]")?.dataset.stepKey;
  if (isLiveStudioStepKey(invalidStep)) setActiveStep(invalidStep);
  revealCollapsedAncestors(control);
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
  flush: Pick<ReturnType<typeof useSubmitFlushGuard>, "isInFlight" | "begin" | "end">,
) {
  // A second submit while the first one is still saving the draft (double
  // click on the confirmation) must not start another save or Server Action.
  if (flush.isInFlight()) {
    event.preventDefault();
    return;
  }
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
  flush.begin();
  void draft.saveNow(activeStep).then((claim) => {
    // Release before re-submitting: the follow-up submit below is the one
    // this flush was for and must pass the guard.
    flush.end();
    if (!claim || !writeClaim(claim) || !form) {
      // The save hit a conflict or an error: close the confirmation so the
      // draft status and its recovery buttons are reachable.
      form?.dispatchEvent(new CustomEvent(LIVE_DRAFT_SAVE_FAILED_EVENT));
      return;
    }
    if (!(submitter instanceof HTMLButtonElement)) {
      form.requestSubmit();
      return;
    }
    // The confirmation dialog may have been cancelled while the draft was
    // saving; a detached submitter means the user no longer wants to submit.
    if (!submitter.isConnected || submitter.form !== form) return;
    form.requestSubmit(submitter);
  }, () => flush.end());
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
          <select name="affiliateMode" defaultValue={initialValues.affiliateMode} className="h-11 rounded-md border border-border px-3">
            <option value="enabled">啟用推薦連結來源追蹤</option>
            <option value="disabled">停用</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          預設推廣碼
          <select name="defaultAffiliateCode" defaultValue={initialValues.defaultAffiliateCode} className="h-11 rounded-md border border-border px-3">
            <option value="">不指定</option>
            {affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.code}>{affiliate.name} · {affiliate.code}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          觀看人數上限
          <input name="maxConcurrentViewers" type="number" inputMode="numeric" min={1} defaultValue={initialValues.maxConcurrentViewers} className="h-11 rounded-md border border-border px-3" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          點數低於多少時停止推播
          <input name="stopWhenCreditsBelow" type="number" inputMode="numeric" min={0} defaultValue={initialValues.stopWhenCreditsBelow} className="h-11 rounded-md border border-border px-3" />
        </label>
      </div>
      <StreamAllocationEditor initialValues={initialValues} members={streamMembers} pages={streamPages} />
      <p className="flex items-start gap-2 rounded-md bg-orange-50 p-3 text-sm text-orange-700">
        <Ban size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        成員／推廣頁的額度用完時會暫停播放，不會自動扣款。
      </p>
    </>
  );
}

function liveFormError(error?: string, invalidFieldLabel?: string) {
  const messages: Record<string, string> = {
    invalid_reference: "直播關聯資料無效，請重新選擇目前商店的影片、表單、模板、腳本與商品。",
    invalid_policy: "用量或聯盟來源規則無效，請確認模式、推廣碼與數值範圍。",
    payment_method_required: "啟用成員／推廣頁的影片額度前，必須先由付款服務驗證付款方式；目前不會自動扣款。",
    draft_conflict: "這份直播草稿已有較新的版本；系統沒有覆蓋它。請確認目前載入內容後再繼續。",
    fixed_sessions_manual_start: "指定場次的直播會在每個場次時間自動播放，不需要手動開始直播；請保留「已排程」狀態。",
    invalid_status: "直播狀態轉換無效，內容尚未發布。",
    invalid_draft: "直播草稿內容不完整或格式無效；系統沒有發布任何變更。請修正欄位並重新儲存草稿。",
    slug_taken: "這個直播網址已被使用，內容沒有發布；草稿已保留。請在「直播網址」欄位換一個再儲存。",
    publish_not_ready: "公開條件尚未完成，系統保留目前草稿且沒有變更公開狀態。請依「發布」步驟的檢查清單補齊後再發布；銷售直播至少需要一項商品，也可以改成內容直播。",
  };
  const message = error ? messages[error] : undefined;
  return message ? (
    <p id="live-form-error" role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
      {error === "invalid_draft" && invalidFieldLabel ? `請先修正「${invalidFieldLabel}」欄位。` : null}
    </p>
  ) : null;
}

function LiveSubmitActions({
  canSubmit,
  savingBeforeSubmit = false,
  currentStatus,
  liveId,
  publishReady,
  replayEnabled,
  statusAction,
}: {
  canSubmit: boolean;
  savingBeforeSubmit?: boolean;
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
        <LiveConfirmedSubmitButton key="create-scheduled" savingBeforeSubmit={savingBeforeSubmit} name="status" value="scheduled" disabled={!canSubmit || (requiresLivePublishReadiness("scheduled", replayEnabled) && !publishReady)} confirmMessage="確定要建立並排程這場直播嗎？" confirmLabel="確認建立並排程" pendingChildren="排程中…" pendingMessage="正在建立並排程直播間，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md bg-cta px-4 text-sm font-semibold text-white transition hover:bg-cta-dark">
          建立並排程
        </LiveConfirmedSubmitButton>
      ) : statusAction ? (
        <LiveConfirmedSubmitButton key={`${currentStatus}-to-${statusAction.value}`} savingBeforeSubmit={savingBeforeSubmit} name="status" value={statusAction.value} disabled={actionDisabled} confirmMessage={statusAction.confirm} confirmLabel={`確認${statusAction.label}`} pendingChildren="處理中…" pendingMessage="正在更新直播公開狀態，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md bg-cta px-4 text-sm font-semibold text-white transition hover:bg-cta-dark">
          {statusAction.label}
        </LiveConfirmedSubmitButton>
      ) : null}
      {canUnpublish ? (
        <LiveConfirmedSubmitButton key={`${currentStatus}-to-draft`} savingBeforeSubmit={savingBeforeSubmit} name="status" value="draft" disabled={!canSubmit} confirmMessage="確定要將這場直播下架並回到草稿嗎？公開連結會立即停止顯示。" confirmLabel="確認下架為草稿" pendingChildren="下架中…" pendingMessage="正在將直播下架為草稿，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
          下架為草稿
        </LiveConfirmedSubmitButton>
      ) : null}
    </div>
  );
}

type LiveStudioContentStepOptions = {
  activeStep: LiveStudioStepKey;
  initialValues: LiveStudioDraftPayload;
  studioPreset: LiveStudioPreset;
  purposeStarter: React.ReactNode;
  title: string;
  slug: string;
  onTitleChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onSlugAutoFill: () => void;
  slugTakenOnSubmit: boolean;
  slugTakenInDraft: boolean;
  slugCheckFailed: boolean;
  videos: Array<Pick<Video, "id" | "title">>;
  selectedVideoId: string;
  onVideoChange: (value: string) => void;
  onCreateVideo: () => void;
  pendingVideos: LivePendingVideo[];
  onPendingVideoReady: (video: LivePendingVideo) => void;
  onPendingVideoProblem: (video: LivePendingVideo, problem: LivePendingVideoProblem) => void;
  forms: LiveFormOption[];
  selectedFormId: string;
  onFormChange: (value: string) => void;
  onCreateForm: () => void;
  timeZone: string;
  replayEnabled: boolean;
  replayAvailableUntil: string;
  onScheduledAtChange: (value: string) => void;
  onReplayEnabledChange: (enabled: boolean) => void;
  onReplayAvailableUntilChange: (value: string) => void;
  onMediaValueChange: () => void;
  fixedSessions: {
    mode: "single" | "fixed_sessions";
    latestStartAt: string;
    nowLocal: string;
    storedSessions: StoredFixedSessionSummary[];
    streamMode: string;
    onModeChange: (mode: "single" | "fixed_sessions") => void;
    onRowsChange: (rows: FixedSessionDraftRow[]) => void;
  };
};

type LiveStudioSalesStepOptions = {
  activeStep: LiveStudioStepKey;
  initialValues: LiveStudioDraftPayload;
  products: LiveProductOption[];
  selectedProductIds: string[];
  onProductSelectionChange: (productId: string, checked: boolean) => void;
  onAccentCopyChange: (value: string) => void;
  scripts: LiveScriptOption[];
  selectedScriptId: string;
  onScriptChange: (value: string) => void;
  affiliates: LiveAffiliateOption[];
  streamMembers: StreamAllocationMemberOption[];
  streamPages: StreamAllocationPageOption[];
};

type LiveStudioNotificationsStepOptions = {
  activeStep: LiveStudioStepKey;
  initialValues: LiveStudioDraftPayload;
  registrationTemplates: LiveTemplateOption[];
  selectedTemplateId: string;
  onTemplateChange: (value: string) => void;
  notificationTemplates: LiveTemplateOption[];
  notificationRules: LiveNotificationRuleDraft[];
  onNotificationRulesChange: (rules: LiveNotificationRuleDraft[]) => void;
  onCreateTemplate: (trigger: LiveQuickTemplateTrigger, ruleTrigger?: LiveNotificationRuleTrigger) => void;
};

function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
    </div>
  );
}

/** Label of the 「建立…」 button of a rule group without a template; 「直播中」 reads as its own notice. */
function createTemplateButtonLabel(trigger: LiveNotificationRuleTrigger) {
  if (trigger === "post_live_followup") return "建立課後 Email";
  if (trigger === "during_live") return `建立${liveQuickTemplateCopy("live_reminder", "during_live").label}`;
  return "建立開播提醒 Email";
}

const notificationRuleGroupCopy: Record<LiveNotificationRuleTrigger, { title: string; timing: string }> = {
  before_live: { title: "開播前", timing: "開播前幾分鐘寄送" },
  during_live: { title: "直播中", timing: "開播後幾分鐘寄送" },
  post_live_followup: { title: "課後", timing: "內容結束後幾分鐘寄送" },
};

let draftNotificationRuleSequence = 0;

function withDraftRuleIds(rules: LiveNotificationRuleDraft[]) {
  return rules.map((rule) => ({
    ...rule,
    id: rule.id || `draft-notification-rule-${++draftNotificationRuleSequence}`,
  }));
}

function NotificationRulesEditor({
  rules,
  templates,
  onChange,
  onCreateTemplate,
}: {
  rules: LiveNotificationRuleDraft[];
  templates: LiveTemplateOption[];
  onChange: (rules: LiveNotificationRuleDraft[]) => void;
  /** Opens the template drawer for a group that has no usable template yet. */
  onCreateTemplate?: (trigger: LiveQuickTemplateTrigger, ruleTrigger: LiveNotificationRuleTrigger) => void;
}) {
  const hasSuggestionTemplates = templates.some((template) => (
    template.trigger === "live_reminder" || template.trigger === "post_live_followup"
  ));
  function replaceRule(id: string, patch: Partial<LiveNotificationRuleDraft>) {
    onChange(rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule));
  }

  function addRule(trigger: LiveNotificationRuleTrigger) {
    const group = rules.filter((rule) => rule.trigger === trigger);
    if (group.length >= LIVE_NOTIFICATION_RULE_LIMITS[trigger]) return;
    const template = templates.find((candidate) => candidate.trigger === expectedTemplateTrigger(trigger));
    const usedOffsets = new Set(group.map((rule) => rule.offsetMinutes));
    const candidates = trigger === "before_live" ? [60, 10, 30, 1, 1440] : [0, 10, 30, 60, 15, 1440, 4320];
    const offsetMinutes = candidates.find((candidate) => !usedOffsets.has(candidate)) ?? (trigger === "before_live" ? 1 : 0);
    onChange([...rules, ...withDraftRuleIds([{
      id: "",
      trigger,
      messageTemplateId: template?.id ?? "",
      offsetMinutes,
      sortOrder: group.length,
      isActive: true,
    }])]);
  }

  function moveRule(trigger: LiveNotificationRuleTrigger, id: string, direction: -1 | 1) {
    const indexes = rules.flatMap((rule, index) => rule.trigger === trigger ? [index] : []);
    const position = indexes.findIndex((index) => rules[index]?.id === id);
    const targetPosition = position + direction;
    if (position < 0 || targetPosition < 0 || targetPosition >= indexes.length) return;
    const next = [...rules];
    const currentIndex = indexes[position]!;
    const targetIndex = indexes[targetPosition]!;
    [next[currentIndex], next[targetIndex]] = [next[targetIndex]!, next[currentIndex]!];
    onChange(next);
  }

  function applySuggestions() {
    const liveReminder = templates.find((template) => template.trigger === "live_reminder")?.id ?? "";
    const postLiveFollowup = templates.find((template) => template.trigger === "post_live_followup")?.id ?? "";
    onChange(withDraftRuleIds(createSuggestedLiveNotificationRules({ liveReminder, postLiveFollowup })));
  }

  return (
    <section aria-labelledby="notification-rules-title" className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="notification-rules-title" className="font-semibold text-slate-950">選配通知規則</h3>
          <p className="mt-1 text-sm text-slate-600">開播前與直播中通知已接通排程；課後通知維持既有排程。</p>
        </div>
        <button type="button" onClick={applySuggestions} disabled={!hasSuggestionTemplates} className="min-h-11 rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50">
          套用建議設定
        </button>
      </div>
      {!hasSuggestionTemplates ? <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">目前沒有可用的開播提醒或課後 Email 模板，請先建立模板再套用建議設定。</p> : null}
      {LIVE_NOTIFICATION_RULE_TRIGGERS.map((trigger) => {
        const group = rules.filter((rule) => rule.trigger === trigger);
        const availableTemplates = templates.filter((template) => template.trigger === expectedTemplateTrigger(trigger));
        const missingTemplateReason = trigger === "post_live_followup"
          ? "需要啟用中的課後 Email 模板（post_live_followup）才能新增。"
          : "需要啟用中的 Email 開播提醒模板（live_reminder）才能新增。";
        const addButtonDescriptionId = `notification-rule-${trigger}-add-description`;
        return (
          <fieldset key={trigger} className="grid gap-3 rounded-lg border border-border p-4">
            <legend className="px-1 font-semibold text-slate-900">
              {notificationRuleGroupCopy[trigger].title} {group.length}/{LIVE_NOTIFICATION_RULE_LIMITS[trigger]}
            </legend>
            {group.length === 0 ? <p className="text-sm text-slate-500">尚未設定通知。</p> : null}
            {group.map((rule, index) => (
              <div key={rule.id} className="grid gap-3 rounded-md bg-slate-50 p-3 lg:grid-cols-[auto_minmax(0,1fr)_150px_auto] lg:items-end">
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={rule.isActive}
                    aria-label={`${notificationRuleGroupCopy[trigger].title}第 ${index + 1} 則通知啟用`}
                    onChange={(event) => replaceRule(rule.id, { isActive: event.target.checked })}
                    className="h-4 w-4 accent-blue-600"
                  />
                  啟用
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  Email 模板
                  <select
                    value={rule.messageTemplateId}
                    aria-label={`${notificationRuleGroupCopy[trigger].title}第 ${index + 1} 則 Email 模板`}
                    onChange={(event) => replaceRule(rule.id, { messageTemplateId: event.target.value })}
                    className="h-11 min-w-0 rounded-md border border-border px-3"
                  >
                    <option value="">請選擇模板</option>
                    {availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  {notificationRuleGroupCopy[trigger].timing}
                  <input
                    type="number"
                    inputMode="numeric"
                    min={trigger === "before_live" ? 1 : 0}
                    max={10_080}
                    value={rule.offsetMinutes}
                    aria-label={`${notificationRuleGroupCopy[trigger].title}第 ${index + 1} 則寄送分鐘`}
                    onChange={(event) => replaceRule(rule.id, { offsetMinutes: Number(event.target.value) })}
                    className="h-11 rounded-md border border-border px-3"
                  />
                </label>
                <div className="flex flex-wrap gap-2" aria-label={`${notificationRuleGroupCopy[trigger].title}第 ${index + 1} 則排序控制`}>
                  <button type="button" disabled={index === 0} aria-label={`上移${notificationRuleGroupCopy[trigger].title}第 ${index + 1} 則`} onClick={() => moveRule(trigger, rule.id, -1)} className="min-h-11 rounded-md border border-border bg-white px-3 text-sm disabled:opacity-40">上移</button>
                  <button type="button" disabled={index === group.length - 1} aria-label={`下移${notificationRuleGroupCopy[trigger].title}第 ${index + 1} 則`} onClick={() => moveRule(trigger, rule.id, 1)} className="min-h-11 rounded-md border border-border bg-white px-3 text-sm disabled:opacity-40">下移</button>
                  <button type="button" aria-label={`刪除${notificationRuleGroupCopy[trigger].title}第 ${index + 1} 則`} onClick={() => onChange(rules.filter((candidate) => candidate.id !== rule.id))} className="min-h-11 rounded-md border border-red-200 bg-white px-3 text-sm text-red-700">刪除</button>
                </div>
              </div>
            ))}
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <button type="button" data-notification-add={trigger} aria-describedby={availableTemplates.length === 0 ? addButtonDescriptionId : undefined} disabled={group.length >= LIVE_NOTIFICATION_RULE_LIMITS[trigger] || availableTemplates.length === 0} onClick={() => addRule(trigger)} className="min-h-11 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">
                新增{notificationRuleGroupCopy[trigger].title}通知
              </button>
              {availableTemplates.length === 0 ? <span id={addButtonDescriptionId} className="text-xs text-amber-800">{missingTemplateReason}</span> : null}
              {availableTemplates.length === 0 && onCreateTemplate ? (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => onCreateTemplate(expectedTemplateTrigger(trigger), trigger)}
                  className={inlineCreateButtonClass}
                >
                  {createTemplateButtonLabel(trigger)}
                </button>
              ) : null}
            </div>
          </fieldset>
        );
      })}
    </section>
  );
}

/** 內容: purpose, title, media, registration page and schedule; address, description, replay deadline and cover are advanced. */
function renderLiveStudioContentStep(input: LiveStudioContentStepOptions) {
  const fixedSessions = input.fixedSessions.mode === "fixed_sessions";
  return (
    <StepPanel active={input.activeStep === "content"} step="content">
      <StepHeading title="內容" description="設定直播標題、要播放的影片、報名頁與開播時間；網址、說明、回放期限與封面收在下方「進階設定」。" />
      <input type="hidden" name="studioPreset" value={input.studioPreset} readOnly />
      {input.purposeStarter}
      <label className="grid gap-1.5 text-sm font-medium text-slate-700">
        直播標題
        <input name="title" required autoComplete="off" defaultValue={input.initialValues.title} onChange={(event) => input.onTitleChange(event.target.value)} className="h-11 rounded-md border border-border px-3" placeholder="例如：週五新品導購直播" />
      </label>

      <fieldset className="grid gap-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-semibold text-slate-900">播放內容</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            播放方式
            <select name="streamMode" defaultValue={input.initialValues.streamMode} className="h-11 rounded-md border border-border px-3">
              <option value="vod">預錄影片（到排定時間自動播放）</option>
              <option value="live">即時直播（用直播軟體推流）</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            影片／即時直播
            {/* Controlled, so a video created in the drawer can be selected; the draft still serializes the DOM value. */}
            <select name="videoId" value={input.selectedVideoId} onChange={(event) => input.onVideoChange(event.target.value)} className="h-11 rounded-md border border-border px-3">
              <option value="">不綁定影片</option>
              {input.videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
            </select>
          </label>
        </div>
        {input.videos.length === 0 && input.pendingVideos.length === 0 ? <p className="text-sm text-slate-600">目前沒有可播放的影片，可以在這裡直接上傳。</p> : null}
        <LivePendingVideos videos={input.pendingVideos} onReady={input.onPendingVideoReady} onProblem={input.onPendingVideoProblem} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" aria-haspopup="dialog" onClick={input.onCreateVideo} className={inlineCreateButtonClass}>上傳影片或貼上影片網址</button>
          <FullEditorLink href="/videos/new" />
        </div>
      </fieldset>

      <div className="grid gap-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          報名頁
          {/* Controlled, so an option created in the drawer can be selected; the draft still serializes the DOM value. */}
          <select name="formId" value={input.selectedFormId} onChange={(event) => input.onFormChange(event.target.value)} className="h-11 rounded-md border border-border px-3">
            <option value="">不綁定表單</option>
            {input.forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
          </select>
        </label>
        {input.forms.length === 0 ? <p className="text-sm text-slate-600">目前沒有可用報名頁，可以在這裡直接建立。</p> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" aria-haspopup="dialog" onClick={input.onCreateForm} className={inlineCreateButtonClass}>新增報名表</button>
          <FullEditorLink href="/forms/new" />
        </div>
      </div>

      <LiveFixedSessionsEditor
        timeZoneLabel={formatTimeZoneLabel(input.timeZone)}
        nowLocal={input.fixedSessions.nowLocal}
        initialMode={input.initialValues.sessionMode === "fixed_sessions" ? "fixed_sessions" : "single"}
        initialRows={input.initialValues.fixedSessions ?? []}
        initialCutoffMinutes={input.initialValues.sessionRegistrationCutoffMinutes ?? "0"}
        initialReplayWindowHours={input.initialValues.sessionReplayWindowHours ?? ""}
        storedSessions={input.fixedSessions.storedSessions}
        streamMode={input.fixedSessions.streamMode}
        onModeChange={input.fixedSessions.onModeChange}
        onRowsChange={input.fixedSessions.onRowsChange}
        showSessionSettings={false}
      />
      {fixedSessions ? (
        // The Live's shared start is its latest session; the server derives it again.
        <input type="hidden" name="scheduledAt" value={input.fixedSessions.latestStartAt} readOnly />
      ) : (
        <ScheduleDateTimeField timeZone={input.timeZone} defaultValue={input.initialValues.scheduledAt} onChange={input.onScheduledAtChange} />
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
        <input name="replayEnabled" type="checkbox" checked={input.replayEnabled} onChange={(event) => input.onReplayEnabledChange(event.target.checked)} className="h-4 w-4 accent-blue-600" />
        直播結束後允許回放
      </label>

      <AdvancedSettings step="content" summary={`直播網址 /live/${input.slug || "（依標題自動產生）"}、說明、回放期限與封面`}>
        <LiveSlugField
          title={input.title}
          initialValue={input.initialValues.slug}
          serverTaken={input.slugTakenOnSubmit}
          draftTaken={input.slugTakenInDraft}
          checkFailed={input.slugCheckFailed}
          onChange={input.onSlugChange}
          onAutoFill={input.onSlugAutoFill}
        />
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          直播說明
          <textarea name="description" rows={4} autoComplete="off" defaultValue={input.initialValues.description} className="rounded-md border border-border px-3 py-2" />
        </label>
        {fixedSessions ? (
          <LiveFixedSessionSettingsFields
            initialCutoffMinutes={input.initialValues.sessionRegistrationCutoffMinutes ?? "0"}
            initialReplayWindowHours={input.initialValues.sessionReplayWindowHours ?? ""}
          />
        ) : null}
        <input type="hidden" name="replayAvailableUntil" value="" disabled={input.replayEnabled} readOnly />
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          回放觀看期限（{formatTimeZoneLabel(input.timeZone)}，選填）
          <input name="replayAvailableUntil" type="datetime-local" autoComplete="off" value={input.replayAvailableUntil} disabled={!input.replayEnabled} onChange={(event) => input.onReplayAvailableUntilChange(event.target.value)} className="h-11 rounded-md border border-border px-3 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500" />
          <span className="text-xs font-normal text-slate-500">依商家時區設定；留空代表不限制回放期限。期限必須晚於直播或預錄內容自然結束時間。</span>
        </label>
        <MediaUploadField
          kind="image"
          label="直播封面"
          description="直接上傳直播主視覺；完成後可在「發布」步驟預覽，網址欄位僅保留為進階相容選項。"
          defaultUrl={input.initialValues.heroImageUrl}
          defaultAssetId={input.initialValues.heroImageAssetId}
          urlInputName="heroImageUrl"
          assetIdInputName="heroImageAssetId"
          onValueChange={input.onMediaValueChange}
        />
        <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Logo、品牌色、寄件資訊與聯絡網址會沿用商店品牌設定。
          <Link href="/settings/brand" className="ml-1 font-semibold text-primary underline">編輯品牌設定</Link>
        </p>
      </AdvancedSettings>
    </StepPanel>
  );
}

/** 成交: products, promotion copy and the interaction script; referral, viewer limits and usage split are advanced. */
function renderLiveStudioSalesStep(input: LiveStudioSalesStepOptions) {
  const selectedScript = input.scripts.find((script) => script.id === input.selectedScriptId);
  return (
    <StepPanel active={input.activeStep === "sales"} step="sales">
      <StepHeading title="成交" description="選擇主打商品與直播促銷短句，並可搭配互動腳本帶動下單；內容型直播可以不選商品。" />
      <div data-readiness-focus="products" tabIndex={-1} className="grid gap-3">
        <ProductSelection
          products={input.products}
          selectedProductIds={input.selectedProductIds}
          onSelectionChange={input.onProductSelectionChange}
        />
      </div>
      <label className="grid gap-1.5 text-sm font-medium text-slate-700">
        促銷短句
        <input name="accentCopy" autoComplete="off" defaultValue={input.initialValues.accentCopy} onChange={(event) => input.onAccentCopyChange(event.target.value)} className="h-11 rounded-md border border-border px-3" placeholder="直播限定優惠" />
      </label>
      <div className="grid gap-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          互動腳本
          <select name="interactionScriptId" defaultValue={input.selectedScriptId} onChange={(event) => input.onScriptChange(event.target.value)} className="h-11 rounded-md border border-border px-3">
            <option value="">不綁定腳本</option>
            {input.scripts.map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}
          </select>
          <span className="text-xs font-normal text-slate-500">腳本會在直播中依時間送出留言、商品浮窗與購買按鈕；選配，不影響發布。</span>
        </label>
        {input.scripts.length === 0 ? <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">目前沒有已發布的互動腳本。<Link href="/interaction-scripts/new" className="ml-1 font-semibold text-primary underline">新增互動腳本</Link></p> : null}
        {input.selectedScriptId ? (
          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <p>已選腳本：<strong>{selectedScript?.name ?? "目前選取的腳本"}</strong></p>
            <p className="mt-1">事件摘要請至互動腳本編輯時間軸查看。</p>
            <Link href={`/interaction-scripts/${encodeURIComponent(input.selectedScriptId)}/edit`} className="mt-1 inline-flex font-semibold text-primary underline">至互動腳本編輯時間軸</Link>
          </div>
        ) : null}
      </div>
      <AdvancedSettings step="sales" summary="推薦來源、觀看人數上限與觀看用量分攤">
        <LiveRulesFields affiliates={input.affiliates} initialValues={input.initialValues} streamMembers={input.streamMembers} streamPages={input.streamPages} />
      </AdvancedSettings>
    </StepPanel>
  );
}

/** 通知: the registration confirmation (required to publish) and optional notification rules. */
function renderLiveStudioNotificationsStep(input: LiveStudioNotificationsStepOptions) {
  return (
    <StepPanel active={input.activeStep === "notifications"} step="notifications">
      <StepHeading title="通知" description="報名成功信是發布必要條件；開播前、直播中與課後通知皆可選配。" />
      <div className="grid gap-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            報名成功 Email
            {/* Controlled, so a template created in the drawer can be selected; the draft still serializes the DOM value. */}
            <select name="messageTemplateId" value={input.selectedTemplateId} onChange={(event) => input.onTemplateChange(event.target.value)} className="h-11 rounded-md border border-border px-3">
              <option value="">不綁定模板</option>
              {input.registrationTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.channel}</option>)}
            </select>
          </label>
        </div>
        {input.registrationTemplates.length === 0 ? <p className="text-sm text-slate-600">目前沒有可寄送的報名成功 Email，可以在這裡直接建立。</p> : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" aria-haspopup="dialog" onClick={() => input.onCreateTemplate("registration_confirmed")} className={inlineCreateButtonClass}>建立報名成功 Email</button>
        </div>
      </div>
      {/* Legacy single reminder binding: kept unchanged and submitted with the form. */}
      <input type="hidden" name="liveReminderTemplateId" value={input.initialValues.liveReminderTemplateId} readOnly />
      <input type="hidden" name="liveReminderOffsetMinutes" value={input.initialValues.liveReminderOffsetMinutes} readOnly />
      <NotificationRulesEditor rules={input.notificationRules} templates={input.notificationTemplates} onChange={input.onNotificationRulesChange} onCreateTemplate={input.onCreateTemplate} />
      {input.registrationTemplates.length === 0 || input.notificationTemplates.length === 0 ? (
        <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
          缺少可用 Email 模板時，可以用上方的按鈕直接建立；需要其他觸發條件或進階設定時，
          <FullEditorLink href="/messages/templates/new" />。
        </p>
      ) : null}
      <p className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">開播前與直播中通知已接通排程；課後通知維持既有排程。</p>
    </StepPanel>
  );
}

/** Badge state of each step; see `LiveStudioStepStatus`. */
function liveStudioStepStatuses(input: {
  readiness: ReturnType<typeof getLivePublishReadiness>;
  title: string;
  slug: string;
  scheduleSet: boolean;
  productCount: number;
  scriptSelected: boolean;
  notificationRules: LiveNotificationRuleDraft[];
  legacyReminderTemplateId: string;
}): Record<LiveStudioStepKey, LiveStudioStepStatus> {
  const ready = (code: LivePublishRequirementCodeWithReminder) => (
    input.readiness.requirements.find((requirement) => requirement.code === code)?.ready ?? true
  );
  const optionalStatus = (requiredReady: boolean, optionsSet: boolean): LiveStudioStepStatus => {
    if (!requiredReady) return "required";
    return optionsSet ? "complete" : "optional";
  };
  const contentReady = Boolean(input.title.trim() && input.slug.trim())
    && ready("media")
    && ready("registration_form")
    && input.scheduleSet;
  return {
    content: contentReady ? "complete" : "required",
    // Products and an interaction script are optional for a content live, but
    // a step without them is never shown as complete.
    sales: optionalStatus(ready("products"), input.productCount > 0 && input.scriptSelected),
    notifications: optionalStatus(
      ready("registration_email"),
      input.notificationRules.some((rule) => rule.isActive) || Boolean(input.legacyReminderTemplateId),
    ),
    publish: input.readiness.ready ? "complete" : "required",
  };
}

/** The address lives in the collapsed 進階設定: open it whenever the address is taken. */
function useRevealTakenSlug(formRef: { current: HTMLFormElement | null }, slugTaken: boolean) {
  useEffect(() => {
    if (!slugTaken || typeof HTMLElement === "undefined") return;
    const slugControl = formRef.current?.elements?.namedItem?.("slug");
    if (slugControl instanceof HTMLElement) revealCollapsedAncestors(slugControl);
  }, [formRef, slugTaken]);
}

/**
 * `namedItem` returns a RadioNodeList when several controls share a name, such
 * as the hidden fallback next to the visible replay deadline input. Only a
 * control the merchant can edit (not a hidden input, not disabled) is worth
 * revealing and focusing; a single named control is used as before.
 */
function editableNamedControl(item: Element | RadioNodeList | null): HTMLElement | null {
  if (!item) return null;
  if (item instanceof Element) return item instanceof HTMLElement ? item : null;
  for (const node of Array.from(item)) {
    if (!(node instanceof HTMLElement)) continue;
    if (node instanceof HTMLInputElement && node.type === "hidden") continue;
    if (node.matches(":disabled")) continue;
    return node;
  }
  return null;
}

/** F-117: 伺服器指出第一個無效欄位時，切到該步驟、標示 aria-invalid 並把焦點移過去；回傳欄位名稱供彙總訊息使用。 */
function useServerInvalidField(
  formRef: { current: HTMLFormElement | null },
  setActiveStep: (step: LiveStudioStepKey) => void,
  error?: string,
  invalidField?: string,
) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (error !== "invalid_draft" || !invalidField || !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(invalidField)) return;
    const control = editableNamedControl(formRef.current?.elements.namedItem(invalidField) ?? null);
    if (!control) return;
    const step = control.closest<HTMLElement>("[data-step-key]")?.dataset.stepKey;
    if (isLiveStudioStepKey(step)) setActiveStep(step);
    revealCollapsedAncestors(control);
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", "live-form-error");
    setLabel((control as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? "");
    requestAnimationFrame(() => control.focus());
    // 只在載入帶有伺服器錯誤的頁面時執行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return label;
}

function LiveDraftConflictActions({ draft }: { draft: { reloadLatest: () => void; keepMine: () => Promise<void> } }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => draft.reloadLatest()} className="min-h-11 rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-primary">載入最新</button>
      <button type="button" onClick={() => void draft.keepMine()} className="min-h-11 rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700">以我的覆蓋</button>
    </div>
  );
}

type LiveStudioIdentity = {
  draftId: string;
  revision: number;
  error: string;
  invalidField: string;
  currentStatus: string;
};

type LiveStudioSession = {
  requested: LiveStudioIdentity;
  /** The draft and newest revision this mounted studio has itself saved. */
  adoptedDraftId: string;
  adoptedRevision: number;
  generation: number;
};

/** Autosave states that still hold edits the server has not accepted. */
const unsavedDraftStatuses: ReadonlySet<string> = new Set(["dirty", "saving", "error", "conflict"]);

/**
 * Same draft in the same lifecycle state; only the revision (another admin
 * saved, or a revalidation) and/or the submit error differ. The error is shown
 * through props, so it needs no remount.
 */
function isSameDraftNewContext(session: LiveStudioSession, next: LiveStudioIdentity) {
  return next.draftId !== "" && next.draftId === session.adoptedDraftId
    && next.currentStatus === session.requested.currentStatus;
}

function sameIdentity(left: LiveStudioIdentity, right: LiveStudioIdentity) {
  return left.draftId === right.draftId && left.revision === right.revision && left.error === right.error
    && left.invalidField === right.invalidField && left.currentStatus === right.currentStatus;
}

/** True when new server props only catch up with what this studio already holds. */
function isOwnDraftCatchUp(session: LiveStudioSession, next: LiveStudioIdentity) {
  const previous = session.requested;
  return next.draftId === session.adoptedDraftId
    && next.revision <= session.adoptedRevision
    && next.error === previous.error
    && next.invalidField === previous.invalidField
    && next.currentStatus === previous.currentStatus;
}

/**
 * Next keeps client state when a page navigates to itself: 「繼續這份草稿」
 * (`/lives/new?draft=`), a submit error redirect, or the edit page after a
 * status change. A stale studio kept the blank form's selects, slug and
 * replay deadline, an empty draft queue that created a second draft row, an
 * outdated revision, or an open confirmation for the next status action.
 * Remount whenever the server hands over a different draft, a newer revision,
 * another status or a new submit error — except when the URL only caught up
 * with the draft and revision this studio already autosaved.
 *
 * A newer revision or a new error for the same draft never remounts a studio
 * that still holds unsaved edits: the form keeps them (a new error is shown
 * through props) and the revision is not adopted, so the next save reports a
 * conflict and the user chooses between 「載入最新」 and 「以我的覆蓋」
 * instead of silently losing the typing.
 */
export function LiveStepperForm(props: LiveStepperFormProps) {
  const requested: LiveStudioIdentity = {
    draftId: props.initialDraft?.id ?? "",
    revision: props.initialDraft?.revision ?? 0,
    error: props.error ?? "",
    invalidField: props.invalidField ?? "",
    currentStatus: props.currentStatus ?? "draft",
  };
  const [session, setSession] = useState<LiveStudioSession>(() => ({
    requested, adoptedDraftId: requested.draftId, adoptedRevision: requested.revision, generation: 0,
  }));
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  let current = session;
  if (!sameIdentity(session.requested, requested)) {
    current = isOwnDraftCatchUp(session, requested) || (hasUnsavedEdits && isSameDraftNewContext(session, requested))
      ? { ...session, requested }
      : { requested, adoptedDraftId: requested.draftId, adoptedRevision: requested.revision, generation: session.generation + 1 };
    setSession(current);
  }
  const adoptDraft = useCallback((draftId: string, revision: number) => {
    setSession((latest) => latest.adoptedDraftId === draftId && latest.adoptedRevision === revision
      ? latest
      : { ...latest, adoptedDraftId: draftId, adoptedRevision: revision });
  }, []);
  return <LiveStudioStepperForm key={current.generation} {...props} onDraftSaved={adoptDraft} onUnsavedChange={setHasUnsavedEdits} />;
}

function useReportedDraft(draftId: string, revision: number | null, onDraftSaved?: (draftId: string, revision: number) => void) {
  useEffect(() => {
    if (draftId && revision) onDraftSaved?.(draftId, revision);
  }, [draftId, revision, onDraftSaved]);
}

/**
 * Serializes the submit-time draft flush: while the latest draft is being
 * saved before a submit, further submits (a double click on the confirmation)
 * are ignored instead of starting a second save and a second Server Action.
 * Plain object, no memo hooks, so the lightweight hook harness can call it.
 */
function useSubmitFlushGuard() {
  const inFlightRef = useRef(false);
  const [busy, setBusy] = useState(false);
  return {
    busy,
    isInFlight: () => inFlightRef.current,
    begin: () => { inFlightRef.current = true; setBusy(true); },
    end: () => { inFlightRef.current = false; setBusy(false); },
  };
}

/**
 * The 「就地建立」 drawers of the studio: which one is open, the options they
 * created, and what happens after a create. Created options are merged with
 * the server props instead of replacing them: the props may refresh (a form
 * create revalidates the page) or, behind the edit page's project filter,
 * never list them. Only useState／useRef／useEffect, like the studio itself.
 */
function useLiveResourceDrawers(input: {
  formRef: { current: HTMLFormElement | null };
  videos: Array<Pick<Video, "id" | "title">>;
  forms: LiveFormOption[];
  templates: LiveTemplateOption[];
  csrfToken: string;
  projectId?: string | null;
  liveTitle: string;
  submitBusy: boolean;
  scheduleSave: () => void;
  selectVideo: (videoId: string) => void;
  selectForm: (formId: string) => void;
  selectRegistrationTemplate: (templateId: string) => void;
}) {
  const [createdVideos, setCreatedVideos] = useState<LiveQuickVideoOption[]>([]);
  /** Uploaded videos still processing at Cloudflare, or settled after being so; lost on remount by design. */
  const [pendingVideos, setPendingVideos] = useState<LivePendingVideo[]>([]);
  /** Counts the merchant's own changes of the video select; an upload only auto-selects if it did not move. */
  const manualVideoSelectionRef = useRef(0);
  const [createdForms, setCreatedForms] = useState<LiveQuickFormOption[]>([]);
  const [createdTemplates, setCreatedTemplates] = useState<LiveQuickTemplateOption[]>([]);
  const [drawer, setDrawer] = useState<LiveResourceDrawer | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /**
   * True from the moment a drawer submits until its result is in the studio's
   * DOM and queued for saving. The create revalidates the page, which can hand
   * the studio a newer draft revision; this keeps the studio counted as having
   * unsaved edits so that refresh does not remount it and drop the selection.
   */
  const [creating, setCreating] = useState(false);
  /** Set when a drawer created something: the control to focus (if any) and whether the draft changed. */
  const focusPendingRef = useRef<{ selector?: string; save: boolean } | null>(null);
  const { formRef, scheduleSave } = input;
  /** The result is in the DOM and queued for saving; a no-op when nothing is in flight. */
  const settleCreate = () => setCreating(false);
  // Runs once the new option is in the DOM and after the drawer's own cleanup
  // returned focus to its trigger, so the draft serializes the new value and
  // focus lands on the field that now holds it.
  useEffect(() => {
    const pending = focusPendingRef.current;
    if (!pending) return;
    focusPendingRef.current = null;
    const target = pending.selector ? formRef.current?.querySelector<HTMLElement>(pending.selector) : null;
    if (target) {
      revealCollapsedAncestors(target);
      target.focus();
    }
    if (pending.save) scheduleSave();
    // Same batch as the save's dirty status, so "unsaved" never dips in between.
    settleCreate();
  });

  /** True while the studio's own submit (pending lock, or the pre-submit draft flush) runs. */
  const studioSubmitting = () => input.submitBusy || formRef.current?.getAttribute("aria-busy") === "true";

  /** The studio's own submit must finish first. */
  function open(next: LiveResourceDrawer) {
    if (studioSubmitting()) return;
    setAnnouncement("");
    setDrawer(next);
  }

  function addVideoOption(option: LiveQuickVideoOption) {
    setCreatedVideos((current) => [option, ...current.filter((candidate) => candidate.id !== option.id)]);
  }

  function markManualVideoSelection() {
    manualVideoSelectionRef.current += 1;
  }

  /** An external URL video: ready at once, so it is selected like a created form. */
  function urlVideoCreated(option: LiveQuickVideoOption, ready: boolean) {
    setDrawer(null);
    if (!ready) {
      videoUploaded(option);
      return;
    }
    addVideoOption(option);
    input.selectVideo(option.id);
    setAnnouncement(`已建立並選取影片「${option.title}」。`);
    focusPendingRef.current = { selector: '[name="videoId"]', save: true };
  }

  /** An uploaded file reached Cloudflare: wait for processing under the select. */
  function videoUploaded(option: LiveQuickVideoOption) {
    setPendingVideos((current) => [
      ...current.filter((candidate) => candidate.id !== option.id),
      { ...option, manualSelectionAtStart: manualVideoSelectionRef.current },
    ]);
    setDrawer(null);
    setAnnouncement(`影片「${option.title}」已上傳，正在轉檔；完成後會自動選取。可以先繼續其他步驟。`);
    focusPendingRef.current = { save: false };
  }

  function pendingVideoReady(video: LivePendingVideo) {
    // Never move the selection under the merchant's own change, or during the studio's submit.
    const select = manualVideoSelectionRef.current === video.manualSelectionAtStart && !studioSubmitting();
    addVideoOption({ id: video.id, title: video.title });
    setPendingVideos((current) => current.map((candidate) => (
      candidate.id === video.id ? { ...candidate, outcome: select ? "selected" : "added" } : candidate
    )));
    if (select) {
      input.selectVideo(video.id);
      focusPendingRef.current = { save: true };
      setAnnouncement(`影片「${video.title}」已可播放，已自動選為這場直播的影片。`);
    } else {
      setAnnouncement(`影片「${video.title}」已可播放並加入選單；目前仍保留你選的影片。`);
    }
  }

  function pendingVideoProblem(video: LivePendingVideo, problem: LivePendingVideoProblem) {
    setAnnouncement(problem === "failed"
      ? `影片「${video.title}」轉檔失敗，無法播放。`
      : problem === "archived"
        ? `影片「${video.title}」已被封存，不能選為直播影片。`
        : `找不到影片「${video.title}」，可能已被刪除。`);
  }

  function formCreated(option: LiveQuickFormOption) {
    setCreatedForms((current) => [option, ...current.filter((candidate) => candidate.id !== option.id)]);
    input.selectForm(option.id);
    setDrawer(null);
    setAnnouncement(`已建立並選取報名表「${option.name}」。`);
    focusPendingRef.current = { selector: '[name="formId"]', save: true };
  }

  function templateCreated(option: LiveQuickTemplateOption, ruleTrigger?: LiveNotificationRuleTrigger) {
    setCreatedTemplates((current) => [option, ...current.filter((candidate) => candidate.id !== option.id)]);
    setDrawer(null);
    if (option.trigger === "registration_confirmed") {
      input.selectRegistrationTemplate(option.id);
      setAnnouncement(`已建立並選取報名成功 Email「${option.name}」。`);
      focusPendingRef.current = { selector: '[name="messageTemplateId"]', save: true };
      return;
    }
    setAnnouncement(`已建立 Email 模板「${option.name}」，現在可以新增通知規則。`);
    focusPendingRef.current = {
      selector: ruleTrigger ? `[data-notification-add="${ruleTrigger}"]` : '[name="messageTemplateId"]',
      save: false,
    };
  }

  const close = () => setDrawer(null);
  // Portalled to <body>: their <form>s are outside the studio form's DOM and
  // their React events stop at the drawer root.
  let drawerElement: React.ReactNode = null;
  if (drawer?.kind === "video") {
    drawerElement = (
      <VideoQuickCreateDrawer csrfToken={input.csrfToken} defaultTitle={input.liveTitle} onClose={close} onUploaded={videoUploaded} onUrlCreated={urlVideoCreated} onInFlightChange={setCreating} />
    );
  } else if (drawer?.kind === "form") {
    drawerElement = (
      <RegistrationFormQuickCreateDrawer csrfToken={input.csrfToken} projectId={input.projectId} defaultTitle={input.liveTitle} onClose={close} onCreated={formCreated} onInFlightChange={setCreating} />
    );
  } else if (drawer?.kind === "template") {
    drawerElement = (
      <MessageTemplateQuickCreateDrawer key={`${drawer.trigger}:${drawer.ruleTrigger ?? ""}`} csrfToken={input.csrfToken} trigger={drawer.trigger} ruleTrigger={drawer.ruleTrigger} onClose={close} onCreated={(option) => templateCreated(option, drawer.ruleTrigger)} onInFlightChange={setCreating} />
    );
  }

  const templates = mergeLiveResourceOptions(input.templates, createdTemplates);
  return {
    videos: mergeLiveResourceOptions(input.videos, createdVideos),
    pendingVideos,
    pendingVideoReady,
    pendingVideoProblem,
    markManualVideoSelection,
    forms: mergeLiveResourceOptions(input.forms, createdForms),
    registrationTemplates: templates.filter((template) => template.trigger === "registration_confirmed"),
    notificationTemplates: templates.filter((template) => template.trigger === "live_reminder" || template.trigger === "post_live_followup"),
    announcement,
    creating,
    open,
    drawerElement,
  };
}

type LiveStepperFormProps = {
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
  /** F-117: form-control name of the first field the server rejected (`?field=`). */
  invalidField?: string;
  initialDraft?: LiveStudioDraftEnvelope;
  initialValues?: LiveStudioDraftPayload;
  liveId?: string;
  projectId?: string | null;
  currentStatus?: string;
  timeZone: string;
  /** Stored 指定場次 of an existing Live, with their registration counts. */
  fixedSessionSummaries?: StoredFixedSessionSummary[];
};

/** The four-step studio for one draft; mount it through `LiveStepperForm`. */
export function LiveStudioStepperForm({
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
  invalidField,
  initialDraft,
  initialValues: suppliedInitialValues,
  liveId = "",
  projectId,
  currentStatus = "draft",
  timeZone,
  fixedSessionSummaries = [],
  onDraftSaved,
  onUnsavedChange,
}: LiveStepperFormProps & {
  onDraftSaved?: (draftId: string, revision: number) => void;
  onUnsavedChange?: (unsaved: boolean) => void;
}) {
  const initialValues = initialDraft?.payload ?? suppliedInitialValues ?? emptyLiveStudioDraft();
  const [activeStepKey, setActiveStepKey] = useState<LiveStudioStepKey>(liveStudioStepAt(initialValues.activeStep).key);
  /** The persisted position of the active step in the current flow version. */
  const activeStep = liveStudioStepIndex(activeStepKey);
  const [previewTitle, setPreviewTitle] = useState(initialValues.title);
  const [slug, setSlug] = useState(initialValues.slug);
  const [scheduledAt, setScheduledAt] = useState(initialValues.scheduledAt);
  const [previewAccentCopy, setPreviewAccentCopy] = useState(initialValues.accentCopy);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(initialValues.productIds);
  const [validationMessage, setValidationMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const invalidFocusPendingRef = useRef(false);
  const readinessFocusPendingRef = useRef<LivePublishRequirementCodeWithReminder | null>(null);
  const stepHeadingFocusPendingRef = useRef(false);
  const invalidFieldLabel = useServerInvalidField(formRef, setActiveStepKey, error, invalidField);
  const [selectedVideoId, setSelectedVideoId] = useState(initialValues.videoId);
  const [selectedFormId, setSelectedFormId] = useState(initialValues.formId);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialValues.messageTemplateId);
  const [selectedScriptId, setSelectedScriptId] = useState(initialValues.interactionScriptId);
  const [replayEnabled, setReplayEnabled] = useState(initialValues.replayEnabled);
  const [studioPreset, setStudioPreset] = useState<LiveStudioPreset>(initialValues.studioPreset);
  const [notificationRules, setNotificationRules] = useState<LiveNotificationRuleDraft[]>(initialValues.notificationRules);
  const [replayAvailableUntil, setReplayAvailableUntil] = useState(
    initialValues.replayEnabled ? initialValues.replayAvailableUntil : "",
  );
  const [sessionMode, setSessionMode] = useState<"single" | "fixed_sessions">(initialValues.sessionMode === "fixed_sessions" ? "fixed_sessions" : "single");
  const [fixedSessionRows, setFixedSessionRows] = useState<FixedSessionDraftRow[]>(initialValues.fixedSessions ?? []);
  const [streamMode, setStreamMode] = useState(initialValues.streamMode);
  // Only drives the past-time hint; the publish action re-checks on the server.
  const nowLocal = formatZonedDateTimeLocal(new Date(), timeZone);
  const latestFixedSessionStart = fixedSessionRows.map((row) => row.startAt).filter(Boolean).sort().at(-1) ?? "";
  const draft = useLiveStudioDraft({
    activeStep,
    csrfToken,
    formRef,
    initialDraft,
    liveId,
    saveOnMount: Boolean(liveId && !initialDraft),
  });
  useLiveStudioPresetSave(studioPreset, draft.scheduleSave);
  useReportedDraft(draft.draftId, draft.revision, onDraftSaved);
  const unsaved = unsavedDraftStatuses.has(draft.status);
  useRevealTakenSlug(formRef, error === "slug_taken" || Boolean(draft.slugTaken));
  const submitFlush = useSubmitFlushGuard();
  const resources = useLiveResourceDrawers({
    formRef,
    videos,
    forms,
    templates,
    csrfToken,
    projectId,
    liveTitle: previewTitle,
    submitBusy: submitFlush.busy,
    scheduleSave: draft.scheduleSave,
    selectVideo: setSelectedVideoId,
    selectForm: setSelectedFormId,
    selectRegistrationTemplate: setSelectedTemplateId,
  });
  const { videos: availableVideos, forms: availableForms, registrationTemplates, notificationTemplates } = resources;
  // A drawer create in flight counts as unsaved edits (see useLiveResourceDrawers).
  const holdsUnsavedEdits = unsaved || resources.creating;
  useEffect(() => { onUnsavedChange?.(holdsUnsavedEdits); }, [holdsUnsavedEdits, onUnsavedChange]);
  const preview = buildLivePreview(previewTitle, previewAccentCopy, products, selectedProductIds); const statusAction = liveId ? fixedSessionStatusAction(liveStatusAction(currentStatus), sessionMode) : null;
  const publishReadiness = buildLivePublishReadiness({ studioPreset, products, productIds: selectedProductIds, videos: availableVideos, videoId: selectedVideoId, forms: availableForms, formId: selectedFormId, templates: registrationTemplates, templateId: selectedTemplateId, scripts, scriptId: selectedScriptId });
  const stepStatus = liveStudioStepStatuses({
    readiness: publishReadiness,
    title: previewTitle,
    slug,
    scheduleSet: sessionMode === "fixed_sessions" ? Boolean(latestFixedSessionStart) : Boolean(scheduledAt),
    productCount: selectedProductIds.length,
    scriptSelected: scripts.some((script) => script.id === selectedScriptId),
    notificationRules,
    legacyReminderTemplateId: initialValues.liveReminderTemplateId,
  });
  const onPublishStep = activeStepKey === "publish";

  useEffect(() => {
    const code = readinessFocusPendingRef.current;
    if (!code) {
      // F-118: 手動切換步驟後把焦點移到新步驟的標題，讓鍵盤與螢幕閱讀器知道內容已換。
      if (!stepHeadingFocusPendingRef.current) return;
      stepHeadingFocusPendingRef.current = false;
      const panel = formRef.current?.querySelector<HTMLElement>(`[data-step-key="${activeStepKey}"]`);
      const heading = panel?.querySelector<HTMLElement>("h2, h3") ?? panel;
      if (heading && typeof heading.setAttribute === "function") {
        if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
      return;
    }
    const target = formRef.current?.querySelector<HTMLElement>(readinessFocusSelector[code]);
    if (target) revealCollapsedAncestors(target);
    target?.focus();
    readinessFocusPendingRef.current = null;
  }, [activeStepKey]);
  function validateCurrentStep() {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-step-key="${activeStepKey}"]`);
    const invalidControl = panel?.querySelector<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("input:invalid, select:invalid, textarea:invalid");
    if (!invalidControl) {
      setValidationMessage("");
      return true;
    }

    setValidationMessage(requiredFieldsMessage);
    revealCollapsedAncestors(invalidControl);
    invalidControl.reportValidity();
    return false;
  }

  function moveToStep(nextStepKey: LiveStudioStepKey) {
    const nextStep = liveStudioStepIndex(nextStepKey);
    if (nextStep > activeStep && !validateCurrentStep()) return;
    stepHeadingFocusPendingRef.current = nextStep !== activeStep;
    setValidationMessage(""); setActiveStepKey(nextStepKey); draft.scheduleSave(nextStep);
  }

  function selectStudioPreset(preset: LiveStudioPreset) {
    const accentCopy = applyLiveStudioPreset(formRef.current, preset);
    setStudioPreset(preset);
    if (accentCopy) setPreviewAccentCopy(accentCopy);
  }

  function fixReadinessRequirement(code: LivePublishRequirementCodeWithReminder) {
    const step = readinessCopy[code].step;
    readinessFocusPendingRef.current = code;
    setValidationMessage("");
    setActiveStepKey(step);
    draft.scheduleSave(liveStudioStepIndex(step));
  }

  function updateNotificationRules(rules: LiveNotificationRuleDraft[]) {
    setNotificationRules(rules);
    draft.scheduleSave();
  }

  return (
    <form
      ref={formRef}
      action={upsertLiveAction}
      className="grid gap-5"
      onChange={(event) => {
        const target = event?.target as EventTarget as HTMLInputElement | HTMLSelectElement | undefined;
        if (target?.name === "streamMode") setStreamMode(target.value === "live" ? "live" : "vod");
        draft.scheduleSave();
      }}
      onInvalid={(event) => handleLiveFormInvalid(event, invalidFocusPendingRef, setActiveStepKey, setValidationMessage)}
      onSubmit={(event) => submitOnlyAfterLatestDraft(event, activeStep, draft, formRef.current, submitFlush)}
    >
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <LiveFormPendingLock formRef={formRef} />
      {!liveId && projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      {liveId ? <input type="hidden" name="id" value={liveId} /> : null}
      <input type="hidden" name="liveDraftId" value={draft.draftId} readOnly />
      <input type="hidden" name="liveDraftRevision" value={draft.revision ?? ""} readOnly />
      <input type="hidden" name="flowVersion" value={String(LIVE_STUDIO_FLOW_VERSION)} readOnly />
      <input type="hidden" name="notificationRules" value={JSON.stringify(notificationRules)} readOnly />
      {liveFormError(error, invalidFieldLabel)}
      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-red-700">
        {validationMessage}
      </p>
      <p role="status" aria-live="polite" data-live-resource-status="true" className={resources.announcement ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900" : "sr-only"}>
        {resources.announcement}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
        <p
          role={draft.status === "conflict" || draft.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`text-sm font-medium ${draft.status === "conflict" || draft.status === "error" ? "text-red-700" : "text-slate-700"}`}
        >
          {draft.message}
        </p>
        {draft.status === "conflict" ? <LiveDraftConflictActions draft={draft} /> : null}
        <button
          type="button"
          onClick={() => void draft.saveNow()}
          disabled={draft.status === "saving" || draft.status === "conflict"}
          aria-busy={draft.status === "saving"}
          className="min-h-11 rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {draft.status === "saving" ? "儲存中…" : "立即儲存草稿"}
        </button>
      </div>
      <LiveStudioStepNav activeStep={activeStepKey} statuses={stepStatus} onSelect={moveToStep} />

      <div className={liveStudioWorkspaceClass(onPublishStep)}>
        <div className="grid min-w-0 gap-5">
          <MobileLivePreviewToggle preview={preview} hidden={onPublishStep} />

          {renderLiveStudioContentStep({
            activeStep: activeStepKey,
            initialValues,
            studioPreset,
            purposeStarter: !liveId ? <LiveStudioPurposeStarter selectedPreset={studioPreset} onSelect={selectStudioPreset} /> : null,
            title: previewTitle,
            slug,
            onTitleChange: setPreviewTitle,
            onSlugChange: setSlug,
            onSlugAutoFill: () => draft.scheduleSave(),
            slugTakenOnSubmit: error === "slug_taken",
            slugTakenInDraft: Boolean(draft.slugTaken),
            slugCheckFailed: Boolean(draft.slugCheckFailed),
            videos: availableVideos,
            selectedVideoId,
            onVideoChange: (videoId) => { resources.markManualVideoSelection(); setSelectedVideoId(videoId); },
            onCreateVideo: () => resources.open({ kind: "video" }),
            pendingVideos: resources.pendingVideos,
            onPendingVideoReady: resources.pendingVideoReady,
            onPendingVideoProblem: resources.pendingVideoProblem,
            forms: availableForms,
            selectedFormId,
            onFormChange: setSelectedFormId,
            onCreateForm: () => resources.open({ kind: "form" }),
            timeZone,
            replayEnabled,
            replayAvailableUntil,
            onScheduledAtChange: setScheduledAt,
            onReplayEnabledChange: (enabled) => { setReplayEnabled(enabled); if (!enabled) setReplayAvailableUntil(""); },
            onReplayAvailableUntilChange: setReplayAvailableUntil,
            onMediaValueChange: () => draft.scheduleSave(),
            fixedSessions: {
              mode: sessionMode,
              latestStartAt: latestFixedSessionStart,
              nowLocal,
              storedSessions: fixedSessionSummaries,
              streamMode,
              onModeChange: (mode) => { setSessionMode(mode); draft.scheduleSave(); },
              onRowsChange: (rows) => { setFixedSessionRows(rows); draft.scheduleSave(); },
            },
          })}

          {renderLiveStudioSalesStep({
            activeStep: activeStepKey,
            initialValues,
            products,
            selectedProductIds,
            onProductSelectionChange: (productId, checked) => setSelectedProductIds(
              (currentIds) => updateSelectedProductIds(currentIds, productId, checked),
            ),
            onAccentCopyChange: setPreviewAccentCopy,
            scripts,
            selectedScriptId,
            onScriptChange: setSelectedScriptId,
            affiliates,
            streamMembers,
            streamPages,
          })}

          {renderLiveStudioNotificationsStep({
            activeStep: activeStepKey,
            initialValues,
            registrationTemplates,
            selectedTemplateId,
            onTemplateChange: setSelectedTemplateId,
            notificationTemplates,
            notificationRules,
            onNotificationRulesChange: updateNotificationRules,
            onCreateTemplate: (trigger, ruleTrigger) => resources.open({ kind: "template", trigger, ruleTrigger }),
          })}

          <StepPanel active={onPublishStep} step="publish">
            <LiveReviewPanel preview={preview} readiness={publishReadiness} onFix={fixReadinessRequirement} />
          </StepPanel>

          <div className="flex flex-wrap justify-between gap-3">
            <button type="button" onClick={() => moveToStep(liveStudioStepAt(Math.max(0, activeStep - 1)).key)} disabled={activeStep === 0} className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
              上一步
            </button>
            {activeStep < steps.length - 1 ? (
              <button type="button" onClick={() => moveToStep(liveStudioStepAt(Math.min(steps.length - 1, activeStep + 1)).key)} className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
                下一步
              </button>
            ) : (
              <LiveSubmitActions
                canSubmit={draft.canSubmit}
                savingBeforeSubmit={submitFlush.busy}
                currentStatus={currentStatus}
                liveId={liveId}
                publishReady={publishReadiness.ready}
                replayEnabled={replayEnabled}
                statusAction={statusAction}
              />
            )}
          </div>
        </div>

        <LiveSidePreview preview={preview} hidden={onPublishStep} />
      </div>
      {resources.drawerElement}
    </form>
  );
}
