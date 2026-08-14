import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { PublicPolicyShell } from "@/components/public-policy";
import { Card } from "@/components/ui";
import { resolveBuyerSupportGrants } from "@/lib/buyer-support-access";
import { getDb } from "@/lib/db";
import { paymentReturnOutcome, type PaymentReturnOutcome } from "@/lib/payment-return-outcome";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "付款結果 | CelebrateDeal",
  description: "安全顯示目前瀏覽器可存取的訂單付款狀態。",
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

const outcomePresentation: Record<PaymentReturnOutcome, { title: string; message: string; tone: string; role: "status" | "alert" }> = {
  updated: {
    title: "已收到付款結果",
    message: "下方狀態來自已驗證的付款回傳與訂單資料；請以每筆訂單顯示的實際狀態為準。",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
    role: "status",
  },
  pending: {
    title: "付款結果仍在確認",
    message: "付款服務回傳暫時未完成處理。系統不會因此重複建立訂單；請稍後重新整理，或從下方安全入口聯絡客服。",
    tone: "border-orange-200 bg-orange-50 text-orange-900",
    role: "status",
  },
  unverified: {
    title: "無法驗證這次付款回傳",
    message: "這不代表扣款成功或失敗。請勿重複付款，先查看下方訂單狀態；若狀態沒有更新，請使用安全客服入口。",
    tone: "border-red-200 bg-red-50 text-red-900",
    role: "alert",
  },
  unknown: {
    title: "查看訂單付款狀態",
    message: "這個頁面只顯示目前瀏覽器持有安全訂單憑證的資料，不接受訂單編號或 Email 猜測查詢。",
    tone: "border-blue-200 bg-blue-50 text-blue-900",
    role: "status",
  },
};

function formatAmount(amountCents: number, currency: string) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency }).format(amountCents / 100);
}

function orderStatusTone(status: string) {
  if (status === "paid") return "bg-emerald-100 text-emerald-800";
  if (status === "pending_payment" || status === "partially_refunded") return "bg-orange-100 text-orange-800";
  if (["payment_failed", "expired", "cancelled", "refunded"].includes(status)) return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

function retryCheckoutHref(order: { vendorId: string; status: string; items: Array<{ productId: string | null }> }) {
  if (!new Set(["payment_failed", "expired"]).has(order.status)) return null;
  const productId = order.items[0]?.productId;
  if (!productId) return null;
  return `/checkout/${encodeURIComponent(order.vendorId)}/${encodeURIComponent(productId)}`;
}

export default async function PaymentResultPage({ searchParams }: {
  searchParams?: Promise<{ payment?: string | string[] }>;
}) {
  const outcome = paymentReturnOutcome((await searchParams)?.payment);
  const presentation = outcomePresentation[outcome];
  const grants = await resolveBuyerSupportGrants(getDb(), await cookies());
  const sortedGrants = [...grants].sort((left, right) => right.order.createdAt.getTime() - left.order.createdAt.getTime());

  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-4xl" aria-labelledby="payment-result-title">
        <p className="text-sm font-semibold text-primary">安全付款結果</p>
        <h1 id="payment-result-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{presentation.title}</h1>
        <div role={presentation.role} aria-live={presentation.role === "alert" ? "assertive" : "polite"} className={`mt-5 rounded-xl border p-4 text-sm leading-6 ${presentation.tone}`}>
          {presentation.message}
        </div>

        {sortedGrants.length === 0 ? (
          <Card className="mt-6">
            <h2 className="font-semibold text-slate-950">目前瀏覽器找不到可顯示的訂單</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              請使用開始結帳時的同一個瀏覽器與裝置重新開啟此頁。基於安全理由，這裡不會要求卡號、CVV、密碼、Token 或 Cookie。
            </p>
            <Link href="/support" className="mt-4 inline-flex min-h-11 items-center font-semibold text-slate-950 underline underline-offset-2 hover:text-blue-800">查看一般客服與安全受理方式 →</Link>
          </Card>
        ) : (
          <section className="mt-6 grid gap-4" aria-labelledby="payment-orders-title">
            <h2 id="payment-orders-title" className="text-xl font-bold text-slate-950">可安全查看的訂單</h2>
            {sortedGrants.map((grant) => {
              const retryHref = retryCheckoutHref(grant.order);
              return (
              <Card key={grant.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{grant.order.vendor.name}</p>
                    <p className="mt-1 text-sm text-slate-600">訂單 {grant.order.orderNumber} · {grant.order.buyerMaskedEmail}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${orderStatusTone(grant.order.status)}`}>
                    {orderStatusLabels[grant.order.status] ?? "訂單處理中"}
                  </span>
                </div>
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-slate-500">訂單金額</dt><dd className="mt-1 font-semibold text-slate-950">{formatAmount(grant.order.totalAmountCents, grant.order.currency)}</dd></div>
                  <div><dt className="text-slate-500">退款金額</dt><dd className="mt-1 font-semibold text-slate-950">{formatAmount(grant.order.refundedAmountCents, grant.order.currency)}</dd></div>
                </dl>
                <div className="mt-5 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-sm">
                  <Link href={`/support/orders/${encodeURIComponent(grant.id)}`} className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">
                    查看商品與履約進度 →
                  </Link>
                  {retryHref ? (
                    <Link href={retryHref} className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">
                      回到商品重新嘗試付款 →
                    </Link>
                  ) : null}
                  <Link href="/support/requests" className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-800">查看訂單協助與客服案件 →</Link>
                </div>
                {retryHref ? <p className="mt-2 text-xs leading-5 text-slate-600">這會建立新的安全付款嘗試；原訂單與失敗紀錄仍會保留，不會直接重送舊交易。</p> : null}
              </Card>
              );
            })}
          </section>
        )}
      </main>
    </PublicPolicyShell>
  );
}
