import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { PublicPolicyShell } from "@/components/public-policy";
import { Badge, Card } from "@/components/ui";
import { resolveBuyerOrderDetail } from "@/lib/buyer-support-access";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "訂單進度 | CelebrateDeal",
  description: "安全查看商品、付款、退款與履約狀態。",
  robots: { index: false, follow: false },
};

const orderStatusLabels: Record<string, string> = {
  pending_payment: "等待付款確認",
  paid: "付款完成",
  payment_failed: "付款失敗",
  expired: "付款逾期",
  cancelled: "訂單取消",
  partially_refunded: "部分退款",
  refunded: "已退款",
};

const fulfillmentLabels: Record<string, string> = {
  pending: "等待處理",
  packing: "備貨中",
  shipped: "已出貨",
  delivered: "已送達",
  refund_review: "退款處理中",
  returned: "已退回",
  cancelled: "已取消",
  granted: "已開通",
  revoked: "已撤銷",
  scheduling: "安排中",
  scheduled: "已排程",
  completed: "已完成",
};

const fulfillmentTypeLabels: Record<string, string> = {
  physical: "實體商品",
  digital: "數位內容",
  service: "預約服務",
  course: "課程",
};

function formatAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency }).format(amountCents / 100);
}

function localDate(value: Date | null) {
  return value ? value.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "尚未更新";
}

type BuyerOrder = NonNullable<Awaited<ReturnType<typeof resolveBuyerOrderDetail>>>;
type BuyerOrderItem = BuyerOrder["items"][number];
type DeliveryAccessState = "available" | "legacy" | "stopped" | "pending" | "none";

function deliveryAccessState(item: BuyerOrderItem, orderStatus: string, now: Date): DeliveryAccessState {
  if (item.fulfillmentType === "physical") return "none";
  const orderAllowsDelivery = orderStatus === "paid" || orderStatus === "partially_refunded";
  if (orderAllowsDelivery && !item.deliverySnapshot) return "legacy";
  if (!item.deliverySnapshot) return "none";
  if (
    item.deliverySnapshot.revokedAt
    || orderStatus === "refunded"
    || item.entitlement?.status === "revoked"
    || item.serviceFulfillment?.status === "cancelled"
  ) return "stopped";
  if (!orderAllowsDelivery) return "pending";
  if (item.fulfillmentType === "service") {
    return item.serviceFulfillment && !item.serviceFulfillment.cancelledAt ? "available" : "pending";
  }
  return item.entitlement?.status === "granted"
    && !item.entitlement.revokedAt
    && (!item.entitlement.expiresAt || item.entitlement.expiresAt > now)
    ? "available"
    : "pending";
}

function FulfillmentDetails({ item }: { item: BuyerOrderItem }) {
  return (
    <>
      {item.shippingFulfillment ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">物流狀態</dt><dd className="mt-1 font-semibold text-slate-950">{fulfillmentLabels[item.shippingFulfillment.status] ?? "處理中"}</dd></div>
          <div><dt className="text-slate-500">承運服務</dt><dd className="mt-1 font-semibold text-slate-950">{item.shippingFulfillment.carrierName ?? "商家尚未提供"}</dd></div>
          <div><dt className="text-slate-500">出貨時間</dt><dd className="mt-1 font-semibold text-slate-950">{localDate(item.shippingFulfillment.shippedAt)}</dd></div>
          <div><dt className="text-slate-500">送達時間</dt><dd className="mt-1 font-semibold text-slate-950">{localDate(item.shippingFulfillment.deliveredAt)}</dd></div>
        </dl>
      ) : null}
      {item.entitlement ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">內容授權</dt><dd className="mt-1 font-semibold text-slate-950">{fulfillmentLabels[item.entitlement.status] ?? "處理中"}</dd></div>
          <div><dt className="text-slate-500">開通時間</dt><dd className="mt-1 font-semibold text-slate-950">{localDate(item.entitlement.grantedAt)}</dd></div>
          <div><dt className="text-slate-500">到期時間</dt><dd className="mt-1 font-semibold text-slate-950">{item.entitlement.expiresAt ? localDate(item.entitlement.expiresAt) : "未設定到期日"}</dd></div>
        </dl>
      ) : null}
      {item.serviceFulfillment ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">服務狀態</dt><dd className="mt-1 font-semibold text-slate-950">{fulfillmentLabels[item.serviceFulfillment.status] ?? "處理中"}</dd></div>
          <div><dt className="text-slate-500">預約時間</dt><dd className="mt-1 font-semibold text-slate-950">{localDate(item.serviceFulfillment.scheduledAt)}</dd></div>
          {item.serviceFulfillment.serviceMaskedSummary ? <div className="sm:col-span-2"><dt className="text-slate-500">服務摘要</dt><dd className="mt-1 font-semibold text-slate-950">{item.serviceFulfillment.serviceMaskedSummary}</dd></div> : null}
        </dl>
      ) : null}
    </>
  );
}

