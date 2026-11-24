import Link from "next/link";
import { createDiscountCodeAction, setDiscountCodeActiveAction } from "@/app/actions/discount-code-actions";
import { CsrfField } from "@/components/csrf-field";
import { DiscountCodeForm, EMPTY_DISCOUNT_CODE_FORM } from "@/components/discount-code-form";
import { Badge, Card, EmptyState, PageHeader, SubmitButton } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { discountCodeFormErrorMessage, discountCodeUsageByCode } from "@/lib/discount-code-admin";
import { formatCurrency, formatDateTime } from "@/lib/format";

const UPDATED_MESSAGES: Record<string, string> = {
  created: "折扣碼已建立。",
  saved: "折扣碼已儲存。",
  enabled: "折扣碼已啟用。",
  disabled: "折扣碼已停用。",
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function discountLabel(code: { discountType: string; discountValue: number; currency: string }) {
  return code.discountType === "percentage" ? `折抵 ${code.discountValue}%` : `折抵 ${formatCurrency(code.discountValue, code.currency)}`;
}

function statusOf(code: { isActive: boolean; startsAt: Date | null; endsAt: Date | null; maxRedemptions: number | null; redemptionCount: number }, now: Date) {
  if (!code.isActive) return { label: "已停用", tone: "gray" as const };
  if (code.endsAt && code.endsAt <= now) return { label: "已結束", tone: "gray" as const };
  if (code.startsAt && code.startsAt > now) return { label: "尚未開始", tone: "blue" as const };
  if (code.maxRedemptions !== null && code.redemptionCount >= code.maxRedemptions) return { label: "已達上限", tone: "orange" as const };
  return { label: "可使用", tone: "green" as const };
}

export default async function DiscountCodesPage({ searchParams }: {
  searchParams?: Promise<{ error?: string | string[]; updated?: string | string[] }>;
}) {
  const { vendor } = await requireVendorManagerContext("/discount-codes");
  const query = await searchParams;
  const error = discountCodeFormErrorMessage(single(query?.error));
  const updated = UPDATED_MESSAGES[single(query?.updated) ?? ""];
  const db = getDb();
  const [codes, products, usage] = await Promise.all([
    db.discountCode.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { products: { where: { vendorId: vendor.id }, select: { product: { select: { name: true } } } } },
    }),
    db.product.findMany({
      where: { vendorId: vendor.id, priceCents: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, priceCents: true, currency: true, isActive: true },
    }),
    discountCodeUsageByCode(db, vendor.id),
  ]);
  const now = new Date();

  return (
    <>
      <PageHeader title="折扣碼" description="建立買家在結帳時輸入的折扣碼。折扣金額一律由伺服器依這裡的設定計算，聯盟佣金以折扣後的實付金額計算。" />
      {updated ? <p role="status" className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{updated}</p> : null}
      {error ? <p role="alert" className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p> : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">新增折扣碼</h2>
          <DiscountCodeForm action={createDiscountCodeAction} values={EMPTY_DISCOUNT_CODE_FORM} products={products} timeZone={vendor.timezone} submitLabel="建立折扣碼" />
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-slate-950">折扣碼清單</h2>
          <p className="mb-4 text-xs leading-5 text-slate-600">
            一筆訂單只能使用一種優惠：折扣碼不能和快閃優惠、加購折抵同時使用；買家輸入折扣碼時，已領取的優惠券不會被使用、可以留到下次。
            退款不會歸還使用次數。
          </p>
          {codes.length === 0 ? <EmptyState title="還沒有折扣碼" description="建立第一個折扣碼後，買家就能在結帳頁輸入使用。" /> : (
            <ul className="grid gap-3">
              {codes.map((code) => {
                const status = statusOf(code, now);
                const counts = usage.get(code.id) ?? { reserved: 0, redeemed: 0 };
                return (
                  <li key={code.id} className="rounded-md border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="font-mono text-base text-slate-950 [overflow-wrap:anywhere]">{code.code}</strong>
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <span className="text-sm text-slate-700">{discountLabel(code)}</span>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                      <div><dt className="inline">適用：</dt><dd className="inline [overflow-wrap:anywhere]">{code.appliesToAllProducts ? "全部商品" : code.products.map((link) => link.product.name).join("、") || "（商品已刪除）"}</dd></div>
                      <div><dt className="inline">期間：</dt><dd className="inline">{code.startsAt ? formatDateTime(code.startsAt, vendor.timezone) : "立即"} – {code.endsAt ? formatDateTime(code.endsAt, vendor.timezone) : "不限"}</dd></div>
                      <div><dt className="inline">已使用：</dt><dd className="inline">{counts.redeemed} 筆已付款、{counts.reserved} 筆待付款{code.maxRedemptions !== null ? `（上限 ${code.maxRedemptions}）` : ""}</dd></div>
                      <div><dt className="inline">其他條件：</dt><dd className="inline">{code.maxRedemptionsPerBuyer !== null ? `每位買家 ${code.maxRedemptionsPerBuyer} 次` : "每位買家不限"}{code.minSubtotalCents !== null ? `、最低消費 ${formatCurrency(code.minSubtotalCents, code.currency)}` : ""}</dd></div>
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <Link href={`/discount-codes/${encodeURIComponent(code.id)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline">編輯</Link>
                      <form action={setDiscountCodeActiveAction}>
                        <CsrfField />
                        <input type="hidden" name="id" value={code.id} />
                        <input type="hidden" name="isActive" value={code.isActive ? "false" : "true"} />
                        <SubmitButton pendingChildren="處理中…">{code.isActive ? "停用" : "啟用"}</SubmitButton>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
