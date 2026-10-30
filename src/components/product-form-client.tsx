"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { upsertProductAction } from "@/app/actions/product-server-actions";
import { MediaUploadField } from "@/components/media-upload-field";
import { Field, SelectField, SubmitButton, TextArea } from "@/components/ui";
import {
  initialProductActionState,
  type ProductActionError,
  type ProductActionState,
  type ProductFieldErrors,
  type ProductFormDraft,
} from "@/lib/product-action-state";
import type { CustomCheckoutField, CustomCheckoutFields } from "@/lib/commerce-custom-checkout";
import { SUPPORTED_CHECKOUT_CURRENCY } from "@/lib/checkout-currency";
import { formatCurrency } from "@/lib/format";

export type ProductFormProduct = {
  id: string;
  revision: number;
  name: string;
  slug: string;
  description: string | null;
  priceCents: number;
  compareAtCents: number | null;
  currency: string;
  imageUrl: string | null;
  imageAssetId: string | null;
  checkoutUrl: string | null;
  customCheckoutFields?: CustomCheckoutFields;
  inventory: number;
  isActive: boolean;
  commerceDomain: string;
  fulfillmentType: "physical" | "digital" | "service" | "course";
  fulfillmentTypeConfirmed: boolean;
  courseContentOwnerMembershipId: string | null;
  coursePromoterShareBps: number | null;
  deliveryTitle: string;
  deliveryUrl: string;
  deliveryInstructions: string;
  deliveryHostConfirmed: boolean;
  upsellProductId?: string | null;
  downsellProductId?: string | null;
  upsellDiscountCents?: number;
};

export type PostPurchaseProductOption = { id: string; name: string; priceCents: number; currency: string };

export type CourseMembershipOption = {
  id: string;
  teamName: string;
  memberName: string;
};

function centsToMajor(value: number | null) {
  if (value === null) return "";
  return (value / 100).toFixed(2).replace(/\.00$/u, "");
}

function initialDraft(product?: ProductFormProduct): ProductFormDraft {
  if (!product) {
    return {
      name: "", slug: "", description: "", price: "0", compareAt: "", currency: "TWD", inventory: "0",
      fulfillmentType: "physical", courseContentOwnerMembershipId: "", coursePromoterShareBps: "",
      deliveryTitle: "", deliveryUrl: "", deliveryInstructions: "", deliveryHostConfirmed: false,
      imageUrl: "", imageAssetId: "", checkoutUrl: "", isActive: false,
      customCheckoutFields: [],
      upsellProductId: "", downsellProductId: "", upsellDiscount: "0",
    };
  }
  return {
    name: product.name,
    slug: product.slug,
    description: product.description ?? "",
    price: centsToMajor(product.priceCents),
    compareAt: centsToMajor(product.compareAtCents),
    currency: product.currency,
    inventory: String(product.inventory),
    fulfillmentType: product.fulfillmentType,
    courseContentOwnerMembershipId: product.courseContentOwnerMembershipId ?? "",
    coursePromoterShareBps: product.coursePromoterShareBps === null
      ? ""
      : String(product.coursePromoterShareBps),
    deliveryTitle: product.deliveryTitle,
    deliveryUrl: product.deliveryUrl,
    deliveryInstructions: product.deliveryInstructions,
    deliveryHostConfirmed: product.deliveryHostConfirmed,
    imageUrl: product.imageUrl ?? "",
    imageAssetId: product.imageAssetId ?? "",
    checkoutUrl: product.checkoutUrl ?? "",
    isActive: product.isActive,
    customCheckoutFields: product.customCheckoutFields ?? [],
    upsellProductId: product.upsellProductId ?? "",
    downsellProductId: product.downsellProductId ?? "",
    upsellDiscount: centsToMajor(product.upsellDiscountCents ?? 0),
  };
}

