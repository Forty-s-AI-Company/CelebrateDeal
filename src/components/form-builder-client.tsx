"use client";

import { Plus, RotateCcw, Save } from "lucide-react";
import { useActionState, useCallback, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  upsertFormBuilderAction,
  type FormBuilderActionState,
} from "@/app/actions/form-actions";
import { FormFieldEditor, registrationFormFieldTypeLabel } from "@/components/form-field-editor";
import { MediaUploadField, type MediaUploadPersistedValue } from "@/components/media-upload-field";
import { FormPreview } from "@/components/form-preview";
import { useRegistrationFormDraft } from "@/components/use-registration-form-draft";
import {
  createRegistrationFormField,
  defaultRegistrationFormBuilderFields,
  moveRegistrationFormField,
  REGISTRATION_FORM_FIELD_TYPES,
  type RegistrationFormBuilderField,
  type RegistrationFormBuilderFieldType,
} from "@/lib/registration-form-builder";

export type FormBuilderValues = {
  id?: string;
  name: string;
  slug: string;
  headline: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  heroImageUrl: string | null;
  heroImageAssetId: string | null;
  backgroundImageUrl: string | null;
  backgroundImageAssetId: string | null;
  promoVideoId: string | null;
  themeColor: string | null;
  countdownMinutes: number | null;
  stickyText: string | null;
  bodyContent: string | null;
  notice: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  maxVisibleSessions: number;
  hideExpiredSessions: boolean;
  isActive: boolean;
};

export type FormPromoVideoOption = { id: string; title: string };

type RemovedField = { field: RegistrationFormBuilderField; index: number };

const inputClass = "h-11 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100";
const textareaClass = "rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100";

function InlineError({ id, message }: { id: string; message?: string }) {
  return message ? <span id={id} className="text-xs font-normal text-red-700">{message}</span> : null;
}

type FormDraftState = ReturnType<typeof useRegistrationFormDraft>;

function FormDraftRecovery({ draft }: { draft: FormDraftState }) {
  return (
    <>
      {draft.candidate ? (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">找到尚未儲存的表單草稿</p>
          <p className="mt-1 leading-6">草稿保存於這台裝置，最後更新時間為 {new Date(draft.candidate.savedAt).toLocaleString("zh-TW")}。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={draft.restoreDraft} className="min-h-11 rounded-md bg-amber-900 px-4 font-semibold text-white">恢復草稿</button>
            <button type="button" onClick={draft.discardDraft} className="min-h-11 rounded-md border border-amber-400 bg-white px-4 font-semibold">捨棄草稿</button>
          </div>
        </div>
      ) : null}
      {draft.unsafeDraft ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">{draft.unsafeDraft === "stale" ? "找到較舊的瀏覽器草稿" : "瀏覽器草稿無法安全讀取"}</p>
          <p className="mt-1 leading-6">為避免覆蓋伺服器內容，系統不會套用這份草稿。</p>
          <button type="button" onClick={draft.discardDraft} className="mt-3 min-h-11 rounded-md border border-amber-400 bg-white px-4 font-semibold">捨棄這份草稿</button>
        </div>
      ) : null}
      {draft.message ? (
        <p role={draft.saveStatus === "error" ? "alert" : "status"} className={`rounded-md px-4 py-3 text-sm ${draft.saveStatus === "error" ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-900"}`}>
          {draft.message}
        </p>
      ) : null}
    </>
  );
}

function formDraftStatusMessage(status: FormDraftState["saveStatus"]) {
  if (status === "saving") return "正在保存瀏覽器草稿…";
  if (status === "saved") return "草稿已自動保存於這台裝置。";
  if (status === "error") return "草稿自動保存目前不可用。";
  return "修改後會自動保存瀏覽器草稿。";
}

type FormBuilderErrors = NonNullable<FormBuilderActionState["fieldErrors"]>;
type UpdateFormValue = <Key extends keyof FormBuilderValues>(key: Key, value: FormBuilderValues[Key]) => void;

