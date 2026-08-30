import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { PublicPolicyShell } from "@/components/public-policy";
import { Card } from "@/components/ui";
import { resolveBuyerSupportGrants } from "@/lib/buyer-support-access";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "我的訂單 | CelebrateDeal",
  description: "使用結帳瀏覽器的安全訂單憑證查看付款與履約狀態。",
  robots: { index: false, follow: false },
};

const statusLabels: Record<string, string> = {
  pending_payment: "等待付款確認",
  paid: "付款完成",
  payment_failed: "付款失敗",
  expired: "付款逾期",
  cancelled: "訂單取消",
  partially_refunded: "部分退款",
  refunded: "已退款",
};

function formatAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency }).format(amountCents / 100);
}

export default async function BuyerOrdersPage() {
  const grants = await resolveBuyerSupportGrants(getDb(), await cookies());
  const sorted = [...grants].sort((left, right) => right.order.createdAt.getTime() - left.order.createdAt.getTime());

  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-5xl" aria-labelledby="buyer-orders-title">
        <p className="text-sm font-semibold text-primary">安全訂單查詢</p>
        <h1 id="buyer-orders-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">我的訂單</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          這裡只顯示目前瀏覽器在結帳時取得的訂單，不接受訂單編號或 Email 猜測查詢。
        </p>

        {sorted.length === 0 ? (
          <Card className="mt-6">
            <h2 className="font-semibold text-slate-950">找不到可查看的訂單</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">請使用開始結帳時的同一個瀏覽器與裝置。請勿在任何表單貼上 Cookie、Token、完整卡號或 CVV。</p>
            <Link href="/support" className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary hover:underline">查看安全客服方式 →</Link>
          </Card>
        ) : (
          <section className="mt-6 grid gap-4" aria-label="可查看的訂單">
            {sorted.map((grant) => (
              <Card key={grant.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">{grant.order.vendor.name}</h2>
                    <p className="mt-1 text-sm text-slate-600">訂單 {grant.order.orderNumber} · {grant.order.buyerMaskedEmail}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {statusLabels[grant.order.status] ?? "訂單處理中"}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-slate-500">訂單金額</dt><dd className="mt-1 font-semibold text-slate-950">{formatAmount(grant.order.totalAmountCents, grant.order.currency)}</dd></div>
                  <div><dt className="text-slate-500">退款金額</dt><dd className="mt-1 font-semibold text-slate-950">{formatAmount(grant.order.refundedAmountCents, grant.order.currency)}</dd></div>
                </dl>
                <div className="mt-5 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-sm">
                  <Link href={`/support/orders/${encodeURIComponent(grant.id)}`} className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">查看商品與履約進度 →</Link>
                  <Link href="/support/requests" className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">查看客服案件 →</Link>
                </div>
              </Card>
            ))}
          </section>
        )}
      </main>
    </PublicPolicyShell>
  );
}