function errorMessage(error: ProductActionError | undefined) {
  if (error === "invalid_product") return "商品名稱、網址、售價、庫存或網址格式不正確（售價須為整數新台幣元），請修正後再儲存。";
  if (error === "unsupported_currency") return "平台目前只支援新台幣（TWD）。既有的非新台幣商品，請確認售價已改以新台幣填寫並勾選確認後再儲存。";
  if (error === "invalid_image_asset") return "商品圖片不是目前商家的已完成資產，請重新上傳或移除。";
  if (error === "invalid_course_policy") return "課程商品需要有效的內容所有人與推廣者分潤比例。";
  if (error === "course_feature_disabled") return "課程功能目前尚未開放，無法建立或修改課程商品。";
  if (error === "invalid_course_owner") return "課程內容所有人必須是目前商家內有效的團隊成員。";
  if (error === "invalid_fulfillment") return "商品交付方式與課程設定不一致，請重新選擇。";
  if (error === "invalid_delivery") return "交付設定不完整或網址不安全。上架前請填妥標題、必要的 HTTPS 入口或服務說明，並確認交付網域。";
  if (error === "invalid_custom_checkout_fields") return "自訂結帳欄位格式不正確；請確認欄位 key、標題與選項後再儲存。";
  if (error === "media_upload_incomplete") return "圖片尚未完成上傳，請先完成、重試或移除檔案。";
  if (error === "duplicate_slug") return "這個網址已被目前商家的另一個商品使用，請更換後再儲存。";
  if (error === "conflict") return "商品在你編輯期間已被更新（可能包含新訂單扣庫存）。請重新整理確認最新資料後再修改。";
  if (error === "not_found") return "找不到這個商品，或你沒有權限修改。";
  if (error === "unavailable") return "商品暫時無法儲存，請稍後再試一次。";
  return null;
}

const PRODUCT_ACTION_ERRORS = new Set<ProductActionError>([
  "invalid_product", "unsupported_currency", "invalid_image_asset", "invalid_course_policy", "course_feature_disabled", "invalid_course_owner",
  "invalid_fulfillment", "invalid_delivery", "invalid_custom_checkout_fields",
  "media_upload_incomplete", "duplicate_slug", "conflict", "not_found", "unavailable",
]);

function safeProductError(value: unknown): ProductActionError {
  return typeof value === "string" && PRODUCT_ACTION_ERRORS.has(value as ProductActionError)
    ? value as ProductActionError
    : "unavailable";
}

/** F-117: after a failed submit, move focus to the first invalid control. */
function useFocusFirstInvalid(formRef: { current: HTMLFormElement | null }, errorToken: string) {
  useEffect(() => {
    if (errorToken === "0:0") return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errorToken, formRef]);
}

