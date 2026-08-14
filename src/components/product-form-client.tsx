"use client";

import { useActionState, useState } from "react";
import { upsertProductAction } from "@/app/actions/product-actions";
import { MediaUploadField } from "@/components/media-upload-field";
import { Field, SelectField, SubmitButton, TextArea } from "@/components/ui";
import {
  initialProductActionState,
  type ProductActionError,
  type ProductActionState,
  type ProductFormDraft,
} from "@/lib/product-action-state";

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
};

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
  };
}

function errorMessage(error: ProductActionError | undefined) {
  if (error === "invalid_product") return "商品名稱、Slug、售價、庫存、幣別或網址格式不正確，請修正後再儲存。";
  if (error === "invalid_image_asset") return "商品圖片不是目前商家的已完成資產，請重新上傳或移除。";
  if (error === "invalid_course_policy") return "課程商品需要有效的內容所有人與推廣者分潤比例。";
  if (error === "invalid_course_owner") return "課程內容所有人必須是目前商家內有效的團隊成員。";
  if (error === "invalid_fulfillment") return "商品交付方式與課程設定不一致，請重新選擇。";
  if (error === "invalid_delivery") return "交付設定不完整或網址不安全。上架前請填妥標題、必要的 HTTPS 入口或服務說明，並確認交付網域。";
  if (error === "media_upload_incomplete") return "圖片尚未完成上傳，請先完成、重試或移除檔案。";
  if (error === "duplicate_slug") return "這個 Slug 已被目前商家的另一個商品使用，請更換後再儲存。";
  if (error === "conflict") return "商品在你編輯期間已被更新（可能包含新訂單扣庫存）。請重新整理確認最新資料後再修改。";
  if (error === "not_found") return "找不到這個商品，或你沒有權限修改。";
  return null;
}

export function ProductFormClient({
  csrfToken,
  product,
  memberships = [],
  initialError,
}: {
  csrfToken: string;
  product?: ProductFormProduct;
  memberships?: CourseMembershipOption[];
  initialError?: ProductActionError;
}) {
  const initialState: ProductActionState = initialError
    ? { ...initialProductActionState, error: initialError }
    : initialProductActionState;
  const [state, formAction, pending] = useActionState(upsertProductAction, initialState);
  const [mediaBlocked, setMediaBlocked] = useState(false);
  const draft = state.draft ?? initialDraft(product);
  const [selectedFulfillmentType, setSelectedFulfillmentType] = useState(draft.fulfillmentType);
  const error = errorMessage(state.error);

  return (
    <form key={state.version} action={formAction} className="grid gap-4" aria-busy={pending}>
      <input type="hidden" name="_csrf" value={csrfToken} />
      {product ? <><input type="hidden" name="id" value={product.id} /><input type="hidden" name="revision" value={product.revision} /></> : null}
      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
      {product && !product.fulfillmentTypeConfirmed ? (
        <p role="status" className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-medium text-orange-900">
          這是既有商品，交付方式尚未確認。請選擇正確類型並儲存；確認前不會開放結帳或綁定新的販售流程。
        </p>
      ) : null}
      {!product ? <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">新商品會先儲存為草稿；確認預覽、價格、庫存與交付方式後，再勾選上架。</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="商品名稱" name="name" required maxLength={200} defaultValue={draft.name} />
        <Field label="Slug" name="slug" required maxLength={200} defaultValue={draft.slug} />
        <Field label="售價（元）" name="price" type="number" min={0} step={0.01} required defaultValue={draft.price} />
        <Field label="原價（元）" name="compareAt" type="number" min={0.01} step={0.01} defaultValue={draft.compareAt} />
        <Field label="幣別（ISO 4217）" name="currency" minLength={3} maxLength={3} defaultValue={draft.currency} />
        <Field label="可售庫存" name="inventory" type="number" min={0} step={1} required defaultValue={draft.inventory} />
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
          <option value="course">課程（付款後授權並啟用 F/G 分潤）</option>
        </SelectField>
        <SelectField label="課程內容所有人 F" name="courseContentOwnerMembershipId" defaultValue={draft.courseContentOwnerMembershipId}>
          <option value="">一般商品／直購不指定</option>
          {memberships.map((membership) => <option key={membership.id} value={membership.id}>{membership.memberName} · {membership.teamName}</option>)}
        </SelectField>
        <Field label="課程推廣者 G 比例（basis points）" name="coursePromoterShareBps" type="number" min={1} max={9999} defaultValue={draft.coursePromoterShareBps} placeholder="例如 2000 = 20%" />
        <p className="self-end text-xs leading-5 text-slate-600">只有「課程」需要設定 F/G。付款成功會鎖定比例與收款人；沒有實際 G 歸因時，款項 100% 給 F，且不會沿上線關係展開 H。</p>
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
              name="deliveryTitle"
              maxLength={120}
              defaultValue={draft.deliveryTitle}
              placeholder={selectedFulfillmentType === "service" ? "例如：一對一諮詢安排" : selectedFulfillmentType === "course" ? "例如：課程內容入口" : "例如：教材下載"}
            />
            <Field
              label={selectedFulfillmentType === "service" ? "會議／服務入口（選填）" : "付款後入口 URL"}
              name="deliveryUrl"
              type="url"
              maxLength={2_048}
              defaultValue={draft.deliveryUrl}
              placeholder="https://..."
            />
          </div>
          <TextArea
            label={selectedFulfillmentType === "service" ? "服務安排與準備說明" : "付款後說明（選填）"}
            name="deliveryInstructions"
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
      <TextArea label="商品描述" name="description" maxLength={10_000} defaultValue={draft.description} />
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
        <Field label="外部結帳 URL（選填／進階）" name="checkoutUrl" defaultValue={draft.checkoutUrl} placeholder="https://..." />
        <p className="text-xs leading-5 text-orange-800">使用外部結帳會離開 CelebrateDeal，平台無法保證取得本地訂單、付款、退款與分潤閉環證據。需要完整交易追蹤時請留空。</p>
      </div>
      <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
        <input name="isActive" type="checkbox" defaultChecked={draft.isActive} className="mt-0.5 h-4 w-4 accent-blue-600" />
        <span>上架商品<span className="mt-1 block text-xs font-normal text-slate-500">勾選後，符合價格、庫存與交付條件的商品可進入販售流程。</span></span>
      </label>
      {mediaBlocked ? <p role="status" className="text-sm font-medium text-orange-800">請先完成圖片上傳，或移除尚未上傳的檔案。</p> : null}
      <SubmitButton disabled={mediaBlocked} />
    </form>
  );
}
