import { notFound } from "next/navigation";
import { updateDiscountCodeAction } from "@/app/actions/discount-code-actions";
import { DiscountCodeForm } from "@/components/discount-code-form";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { discountCodeFormErrorMessage, discountCodeProductOptions } from "@/lib/discount-code-admin";
import { formatZonedDateTimeLocal } from "@/lib/zoned-date-time";

export default async function DiscountCodeEditPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string | string[] }>;
}) {
  const { id } = await params;
  const { vendor } = await requireVendorManagerContext(`/discount-codes/${encodeURIComponent(id)}`);
  const query = await searchParams;
  const error = discountCodeFormErrorMessage(Array.isArray(query?.error) ? query.error[0] : query?.error);
  const db = getDb();
  // Another vendor's id is answered exactly like an unknown one.
  const code = await db.discountCode.findFirst({
    where: { id, vendorId: vendor.id },
    include: { products: { where: { vendorId: vendor.id }, select: { productId: true } } },
  });
  if (!code) notFound();
  // Every linked product is shown, so saving never drops a link the list limit hid.
  const products = await discountCodeProductOptions(db, vendor.id, code.products.map((link) => link.productId));
  const localInput = (value: Date | null) => value ? formatZonedDateTimeLocal(value, vendor.timezone) : "";

  return (
    <>
      <PageHeader title={`編輯折扣碼 ${code.code}`} description="修改後，尚未建立的結帳會使用新設定；已建立的訂單保留下單當時的折扣。" action={<ButtonLink href="/discount-codes" tone="secondary">回折扣碼清單</ButtonLink>} />
      {error ? <p role="alert" className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p> : null}
      <Card className="max-w-3xl">
        <DiscountCodeForm
          action={updateDiscountCodeAction}
          products={products}
          timeZone={vendor.timezone}
          submitLabel="儲存折扣碼"
          values={{
            id: code.id,
            code: code.code,
            discountType: code.discountType === "percentage" ? "percentage" : "fixed_amount",
            discountValue: String(code.discountType === "percentage" ? code.discountValue : Math.floor(code.discountValue / 100)),
            appliesToAllProducts: code.appliesToAllProducts,
            productIds: code.products.map((link) => link.productId),
            startsAt: localInput(code.startsAt),
            endsAt: localInput(code.endsAt),
            maxRedemptions: code.maxRedemptions === null ? "" : String(code.maxRedemptions),
            maxRedemptionsPerBuyer: code.maxRedemptionsPerBuyer === null ? "" : String(code.maxRedemptionsPerBuyer),
            minSubtotal: code.minSubtotalCents === null ? "" : String(Math.floor(code.minSubtotalCents / 100)),
            isActive: code.isActive,
          }}
        />
      </Card>
    </>
  );
}