function ProductErrorSummary({ message, fieldErrors }: { message: string | null; fieldErrors: ProductFieldErrors }) {
  if (!message) return null;
  const entries = Object.entries(fieldErrors).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <div role="alert" className="grid gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
      <p>{message}</p>
      {entries.length > 0 ? (
        <ul className="list-disc pl-5 font-normal">
          {entries.map(([name, text]) => <li key={name}>{text}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function pickFieldErrors(nativeError: ProductActionError | undefined, nativeErrors: ProductFieldErrors | undefined, actionErrors: ProductFieldErrors | undefined): ProductFieldErrors {
  return (nativeError ? nativeErrors : actionErrors) ?? {};
}

function safeFieldErrors(value: unknown): ProductFieldErrors {
  if (typeof value !== "object" || value === null) return {};
  const result: Record<string, string> = {};
  for (const [key, message] of Object.entries(value)) {
    if (typeof message === "string" && message.length <= 300) result[key] = message;
  }
  return result;
}

function nextFieldKey(fields: CustomCheckoutFields) {
  let index = fields.length + 1;
  while (fields.some((field) => field.key === `field_${index}`)) index += 1;
  return `field_${index}`;
}

function CustomCheckoutFieldEditor({
  fields,
  onChange,
}: {
  fields: CustomCheckoutFields;
  onChange: (fields: CustomCheckoutFields) => void;
}) {
  function update(index: number, patch: Partial<CustomCheckoutField>) {
    onChange(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } as CustomCheckoutField : field));
  }

  function changeType(index: number, type: CustomCheckoutField["type"]) {
    const field = fields[index];
    if (!field) return;
    if (type === "select") {
      update(index, { type, options: field.type === "select" ? field.options : ["選項一", "選項二"] });
      return;
    }
    if (type === "checkbox") {
      onChange(fields.map((current, currentIndex) => currentIndex === index
        ? { key: current.key, label: current.label, type, required: true }
        : current));
      return;
    }
    onChange(fields.map((current, currentIndex) => currentIndex === index
      ? { key: current.key, label: current.label, type, required: current.required }
      : current));
  }

  function move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= fields.length) return;
    const next = [...fields];
    const [field] = next.splice(index, 1);
    if (!field) return;
    next.splice(destination, 0, field);
    onChange(next);
  }

  return (
    <fieldset className="grid gap-4 rounded-md border border-violet-200 bg-violet-50/50 p-4">
      <legend className="px-1 text-sm font-semibold text-violet-950">商品自訂結帳欄位</legend>
      <p className="text-sm leading-6 text-violet-950">例如刻字內容、尺寸或確認事項。買家答案會加密保存，商品設定最多十欄。</p>
      <input type="hidden" name="customCheckoutFields" value={JSON.stringify(fields)} />
      {fields.map((field, index) => (
        <div key={field.key} className="grid gap-3 rounded-md border border-violet-200 bg-white p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
            <label className="grid gap-1 text-sm font-medium text-slate-800">欄位標題
              <input value={field.label} maxLength={100} onChange={(event) => update(index, { label: event.target.value })} className="rounded-md border border-slate-500 px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-800">輸入類型
              <select value={field.type} onChange={(event) => changeType(index, event.target.value as CustomCheckoutField["type"])} className="rounded-md border border-slate-500 px-3 py-2">
                <option value="text">短文字</option><option value="textarea">長文字</option><option value="select">下拉選單</option><option value="checkbox">確認勾選</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="rounded-md border px-2 py-2 text-sm disabled:opacity-40" aria-label={`上移 ${field.label}`}>↑</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === fields.length - 1} className="rounded-md border px-2 py-2 text-sm disabled:opacity-40" aria-label={`下移 ${field.label}`}>↓</button>
              <button type="button" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))} className="rounded-md border border-red-200 px-2 py-2 text-sm text-red-700">刪除</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
            <span className="font-mono text-xs text-slate-500">固定 key：{field.key}</span>
            {field.type === "checkbox" ? <span>確認勾選一律為必填。</span> : (
              <label className="flex items-center gap-2"><input type="checkbox" checked={field.required} onChange={(event) => update(index, { required: event.target.checked })} />必填</label>
            )}
          </div>
          {field.type === "select" ? (
            <div className="grid gap-2">
              <p className="text-sm font-medium text-slate-800">選項（2–20 個，不可重複）</p>
              {field.options.map((value, optionIndex) => (
                <div key={`${field.key}-${optionIndex}`} className="flex gap-2">
                  <input value={value} maxLength={100} onChange={(event) => update(index, { options: field.options.map((option, currentIndex) => currentIndex === optionIndex ? event.target.value : option) })} className="min-w-0 flex-1 rounded-md border border-slate-500 px-3 py-2" />
                  <button type="button" disabled={field.options.length <= 2} onClick={() => update(index, { options: field.options.filter((_, currentIndex) => currentIndex !== optionIndex) })} className="rounded-md border px-2 text-sm disabled:opacity-40">移除</button>
                </div>
              ))}
              <button type="button" disabled={field.options.length >= 20} onClick={() => update(index, { options: [...field.options, `選項 ${field.options.length + 1}`] })} className="w-fit rounded-md border border-violet-300 px-3 py-2 text-sm text-violet-800 disabled:opacity-40">新增選項</button>
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        disabled={fields.length >= 10}
        onClick={() => onChange([...fields, { key: nextFieldKey(fields), label: `自訂欄位 ${fields.length + 1}`, type: "text", required: false }])}
        className="w-fit rounded-md border border-violet-300 px-3 py-2 text-sm font-medium text-violet-800 disabled:opacity-40"
      >新增結帳欄位</button>
    </fieldset>
  );
}

function CourseSplitFields({ visible, draft, memberships, fieldErrors }: {
  fieldErrors: ProductFieldErrors;
  visible: boolean;
  draft: { courseContentOwnerMembershipId: string; coursePromoterShareBps: string };
  memberships: CourseMembershipOption[];
}) {
  // 課程分潤欄位只在選擇「課程」時出現，一般商品不需要看到。
  if (!visible) return null;
  return (
    <>
      <SelectField label="課程內容所有人" name="courseContentOwnerMembershipId" error={fieldErrors.courseContentOwnerMembershipId} defaultValue={draft.courseContentOwnerMembershipId}>
        <option value="">一般商品／直購不指定</option>
        {memberships.map((membership) => <option key={membership.id} value={membership.id}>{membership.memberName} · {membership.teamName}</option>)}
      </SelectField>
      <Field label="課程推廣者分潤比例（萬分比）" name="coursePromoterShareBps" error={fieldErrors.coursePromoterShareBps} type="number" min={1} max={9999} defaultValue={draft.coursePromoterShareBps} placeholder="例如 2000 = 20%" />
      <p className="self-end text-xs leading-5 text-slate-600">付款成功會鎖定分潤比例與收款人；沒有推廣者歸因時，款項全數給課程內容所有人。</p>
    </>
  );
}

export function ProductFormClient({
  csrfToken,
  projectId,
  product,
  memberships = [],
  offerProducts = [],
  initialError,
  nativeAction = "/api/products/upsert",
}: {
  csrfToken: string;
  projectId?: string | null;
  product?: ProductFormProduct;
  memberships?: CourseMembershipOption[];
  offerProducts?: PostPurchaseProductOption[];
  initialError?: ProductActionError;
  nativeAction?: string;
}) {
  const initialState: ProductActionState = initialError
    ? { ...initialProductActionState, error: initialError }
    : initialProductActionState;
  const [state, formAction, pending] = useActionState(upsertProductAction, initialState);
  const [nativeError, setNativeError] = useState<ProductActionError>();
  const [nativeFieldErrors, setNativeFieldErrors] = useState<ProductFieldErrors>();
  const [nativeErrorTick, setNativeErrorTick] = useState(0);
  const [nativePending, setNativePending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [mediaBlocked, setMediaBlocked] = useState(false);
  const draft = state.draft ?? initialDraft(product);
  const legacyCurrency = product && product.currency !== SUPPORTED_CHECKOUT_CURRENCY ? product.currency : null;
  const [selectedFulfillmentType, setSelectedFulfillmentType] = useState(draft.fulfillmentType);
  const [customCheckoutFields, setCustomCheckoutFields] = useState<CustomCheckoutFields>(draft.customCheckoutFields ?? []);
  const error = errorMessage(nativeError ?? state.error);
  const fieldErrors = pickFieldErrors(nativeError, nativeFieldErrors, state.fieldErrors);
  const errorToken = `${state.version}:${nativeErrorTick}`;

  useFocusFirstInvalid(formRef, errorToken);

  async function submitNatively(event: FormEvent<HTMLFormElement>) {
    if (!nativeAction) return;
    event.preventDefault();
    if (nativePending || pending) return;
    setNativePending(true);
    setNativeError(undefined);
    setNativeFieldErrors(undefined);
    try {
      const submitted = new FormData(event.currentTarget);
      const response = await fetch(nativeAction, {
        method: "POST",
        body: submitted,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "manual",
      });
      if (response.type === "opaqueredirect" || response.status === 303) {
        const destination = submitted.get("id")
          ? "/products?updated=saved"
          : "/products?updated=created";
        window.location.assign(new URL(destination, window.location.origin).href);
        return;
      }
      if (response.redirected) {
        const destination = new URL(response.url, window.location.origin);
        if (destination.origin === window.location.origin && destination.pathname === "/products") {
          window.location.assign(destination.href);
          return;
        }
      }
      const payload: unknown = await response.json().catch(() => null);
      const value = typeof payload === "object" && payload !== null && "error" in payload
        ? (payload as { error?: unknown }).error
        : undefined;
      const rawFieldErrors = typeof payload === "object" && payload !== null && "fieldErrors" in payload
        ? (payload as { fieldErrors?: unknown }).fieldErrors
        : undefined;
      setNativeFieldErrors(safeFieldErrors(rawFieldErrors));
      setNativeError(safeProductError(value));
      setNativeErrorTick((tick) => tick + 1);
    } catch {
      setNativeError("unavailable");
    } finally {
      setNativePending(false);
    }
  }

  return (
    <form ref={formRef} key={state.version} action={formAction} onSubmit={submitNatively} className="grid gap-4" aria-busy={pending || nativePending}>
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
      <input type="hidden" name="_csrf" value={csrfToken} />
      {product ? <><input type="hidden" name="id" value={product.id} /><input type="hidden" name="revision" value={product.revision} /></> : null}
      <ProductErrorSummary message={error} fieldErrors={fieldErrors} />
      {product && !product.fulfillmentTypeConfirmed ? (
        <p role="status" className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-900">
          這是既有商品，交付方式尚未確認。請選擇正確類型並儲存；確認前不會開放結帳或綁定新的販售流程。
        </p>
      ) : null}
      {legacyCurrency ? (
        <div role="status" className="grid gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">
          <p className="font-medium">這個商品原本設定為 {legacyCurrency}，平台只支援新台幣（TWD），儲存後會改為新台幣，售價不會自動換匯。</p>
          <label className="flex items-start gap-2">
            <input name="confirmTwdCurrency" type="checkbox" required className="mt-0.5 h-4 w-4 accent-orange-600" />
            <span>我已確認售價與原價都已改以新台幣元填寫。</span>
          </label>
        </div>
      ) : null}
      {!product ? <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">新商品會先儲存為草稿；確認預覽、價格、庫存與交付方式後，再勾選上架。</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="商品名稱" name="name" error={fieldErrors.name} required maxLength={200} defaultValue={draft.name} />
        <Field label="商品網址" name="slug" error={fieldErrors.slug} required maxLength={200} defaultValue={draft.slug} />
        <Field label="售價（元）" name="price" error={fieldErrors.price} type="number" min={0} step={1} required defaultValue={draft.price} />
        <Field label="原價（元）" name="compareAt" error={fieldErrors.compareAt} type="number" min={0.01} step={0.01} defaultValue={draft.compareAt} />
        <div className="grid gap-1 text-sm font-medium text-slate-700">
          <span>幣別</span>
          <input type="hidden" name="currency" value={SUPPORTED_CHECKOUT_CURRENCY} />
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-900">新台幣（TWD）</p>
          <span className="text-xs font-normal text-slate-500">平台結帳、退款與月結目前只支援新台幣，售價須為整數元。</span>
        </div>
        <Field label="可售庫存" name="inventory" error={fieldErrors.inventory} type="number" min={0} step={1} required defaultValue={draft.inventory} />
      </div>
      <div className="grid gap-4 rounded-md border border-blue-100 bg-blue-50/50 p-4 md:grid-cols-2">
        <SelectField
          label="交付方式"
          name="fulfillmentType"
          value={selectedFulfillmentType}
          onChange={(event) => setSelectedFulfillmentType(event.target.value)}
        >
          <option value="physical">實體商品（需要收件地址與出貨）</option>
          <option value="digital">數位內容（付款後建立授權）</option>
          <option value="service">服務（付款後安排時間）</option>
          <option value="course">課程（付款後授權並啟用課程分潤）</option>
        </SelectField>
        <CourseSplitFields visible={selectedFulfillmentType === "course"} draft={draft} memberships={memberships} fieldErrors={fieldErrors} />
      </div>
      {selectedFulfillmentType !== "physical" ? (
        <fieldset className="grid gap-4 rounded-md border border-emerald-200 bg-emerald-50/50 p-4">
          <legend className="px-1 text-sm font-semibold text-emerald-950">付款後交付設定</legend>
          <p className="text-sm leading-6 text-emerald-950">
            這些內容會在買家付款後依訂單保存。商品之後改網址或說明，不會改寫已成立訂單。
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="買家看到的交付標題"
              name="deliveryTitle" error={fieldErrors.deliveryTitle}
              maxLength={120}
              defaultValue={draft.deliveryTitle}
              placeholder={selectedFulfillmentType === "service" ? "例如：一對一諮詢安排" : selectedFulfillmentType === "course" ? "例如：課程內容入口" : "例如：教材下載"}
            />
            <Field
              label={selectedFulfillmentType === "service" ? "會議／服務入口（選填）" : "付款後入口 URL"}
              name="deliveryUrl" error={fieldErrors.deliveryUrl}
              type="url"
              maxLength={2_048}
              defaultValue={draft.deliveryUrl}
              placeholder="https://..."
            />
          </div>
          <TextArea
            label={selectedFulfillmentType === "service" ? "服務安排與準備說明" : "付款後說明（選填）"}
            name="deliveryInstructions" error={fieldErrors.deliveryInstructions}
            maxLength={4_000}
            defaultValue={draft.deliveryInstructions}
            placeholder={selectedFulfillmentType === "service" ? "說明預約方式、服務前準備與聯絡流程。" : "說明如何開始使用內容；請勿貼上 API secret 或內部憑證。"}
          />
          <label className="flex items-start gap-2 text-sm font-medium text-emerald-950">
            <input
              name="deliveryHostConfirmed"
              type="checkbox"
              defaultChecked={draft.deliveryHostConfirmed}
              className="mt-0.5 h-4 w-4 accent-emerald-700"
            />
            <span>
              我確認這是商家授權的公開 HTTPS 交付網域
              <span className="mt-1 block text-xs font-normal leading-5 text-emerald-900">
                系統拒絕 localhost、IP、內網網址、帳密、query 與 fragment；網址會加密保存，公開頁只顯示安全摘要。
              </span>
            </span>
          </label>
          {!draft.isActive ? <p role="status" className="text-xs leading-5 text-slate-700">草稿可先保存未完成設定；勾選上架前必須補齊必要交付內容。</p> : null}
        </fieldset>
      ) : null}
      <CustomCheckoutFieldEditor fields={customCheckoutFields} onChange={setCustomCheckoutFields} />
      <fieldset className="grid gap-4 rounded-md border border-slate-200 p-4 md:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">購買後加購</legend>
        <p className="text-sm leading-6 text-slate-600 md:col-span-2">買家付款後可用原訂單實付金額折抵一次升級。拒絕加購時可改選備選商品；原訂單退款會撤銷升級權益。</p>
        <SelectField label="加購商品" name="upsellProductId" defaultValue={draft.upsellProductId ?? ""}>
          <option value="">不提供加購</option>
          {offerProducts.filter(option => option.id !== product?.id).map(option => <option key={option.id} value={option.id}>{option.name} · {formatCurrency(option.priceCents, option.currency)}</option>)}
        </SelectField>
        <Field label="加購額外折扣（元）" name="upsellDiscount" type="number" min={0} step={0.01} defaultValue={draft.upsellDiscount ?? "0"} />
        <SelectField label="拒絕加購後的備選商品" name="downsellProductId" defaultValue={draft.downsellProductId ?? ""}>
          <option value="">不提供備選商品</option>
          {offerProducts.filter(option => option.id !== product?.id).map(option => <option key={option.id} value={option.id}>{option.name} · {formatCurrency(option.priceCents, option.currency)}</option>)}
        </SelectField>
        <p className="self-end text-xs leading-5 text-slate-600">限同商家、同幣別且使用本站結帳的已上架商品；折抵後應付金額必須大於零。</p>
      </fieldset>
      <TextArea label="商品描述" name="description" error={fieldErrors.description} maxLength={10_000} defaultValue={draft.description} />
      <MediaUploadField
        kind="image"
        label="商品圖片"
        description="直接拖拉或選擇商品主圖；上傳成功後會立即預覽，儲存商品時才正式套用。"
        defaultUrl={draft.imageUrl}
        defaultAssetId={draft.imageAssetId}
        urlInputName="imageUrl"
        assetIdInputName="imageAssetId"
        statusInputName="imageUploadPhase"
        onBlockingChange={setMediaBlocked}
      />
      <div className="grid gap-2">
        <Field label="外部結帳 URL（選填／進階）" name="checkoutUrl" error={fieldErrors.checkoutUrl} defaultValue={draft.checkoutUrl} placeholder="https://..." />
        <p className="text-xs leading-5 text-orange-800">使用外部結帳會離開 CelebrateDeal，平台無法保證取得本地訂單、付款、退款與分潤閉環證據。需要完整交易追蹤時請留空。</p>
      </div>
      <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
        <input name="isActive" type="checkbox" defaultChecked={draft.isActive} className="mt-0.5 h-4 w-4 accent-blue-600" />
        <span>上架商品<span className="mt-1 block text-xs font-normal text-slate-500">勾選後，符合價格、庫存與交付條件的商品可進入販售流程。</span></span>
      </label>
      {mediaBlocked ? <p role="status" className="text-sm font-medium text-orange-800">請先完成圖片上傳，或移除尚未上傳的檔案。</p> : null}
      <SubmitButton disabled={mediaBlocked || nativePending} />
    </form>
  );
}
