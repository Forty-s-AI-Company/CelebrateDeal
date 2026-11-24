import { CsrfField } from "@/components/csrf-field";
import { Field, SelectField, SubmitButton } from "@/components/ui";
import { formatCurrency } from "@/lib/format";

export type DiscountCodeFormProduct = { id: string; name: string; priceCents: number; currency: string; isActive: boolean };

export type DiscountCodeFormValues = {
  id?: string;
  code: string;
  discountType: "fixed_amount" | "percentage";
  /** Whole TWD dollars for fixed amounts; percent for percentage. */
  discountValue: string;
  appliesToAllProducts: boolean;
  productIds: readonly string[];
  /** datetime-local strings in the vendor's time zone. */
  startsAt: string;
  endsAt: string;
  maxRedemptions: string;
  maxRedemptionsPerBuyer: string;
  minSubtotal: string;
  isActive: boolean;
};

export const EMPTY_DISCOUNT_CODE_FORM: DiscountCodeFormValues = {
  code: "",
  discountType: "fixed_amount",
  discountValue: "",
  appliesToAllProducts: true,
  productIds: [],
  startsAt: "",
  endsAt: "",
  maxRedemptions: "",
  maxRedemptionsPerBuyer: "",
  minSubtotal: "",
  isActive: true,
};

/**
 * Shared create/edit form. Products come from the session vendor's catalog
 * only; the server re-checks every selected id against the same vendor.
 */
export function DiscountCodeForm({ action, values, products, timeZone, submitLabel }: {
  action: (formData: FormData) => Promise<void>;
  values: DiscountCodeFormValues;
  products: readonly DiscountCodeFormProduct[];
  timeZone: string;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-4">
      <CsrfField />
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="折扣碼" name="code" required minLength={6} maxLength={32} pattern="[A-Za-z0-9_\-]{6,32}" defaultValue={values.code}
        hint="6–32 個英文字母、數字、- 或 _；買家輸入時不分大小寫，同一個商店不能重複。建議用不易猜的碼（8 個字元以上、混合英文與數字），避免 SALE10 這類常見字：一直有人猜錯時，系統會暫停這個商品或整個商店的折扣碼查詢 10 分鐘。" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="折扣方式" name="discountType" defaultValue={values.discountType}>
          <option value="fixed_amount">折抵固定金額（新台幣元）</option>
          <option value="percentage">折抵售價的百分比</option>
        </SelectField>
        <Field label="折扣數值" name="discountValue" type="number" inputMode="numeric" required min={1} max={1_000_000} step={1} defaultValue={values.discountValue}
          hint="固定金額填新台幣整數元；百分比填 1–100，例如 20 代表折抵 20%（打八折）。" />
      </div>
      <p className="-mt-1 text-xs leading-5 text-slate-600">
        折扣只套用在主商品，不含加購商品；折扣後買家至少支付新台幣 1 元（金流最低金額），金額以整數元計算。
      </p>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-slate-700">適用商品</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="appliesTo" value="all" defaultChecked={values.appliesToAllProducts} className="h-4 w-4" />全部商品</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="appliesTo" value="selected" defaultChecked={!values.appliesToAllProducts} className="h-4 w-4" />只限下方勾選的商品</label>
        {products.length > 0 ? (
          <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-border p-3">
            {products.map((product) => (
              <label key={product.id} className="flex min-h-10 items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" name="productIds" value={product.id} defaultChecked={values.productIds.includes(product.id)} className="mt-1 h-4 w-4" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{product.name}<span className="ml-2 text-xs text-slate-500">{formatCurrency(product.priceCents, product.currency)}{product.isActive ? "" : "・未上架"}</span></span>
              </label>
            ))}
          </div>
        ) : <p className="text-xs text-slate-600">目前沒有商品；選「只限勾選的商品」前請先建立商品。</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="開始時間（選填）" name="startsAt" type="datetime-local" defaultValue={values.startsAt} hint={`以 ${timeZone} 時間輸入；留空代表立即生效。`} />
        <Field label="結束時間（選填）" name="endsAt" type="datetime-local" defaultValue={values.endsAt} hint="留空代表不會到期。" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="總使用上限（選填）" name="maxRedemptions" type="number" inputMode="numeric" min={1} max={1_000_000} step={1} defaultValue={values.maxRedemptions} hint="待付款的訂單也會先佔用次數；付款失敗或逾期會歸還。" />
        <Field label="每位買家上限（選填）" name="maxRedemptionsPerBuyer" type="number" inputMode="numeric" min={1} max={1_000} step={1} defaultValue={values.maxRedemptionsPerBuyer} hint="以結帳 Email 判斷。" />
        <Field label="最低消費（新台幣元，選填）" name="minSubtotal" type="number" inputMode="numeric" min={0} max={1_000_000} step={1} defaultValue={values.minSubtotal} hint="以主商品加上加購商品的原價計算。" />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" name="isActive" defaultChecked={values.isActive} className="h-4 w-4" />啟用（停用後買家無法再使用，已建立的訂單不受影響）
      </label>
      <div><SubmitButton>{submitLabel}</SubmitButton></div>
    </form>
  );
}