function normalizeFormBuilderValues(values: FormBuilderValues | Parameters<Parameters<typeof useRegistrationFormDraft>[0]["onRestore"]>[0]["values"]): FormBuilderValues {
  return {
    ...values,
    heroImageUrl: values.heroImageUrl ?? null,
    heroImageAssetId: values.heroImageAssetId ?? null,
    backgroundImageUrl: values.backgroundImageUrl ?? null,
    backgroundImageAssetId: values.backgroundImageAssetId ?? null,
    promoVideoId: values.promoVideoId ?? null,
    themeColor: values.themeColor ?? null,
    countdownMinutes: values.countdownMinutes ?? null,
    stickyText: values.stickyText ?? null,
    bodyContent: values.bodyContent ?? null,
    notice: values.notice ?? null,
    seoTitle: values.seoTitle ?? null,
    seoDescription: values.seoDescription ?? null,
    maxVisibleSessions: values.maxVisibleSessions ?? 0,
    hideExpiredSessions: values.hideExpiredSessions ?? true,
  };
}

function mediaValue(value: MediaUploadPersistedValue) {
  return { url: value.url || null, assetId: value.assetId || null };
}

function FormBuilderMediaSettings({
  values,
  errors,
  hydrationKey,
  promoVideos,
  updateValue,
  onHeroBlockingChange,
  onBackgroundBlockingChange,
}: {
  values: FormBuilderValues;
  errors: FormBuilderErrors;
  hydrationKey: number;
  promoVideos: FormPromoVideoOption[];
  updateValue: UpdateFormValue;
  onHeroBlockingChange: (blocked: boolean) => void;
  onBackgroundBlockingChange: (blocked: boolean) => void;
}) {
  return (
    <div className="mt-6 grid gap-4 border-t border-slate-200 pt-5">
      <h3 className="text-base font-semibold text-slate-900">海報、背景與宣傳影片</h3>
      <div className="grid gap-1.5">
        <MediaUploadField
          kind="image"
          label="報名頁海報"
          description="直接拖拉或選擇主視覺；完成後會立即預覽。"
          defaultUrl={values.heroImageUrl}
          defaultAssetId={values.heroImageAssetId}
          urlInputName="heroImageUrl"
          assetIdInputName="heroImageAssetId"
          statusInputName="heroImageUploadPhase"
          allowExternalUrlFallback
          invalid={Boolean(errors.heroImageAssetId ?? errors.heroImageUrl)}
          errorId="form-hero-media-error"
          hydrationKey={hydrationKey}
          onValueChange={(value) => {
            const next = mediaValue(value);
            updateValue("heroImageUrl", next.url);
            updateValue("heroImageAssetId", next.assetId);
          }}
          onBlockingChange={onHeroBlockingChange}
        />
        <InlineError id="form-hero-media-error" message={errors.heroImageAssetId ?? errors.heroImageUrl} />
      </div>
      <div className="grid gap-1.5">
        <MediaUploadField
          kind="image"
          label="報名頁背景"
          description="上傳頁面背景圖；文字仍會放在可閱讀的內容卡片上。"
          defaultUrl={values.backgroundImageUrl}
          defaultAssetId={values.backgroundImageAssetId}
          urlInputName="backgroundImageUrl"
          assetIdInputName="backgroundImageAssetId"
          statusInputName="backgroundImageUploadPhase"
          allowExternalUrlFallback
          invalid={Boolean(errors.backgroundImageAssetId ?? errors.backgroundImageUrl)}
          errorId="form-background-media-error"
          hydrationKey={hydrationKey}
          onValueChange={(value) => {
            const next = mediaValue(value);
            updateValue("backgroundImageUrl", next.url);
            updateValue("backgroundImageAssetId", next.assetId);
          }}
          onBlockingChange={onBackgroundBlockingChange}
        />
        <InlineError id="form-background-media-error" message={errors.backgroundImageAssetId ?? errors.backgroundImageUrl} />
      </div>
      <label className="grid gap-1.5 text-sm font-medium text-slate-700">
        宣傳影片
        <select
          name="promoVideoId"
          value={values.promoVideoId ?? ""}
          onChange={(event) => updateValue("promoVideoId", event.target.value || null)}
          aria-invalid={Boolean(errors.promoVideoId)}
          aria-describedby={errors.promoVideoId ? "form-promo-video-error" : "form-promo-video-help"}
          className={inputClass}
        >
          <option value="">不顯示宣傳影片</option>
          {promoVideos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
        </select>
        <span id="form-promo-video-help" className="text-xs font-normal text-slate-500">只列出目前商家已可播放的影片。</span>
        <InlineError id="form-promo-video-error" message={errors.promoVideoId} />
      </label>
    </div>
  );
}

function FormBuilderPublicSettings({
  values,
  errors,
  updateValue,
}: {
  values: FormBuilderValues;
  errors: FormBuilderErrors;
  updateValue: UpdateFormValue;
}) {
  const colorPickerValue = /^#[\da-fA-F]{6}$/.test(values.themeColor ?? "")
    ? values.themeColor!
    : "#000000";

  return (
    <div className="mt-6 grid gap-4 border-t border-slate-200 pt-5">
      <h3 className="text-base font-semibold text-slate-900">公開內容與顯示設定</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          主題色
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={colorPickerValue}
              onChange={(event) => updateValue("themeColor", event.target.value)}
              aria-label="選擇主題色"
              className="h-11 w-14 rounded-md border border-slate-200 bg-white p-1"
            />
            <input
              name="themeColor"
              value={values.themeColor ?? ""}
              onChange={(event) => updateValue("themeColor", event.target.value || null)}
              maxLength={7}
              pattern="#[0-9A-Fa-f]{6}"
              spellCheck={false}
              placeholder="#RRGGBB"
              className={`${inputClass} min-w-0 flex-1 font-mono uppercase`}
            />
          </div>
          <span className="text-xs font-normal text-slate-500">請輸入完整的 #RRGGBB 色碼。</span>
          <InlineError id="form-theme-color-error" message={errors.themeColor} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          倒數分鐘
          <input
            name="countdownMinutes"
            type="number"
            min={0}
            max={10_080}
            step={1}
            value={values.countdownMinutes ?? ""}
            onChange={(event) => updateValue("countdownMinutes", event.target.value === "" ? null : Number(event.target.value))}
            className={inputClass}
          />
          <span className="text-xs font-normal text-slate-500">留白代表不設定，最多 10,080 分鐘。</span>
          <InlineError id="form-countdown-minutes-error" message={errors.countdownMinutes} />
        </label>
      </div>
      <label className="grid gap-1.5 text-sm font-medium text-slate-700">
        置頂文字
        <input name="stickyText" maxLength={300} value={values.stickyText ?? ""} onChange={(event) => updateValue("stickyText", event.target.value || null)} className={inputClass} />
        <InlineError id="form-sticky-text-error" message={errors.stickyText} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-slate-700">
        內文
        <textarea name="bodyContent" rows={5} maxLength={10_000} value={values.bodyContent ?? ""} onChange={(event) => updateValue("bodyContent", event.target.value || null)} className={textareaClass} />
        <InlineError id="form-body-content-error" message={errors.bodyContent} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-slate-700">
        注意事項
        <textarea name="notice" rows={3} maxLength={1_000} value={values.notice ?? ""} onChange={(event) => updateValue("notice", event.target.value || null)} className={textareaClass} />
        <InlineError id="form-notice-error" message={errors.notice} />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          SEO 標題
          <input name="seoTitle" maxLength={200} value={values.seoTitle ?? ""} onChange={(event) => updateValue("seoTitle", event.target.value || null)} className={inputClass} />
          <InlineError id="form-seo-title-error" message={errors.seoTitle} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          SEO 說明
          <textarea name="seoDescription" rows={3} maxLength={500} value={values.seoDescription ?? ""} onChange={(event) => updateValue("seoDescription", event.target.value || null)} className={textareaClass} />
          <InlineError id="form-seo-description-error" message={errors.seoDescription} />
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          最多顯示場次
          <input name="maxVisibleSessions" type="number" min={0} max={99} step={1} value={values.maxVisibleSessions} onChange={(event) => updateValue("maxVisibleSessions", event.target.value === "" ? 0 : Number(event.target.value))} className={inputClass} />
          <span className="text-xs font-normal text-slate-500">0 代表不限制。</span>
          <InlineError id="form-max-visible-sessions-error" message={errors.maxVisibleSessions} />
        </label>
        <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700">
          <input name="hideExpiredSessions" type="checkbox" checked={values.hideExpiredSessions} onChange={(event) => updateValue("hideExpiredSessions", event.target.checked)} className="h-4 w-4 accent-blue-600" />
          隱藏已過期場次
        </label>
      </div>
    </div>
  );
}

export function FormBuilderClient({
  values: initialValues,
  initialFields,
  legacyFieldsInvalid,
  legacyRouteError,
  draftScope,
  initialUpdatedAt,
  csrfField,
  promoVideos,
}: {
  values: FormBuilderValues;
  initialFields: RegistrationFormBuilderField[];
  legacyFieldsInvalid: boolean;
  legacyRouteError?: string;
  draftScope: string;
  initialUpdatedAt: string | null;
  csrfField: ReactNode;
  promoVideos: FormPromoVideoOption[];
}) {
  const initialActionState: FormBuilderActionState = legacyRouteError === "invalid_fields"
    ? { status: "error", message: "先前的欄位設定無法儲存；請確認下方欄位後再試一次。" }
    : { status: "idle", message: "" };
  const [actionState, formAction, pending] = useActionState(upsertFormBuilderAction, initialActionState);
  const [values, setValues] = useState(initialValues);
  const [fields, setFields] = useState(initialFields);
  const [fieldType, setFieldType] = useState<RegistrationFormBuilderFieldType>("text");
  const [legacyNeedsReset, setLegacyNeedsReset] = useState(legacyFieldsInvalid);
  const [removed, setRemoved] = useState<RemovedField | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [heroMediaBlocked, setHeroMediaBlocked] = useState(false);
  const [backgroundMediaBlocked, setBackgroundMediaBlocked] = useState(false);
  const [mediaHydrationKey, setMediaHydrationKey] = useState(0);
  const mediaBlockingRef = useRef({ hero: false, background: false });
  const errors = actionState.fieldErrors ?? {};
  const controlsDisabled = pending || legacyNeedsReset;
  const mediaBlocked = heroMediaBlocked || backgroundMediaBlocked;
  const draft = useRegistrationFormDraft({
    draftScope,
    initialUpdatedAt,
    initialValues,
    initialFields,
    values,
    fields,
    pending,
    onRestore: (restored) => {
      setValues(normalizeFormBuilderValues(restored.values));
      setFields(restored.fields);
      setMediaHydrationKey((current) => current + 1);
      setRemoved(null);
      setAnnouncement("已恢復尚未儲存的表單草稿。");
    },
  });

  function updateValue<Key extends keyof FormBuilderValues>(key: Key, value: FormBuilderValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const onHeroBlockingChange = useCallback((blocked: boolean) => {
    mediaBlockingRef.current.hero = blocked;
    setHeroMediaBlocked(blocked);
  }, []);

  const onBackgroundBlockingChange = useCallback((blocked: boolean) => {
    mediaBlockingRef.current.background = blocked;
    setBackgroundMediaBlocked(blocked);
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (mediaBlockingRef.current.hero || mediaBlockingRef.current.background) {
      event.preventDefault();
      setAnnouncement("請先完成圖片上傳，或移除尚未上傳的檔案。");
      return;
    }
    draft.clearForSubmission();
  }

  function addField() {
    if (fields.length >= 32) return;
    const field = createRegistrationFormField(fields, fieldType);
    setFields((current) => [...current, field]);
    setRemoved(null);
    setAnnouncement(`已新增${registrationFormFieldTypeLabel(fieldType)}欄位。`);
  }

  function removeField(index: number) {
    const field = fields[index];
    if (!field) return;
    setFields((current) => current.filter((_, position) => position !== index));
    setRemoved({ field, index });
    setAnnouncement(`已移除「${field.label}」，可使用復原按鈕還原。`);
  }

  function undoRemove() {
    if (!removed) return;
    setFields((current) => {
      const next = [...current];
      next.splice(Math.min(removed.index, next.length), 0, removed.field);
      return next;
    });
    setAnnouncement(`已復原「${removed.field.label}」。`);
    setRemoved(null);
  }

  function moveField(index: number, direction: -1 | 1) {
    const field = fields[index];
    if (!field) return;
    setFields((current) => moveRegistrationFormField(current, index, direction));
    setAnnouncement(`已將「${field.label}」${direction === -1 ? "上移" : "下移"}。`);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} aria-busy={pending} className="grid gap-6">
      {csrfField}
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      {values.id && initialUpdatedAt ? <input type="hidden" name="expectedUpdatedAt" value={initialUpdatedAt} /> : null}
      <input type="hidden" name="fields" value={JSON.stringify(fields)} />

      <ol className="grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-4" aria-label="表單建立流程">
        {[
          ["1", "基本資料"], ["2", "報名欄位"], ["3", "送出回饋"], ["4", "預覽儲存"],
        ].map(([step, label]) => <li key={step} className="rounded-md bg-slate-100 px-3 py-2"><span className="mr-1 text-primary">{step}.</span>{label}</li>)}
      </ol>

      {actionState.status === "error" ? (
        <p role="alert" aria-live="assertive" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionState.message}
        </p>
      ) : null}

      <FormDraftRecovery draft={draft} />

      {legacyNeedsReset ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">既有欄位規格無法安全解析，儲存已停用。</p>
          <p className="mt-1 leading-6">為避免默默覆寫舊資料，請明確重建成安全預設欄位，再逐一調整。</p>
          <button
            type="button"
            onClick={() => {
              setFields(defaultRegistrationFormBuilderFields());
              setLegacyNeedsReset(false);
              setAnnouncement("已重建安全預設欄位，請確認後再儲存。");
            }}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-amber-400 bg-white px-4 font-semibold"
          >
            <RotateCcw size={16} aria-hidden="true" />重建安全欄位
          </button>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)] xl:items-start">
        <div className="grid min-w-0 gap-6">
          <section aria-labelledby="form-basics-title" className="rounded-lg border border-slate-200 p-4 sm:p-5">
            <h2 id="form-basics-title" className="text-lg font-semibold text-slate-950">1. 基本資料</h2>
            <p className="mt-1 text-sm text-slate-600">先設定內部名稱與填寫者會看到的標題。</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                表單名稱
                <input name="name" required maxLength={120} value={values.name} onChange={(event) => updateValue("name", event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "form-name-error" : undefined} className={inputClass} />
                <InlineError id="form-name-error" message={errors.name} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                公開網址
                <div className="flex min-w-0 items-center rounded-md border border-slate-200 bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-blue-100">
                  <span className="shrink-0 pl-3 text-sm text-slate-500">/form/</span>
                  <input name="slug" required maxLength={80} value={values.slug} onChange={(event) => updateValue("slug", event.target.value)} aria-invalid={Boolean(errors.slug)} aria-describedby={errors.slug ? "form-slug-error" : "form-slug-help"} className="h-11 min-w-0 flex-1 rounded-r-md px-1 pr-3 text-sm outline-none" />
                </div>
                <span id="form-slug-help" className="text-xs font-normal text-slate-500">儲存時會自動整理成可分享的網址。</span>
                <InlineError id="form-slug-error" message={errors.slug} />
              </label>
            </div>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                公開標題
                <input name="headline" required maxLength={200} value={values.headline} onChange={(event) => updateValue("headline", event.target.value)} aria-invalid={Boolean(errors.headline)} aria-describedby={errors.headline ? "form-headline-error" : undefined} className={inputClass} />
                <InlineError id="form-headline-error" message={errors.headline} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                說明文字
                <textarea name="description" rows={4} maxLength={5_000} value={values.description} onChange={(event) => updateValue("description", event.target.value)} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "form-description-error" : undefined} className={textareaClass} />
                <InlineError id="form-description-error" message={errors.description} />
              </label>
            </div>
            <FormBuilderMediaSettings
              values={values}
              errors={errors}
              hydrationKey={mediaHydrationKey}
              promoVideos={promoVideos}
              updateValue={updateValue}
              onHeroBlockingChange={onHeroBlockingChange}
              onBackgroundBlockingChange={onBackgroundBlockingChange}
            />
            <FormBuilderPublicSettings values={values} errors={errors} updateValue={updateValue} />
          </section>

          <section aria-labelledby="form-fields-title" className="rounded-lg border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="form-fields-title" className="text-lg font-semibold text-slate-950">2. 報名欄位</h2>
                <p className="mt-1 text-sm text-slate-600">直接編輯名稱、類型與必填狀態；姓名和 Email 會受到保護。</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">{fields.length} / 32 欄</span>
            </div>
            {errors.fields ? <p id="form-fields-error" role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{errors.fields}</p> : null}
            <div className="mt-4">
              <FormFieldEditor
                fields={fields}
                disabled={controlsDisabled}
                onChange={(index, field) => setFields((current) => current.map((item, position) => position === index ? field : item))}
                onMove={moveField}
                onRemove={removeField}
              />
            </div>
            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-dashed border-blue-300 bg-blue-50 p-3 sm:flex-row sm:items-end">
              <label className="grid flex-1 gap-1 text-sm font-medium text-blue-950">
                新欄位類型
                <select value={fieldType} disabled={controlsDisabled || fields.length >= 32} onChange={(event) => setFieldType(event.target.value as RegistrationFormBuilderFieldType)} className="h-11 rounded-md border border-blue-200 bg-white px-3 text-sm">
                  {REGISTRATION_FORM_FIELD_TYPES.map((type) => <option key={type} value={type}>{registrationFormFieldTypeLabel(type)}</option>)}
                </select>
              </label>
              <button type="button" disabled={controlsDisabled || fields.length >= 32} onClick={addField} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                <Plus size={16} aria-hidden="true" />新增欄位
              </button>
            </div>
            {removed ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-slate-900 px-3 py-2 text-sm text-white">
                <span>已移除「{removed.field.label}」</span>
                <button type="button" onClick={undoRemove} className="min-h-11 rounded-md bg-white px-3 font-semibold text-slate-900">復原</button>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="form-feedback-title" className="rounded-lg border border-slate-200 p-4 sm:p-5">
            <h2 id="form-feedback-title" className="text-lg font-semibold text-slate-950">3. 送出回饋</h2>
            <p className="mt-1 text-sm text-slate-600">讓填寫者知道按鈕用途，以及資料確實送出成功。</p>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                送出按鈕文字
                <input name="submitLabel" required maxLength={80} value={values.submitLabel} onChange={(event) => updateValue("submitLabel", event.target.value)} aria-invalid={Boolean(errors.submitLabel)} aria-describedby={errors.submitLabel ? "form-submit-label-error" : undefined} className={inputClass} />
                <InlineError id="form-submit-label-error" message={errors.submitLabel} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                成功訊息
                <textarea name="successMessage" required rows={3} maxLength={500} value={values.successMessage} onChange={(event) => updateValue("successMessage", event.target.value)} aria-invalid={Boolean(errors.successMessage)} aria-describedby={errors.successMessage ? "form-success-message-error" : undefined} className={textareaClass} />
                <InlineError id="form-success-message-error" message={errors.successMessage} />
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700">
                <input name="isActive" type="checkbox" checked={values.isActive} onChange={(event) => updateValue("isActive", event.target.checked)} className="h-4 w-4 accent-blue-600" />
                啟用表單，允許接收新名單
              </label>
            </div>
          </section>
        </div>

        <FormPreview
          headline={values.headline}
          description={values.description}
          submitLabel={values.submitLabel}
          fields={fields}
          isActive={values.isActive}
          themeColor={values.themeColor}
          stickyText={values.stickyText}
          bodyContent={values.bodyContent}
          notice={values.notice}
          countdownMinutes={values.countdownMinutes}
          maxVisibleSessions={values.maxVisibleSessions}
          hideExpiredSessions={values.hideExpiredSessions}
        />
      </div>

      <p role="status" aria-live="polite" className="sr-only">{announcement}{pending ? "正在儲存表單，請勿重複送出。" : ""}</p>
      {mediaBlocked ? <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">請先完成圖片上傳，或移除尚未上傳的檔案。</p> : null}
      {errors.root ? <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{errors.root}</p> : null}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="text-xs text-slate-500">
          <p>儲存前可在右側預覽；伺服器會再次驗證所有欄位。</p>
          <p role="status" aria-live="polite" className="mt-1 font-medium text-slate-700">
            {formDraftStatusMessage(draft.saveStatus)}
          </p>
        </div>
        <button type="submit" disabled={pending || legacyNeedsReset || mediaBlocked} aria-disabled={pending || legacyNeedsReset || mediaBlocked} aria-busy={pending} className="inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          <Save size={16} aria-hidden="true" />{pending ? "儲存中…" : "儲存表單"}
        </button>
      </div>
    </form>
  );
}
