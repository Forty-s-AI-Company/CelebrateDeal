import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid" || status === "approved") return "green" as const;
  if (status === "pending") return "orange" as const;
  return "gray" as const;
}

export default async function AffiliateCommissionsPage() {
  const vendor = await requireVendor();
  const [commissions, payouts] = await Promise.all([
    getDb().affiliateCommission.findMany({
      where: { vendorId: vendor.id },
      orderBy: { attributedAt: "desc" },
      include: { affiliate: true },
    }),
    getDb().affiliatePayout.findMany({
      where: { vendorId: vendor.id },
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      include: { affiliate: true },
    }),
  ]);

  const approvedAmount = commissions.filter((item) => item.status === "approved").reduce((sum, item) => sum + item.commissionAmountCents, 0);
  const pendingAmount = commissions.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.commissionAmountCents, 0);

  return (
    <>
      <PageHeader
        title="聯盟分潤"
        description="依活動、商品與推廣碼追蹤佣金，並與平台交易服務費分開列帳。"
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-white to-blue-50">
          <p className="text-sm font-medium text-slate-500">已核准佣金</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(approvedAmount)}</p>
        </Card>
        <Card className="bg-gradient-to-br from-white to-orange-50">
          <p className="text-sm font-medium text-slate-500">待審佣金</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{formatCurrency(pendingAmount)}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">月結筆數</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{payouts.length}</p>
        </Card>
      </div>

      {commissions.length === 0 ? (
        <EmptyState title="尚無分潤資料" description="當推廣連結帶來訂單後，系統會在這裡累積佣金並進入月結。" />
      ) : (
        <div className="grid gap-6">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-950">佣金明細</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">推廣者</th>
                    <th className="px-5 py-3">推廣碼</th>
                    <th className="px-5 py-3">訂單</th>
                    <th className="px-5 py-3">成交額</th>
                    <th className="px-5 py-3">比例</th>
                    <th className="px-5 py-3">佣金</th>
                    <th className="px-5 py-3">狀態</th>
                    <th className="px-5 py-3">歸因時間</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {commissions.map((commission) => (
                    <tr key={commission.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        {commission.affiliate ? (
                          <Link href={`/affiliates/${commission.affiliate.id}`} className="font-semibold text-primary hover:underline">
                            {commission.affiliate.name}
                          </Link>
                        ) : (
                          <span className="text-slate-500">未綁定</span>
                        )}
                      </td>
                      <td className="px-5 py-4 font-mono text-slate-700">{commission.referralCode ?? "-"}</td>
                      <td className="px-5 py-4">{commission.orderNumber ?? "-"}</td>
                      <td className="px-5 py-4">{formatCurrency(commission.orderAmountCents)}</td>
                      <td className="px-5 py-4">{commission.commissionRateBps / 100}%</td>
                      <td className="px-5 py-4 font-bold text-slate-950">{formatCurrency(commission.commissionAmountCents)}</td>
                      <td className="px-5 py-4"><Badge tone={statusTone(commission.status)}>{commission.status}</Badge></td>
                      <td className="px-5 py-4 text-slate-500">{formatDateTime(commission.attributedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-950">分潤月結</h2>
            <div className="mt-4 grid gap-3">
              {payouts.map((payout) => (
                <div key={payout.id} className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-slate-950">{payout.monthKey} · {payout.affiliate?.name ?? "未綁定推廣者"}</p>
                    <p className="mt-1 text-sm text-slate-500">調整 {formatCurrency(payout.adjustmentAmountCents)}</p>
                  </div>
                  <Badge tone={statusTone(payout.status)}>{payout.status}</Badge>
                  <p className="text-lg font-bold text-slate-950">{formatCurrency(payout.finalAmountCents)}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
