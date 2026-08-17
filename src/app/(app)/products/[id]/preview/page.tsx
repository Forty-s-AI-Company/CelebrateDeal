import Image from "next/image";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

const fulfillmentLabels = {
  physical: "實體出貨",
  digital: "數位授權",
  service: "服務排程",
  course: "課程授權／F/G 分潤",
} as const;

export default async function ProductPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const product = await getDb().product.findFirst({
    where: { id, vendorId: vendor.id },
    include: { deliveryConfig: { select: { status: true, fulfillmentType: true, title: true } } },
  });
  if (!product) notFound();
  const deliveryReady = product.fulfillmentType === "physical"
    || (
      product.deliveryConfig?.status === "active"
      && product.deliveryConfig.fulfillmentType === product.fulfillmentType
    );
  const readyForInternalCheckout = product.isActive
    && product.fulfillmentTypeConfirmed
    && product.priceCents > 0
    && product.inventory > 0
    && deliveryReady;

  return (
    <>
      <PageHeader title="商品預覽" description="這是商家預覽，不會把草稿公開給買家。" action={<ButtonLink href={`/products/${encodeURIComponent(product.id)}/edit`} tone="secondary">返回編輯</ButtonLink>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
        <Card className="overflow-hidden p-0">
          {product.imageUrl ? <Image src={product.imageUrl} alt={product.name} width={1200} height={675} unoptimized className="aspect-video w-full bg-slate-100 object-contain" /> : <div className="grid aspect-video place-items-center bg-slate-100 text-sm text-slate-500">尚未設定商品圖片</div>}
          <div className="grid gap-4 p-6">
            <div className="flex flex-wrap gap-2">
              <Badge tone={product.isActive ? "green" : "gray"}>{product.isActive ? "已勾選上架" : "草稿"}</Badge>
              <Badge tone={product.fulfillmentTypeConfirmed ? "blue" : "orange"}>{product.fulfillmentTypeConfirmed ? fulfillmentLabels[product.fulfillmentType] : "交付方式未確認"}</Badge>
            </div>
            <div><h2 className="text-2xl font-bold text-slate-950">{product.name}</h2><p className="mt-2 text-2xl font-black text-orange-700">{formatCurrency(product.priceCents, product.currency)}</p></div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{product.description || "尚未填寫商品描述。"}</p>
          </div>
        </Card>
        <Card className="h-fit">
          <h2 className="text-lg font-semibold text-slate-950">販售前檢查</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">狀態</dt><dd className="font-semibold">{product.isActive ? "上架" : "草稿"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">可售庫存</dt><dd className="font-semibold">{product.inventory}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">交付方式</dt><dd className="text-right font-semibold">{fulfillmentLabels[product.fulfillmentType]}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">付款後交付</dt><dd className="text-right font-semibold">{deliveryReady ? (product.deliveryConfig?.title ?? "實體出貨") : "尚未完成設定"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">本地交易閉環</dt><dd className="text-right font-semibold">{product.checkoutUrl ? "外部結帳，不完整" : "CelebrateDeal 結帳"}</dd></div>
          </dl>
          {!readyForInternalCheckout ? <p role="status" className="mt-5 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">尚不可販售：請確認已上架、售價與庫存有效、交付方式已確認，且非實體商品已有完整的付款後交付設定。</p> : null}
          {product.checkoutUrl ? <p role="status" className="mt-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900">此外部結帳 URL 不會產生完整的 CelebrateDeal 訂單、退款與分潤證據。</p> : null}
          {readyForInternalCheckout && !product.checkoutUrl ? <div className="mt-5"><a href={`/checkout/${encodeURIComponent(product.vendorId)}/${encodeURIComponent(product.id)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition bg-primary text-white hover:bg-primary-dark">開啟買家結帳預覽</a></div> : null}
        </Card>
      </div>
    </>
  );
}