function DeliveryAccessPanel({ item, grantId, state }: { item: BuyerOrderItem; grantId: string; state: DeliveryAccessState }) {
  if (state === "available" && item.deliverySnapshot) {
    return (
      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="font-semibold text-emerald-950">{item.deliverySnapshot.title}</p>
        {item.deliverySnapshot.destinationMaskedSummary ? <p className="mt-1 text-xs text-emerald-900">{item.deliverySnapshot.destinationMaskedSummary}</p> : null}
        {item.deliverySnapshot.instructionsMaskedSummary ? <p className="mt-1 text-xs text-emerald-900">{item.deliverySnapshot.instructionsMaskedSummary}</p> : null}
        <Link href={`/support/orders/${grantId}/delivery/${item.id}`} className="mt-3 inline-flex min-h-11 items-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800">開啟付款後內容</Link>
      </div>
    );
  }
  if (state === "legacy") return <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950" role="status">這筆舊訂單沒有保存付款後交付內容。請建立客服案件，由商家確認原購買紀錄後提供協助。</div>;
  if (state === "stopped") return <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="status">這項付款後內容目前已停止提供；若你認為狀態有誤，請建立客服案件。</div>;
  if (state === "pending") return <p className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-950" role="status">付款確認並開通後，這裡會出現安全的內容入口。</p>;
  return null;
}

function BuyerOrderItemCard({ item, order, grantId, now }: { item: BuyerOrderItem; order: BuyerOrder; grantId: string; now: Date }) {
  const fulfillment = item.shippingFulfillment ?? item.entitlement ?? item.serviceFulfillment;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{item.productName}</h3>
          <p className="mt-1 text-sm text-slate-600">{fulfillmentTypeLabels[item.fulfillmentType] ?? "商品"} · {item.quantity} × {formatAmount(item.unitPriceCents, order.currency)}</p>
        </div>
        <Badge tone={fulfillment?.status === "delivered" || fulfillment?.status === "granted" || fulfillment?.status === "completed" ? "green" : "gray"}>
          {fulfillment ? (fulfillmentLabels[fulfillment.status] ?? "處理中") : "等待付款"}
        </Badge>
      </div>
      <FulfillmentDetails item={item} />
      <DeliveryAccessPanel item={item} grantId={grantId} state={deliveryAccessState(item, order.status, now)} />
    </Card>
  );
}

export default async function BuyerOrderDetailPage({ params }: {
  params: Promise<{ grantId: string }>;
}) {
  const { grantId } = await params;
  const order = await resolveBuyerOrderDetail(getDb(), await cookies(), grantId);
  if (!order) notFound();
  const now = new Date();

  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-5xl" aria-labelledby="buyer-order-title">
        <Link href="/support/orders" className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">← 返回我的訂單</Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-full">
            <p className="text-sm font-semibold text-primary">{order.vendor.name}</p>
            <h1 id="buyer-order-title" className="mt-2 break-words text-3xl font-bold tracking-tight text-slate-950 [overflow-wrap:anywhere]">訂單 {order.orderNumber}</h1>
            <p className="mt-2 text-sm text-slate-600">{order.buyerMaskedName} · {order.buyerMaskedEmail}{order.buyerMaskedPhone ? ` · ${order.buyerMaskedPhone}` : ""}</p>
          </div>
          <Badge tone={order.status === "paid" ? "green" : order.status === "pending_payment" || order.status === "partially_refunded" ? "orange" : "gray"}>
            {orderStatusLabels[order.status] ?? "訂單處理中"}
          </Badge>
        </div>

        <Card className="mt-6">
          <h2 className="font-semibold text-slate-950">付款與退款摘要</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-slate-500">訂單金額</dt><dd className="mt-1 font-semibold text-slate-950">{formatAmount(order.totalAmountCents, order.currency)}</dd></div>
            <div><dt className="text-slate-500">已確認付款</dt><dd className="mt-1 font-semibold text-slate-950">{formatAmount(order.paidAmountCents, order.currency)}</dd></div>
            <div><dt className="text-slate-500">累計退款</dt><dd className="mt-1 font-semibold text-slate-950">{formatAmount(order.refundedAmountCents, order.currency)}</dd></div>
            <div><dt className="text-slate-500">建立時間</dt><dd className="mt-1 font-semibold text-slate-950">{localDate(order.createdAt)}</dd></div>
          </dl>
          {order.shippingMaskedSummary ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">配送資訊：{order.shippingMaskedSummary}</p> : null}
        </Card>

        <section className="mt-6 grid gap-4" aria-labelledby="order-items-title">
          <h2 id="order-items-title" className="text-xl font-bold text-slate-950">商品與履約進度</h2>
          {order.items.map((item) => <BuyerOrderItemCard key={item.id} item={item} order={order} grantId={grantId} now={now} />)}
        </section>

        <div className="mt-6 flex flex-wrap gap-4 text-sm">
          <Link href="/support/requests" className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">查看或建立客服案件 →</Link>
          <Link href="/policies/refunds" className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">查看退款政策草稿 →</Link>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-600">本頁不顯示完整地址、物流單號、付款識別碼、退款事件識別碼、數位授權 secret 或任何加密內容。</p>
      </main>
    </PublicPolicyShell>
  );
}
