import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { COMMERCE_ORDER_STATUSES, type CommerceOrderStatus } from "@/lib/commerce-order-domain";
import { requireVendorManagerMfa } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

const statusLabels: Record<CommerceOrderStatus, string> = {
  draft: "草稿", pending_payment: "待付款", paid: "已付款", payment_failed: "付款失敗",
  expired: "付款逾期", cancelled: "已取消", partially_refunded: "部分退款", refunded: "已退款",
};

function selectedStatus(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return COMMERCE_ORDER_STATUSES.includes(candidate as CommerceOrderStatus) ? candidate as CommerceOrderStatus : null;
}

function tone(status: CommerceOrderStatus): "green" | "orange" | "red" | "gray" {
  if (status === "paid") return "green";
  if (status === "pending_payment" || status === "partially_refunded") return "orange";
  if (["payment_failed", "cancelled", "refunded"].includes(status)) return "red";
  return "gray";
}

export default async function OrdersPage({ searchParams }: {
  searchParams?: Promise<{ status?: string | string[]; q?: string | string[]; productId?: string | string[] }>;
}) {
  const { vendor } = await requireVendorManagerMfa("/orders");
  const query = await searchParams;
  const status = selectedStatus(query?.status);
  const rawSearch = Array.isArray(query?.q) ? query?.q[0] : query?.q;
  const search = rawSearch?.trim().slice(0, 128) ?? "";
  const rawProductId = Array.isArray(query?.productId) ? query.productId[0] : query?.productId;
  const productId = rawProductId && /^[A-Za-z0-9_-]{1,160}$/u.test(rawProductId) ? rawProductId : "";
  const orders = await getDb().commerceOrder.findMany({
    where: {
      vendorId: vendor.id,
      ...(status ? { status } : {}),
      ...(search ? { orderNumber: { contains: search, mode: "insensitive" } } : {}),
      ...(productId ? { items: { some: { productId } } } : {}),
    },
    include: { items: { orderBy: { lineIndex: "asc" }, take: 3, select: { id: true, productName: true, quantity: true, fulfillmentType: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeader title="訂單與履約" description="從付款確認一路追蹤出貨、數位授權、服務排程與退款狀態。" />
      <Card className="mb-5">
        <form method="get" className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
          {productId ? <input type="hidden" name="productId" value={productId} /> : null}
          <label className="grid gap-1 text-sm font-medium text-slate-700">訂單編號
            <input name="q" defaultValue={search} maxLength={128} className="min-h-11 rounded-md border border-slate-300 px-3" placeholder="搜尋訂單編號" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">狀態
            <select name="status" defaultValue={status ?? ""} className="min-h-11 rounded-md border border-slate-300 bg-white px-3">
              <option value="">全部狀態</option>
              {COMMERCE_ORDER_STATUSES.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
            </select>
          </label>
          <button className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white">篩選</button>
        </form>
      </Card>
      {orders.length === 0 ? <EmptyState title="沒有符合條件的訂單" description="買家完成結帳後，canonical 訂單會顯示在這裡。" /> : (
        <div className="grid gap-3">
          {orders.map((order) => (
            <Link key={order.id} href={`/orders/${encodeURIComponent(order.id)}`} className="rounded-lg border border-border bg-white p-4 shadow-sm transition hover:bg-slate-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="font-semibold text-slate-950">{order.orderNumber}</h2><p className="mt-1 text-sm text-slate-500">{order.buyerMaskedName} · {order.buyerMaskedEmail}</p></div>
                <div className="text-right"><Badge tone={tone(order.status)}>{statusLabels[order.status]}</Badge><p className="mt-2 font-semibold">{formatCurrency(order.totalAmountCents, order.currency)}</p></div>
              </div>
              <p className="mt-3 text-sm text-slate-600">{order.items.map((item) => `${item.productName} × ${item.quantity}`).join("、")}</p>
              <p className="mt-2 text-xs text-slate-500">{order.createdAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
