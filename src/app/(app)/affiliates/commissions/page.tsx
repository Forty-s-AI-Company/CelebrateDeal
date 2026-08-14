import Link from "next/link";
import { recordAffiliatePayoutOutcomeAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorFinance } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid" || status === "approved") return "green" as const;
  if (status === "pending") return "orange" as const;
  return "gray" as const;
}

const payoutErrorMessages: Record<string, string> = {
  conflict: "這筆聯盟月結已被其他操作更新，請重新整理後再試一次。",
  invalid_payout: "聯盟月結操作資料不完整，請重新整理後再試一次。",
};

export default async function AffiliateCommissionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const { vendor } = await requireVendorFinance("/affiliates/commissions");
  const query = await searchParams;
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

      {query?.error && payoutErrorMessages[query.error] ? (
        <p className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {payoutErrorMessages[query.error]}
        </p>
      ) : null}

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
        <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-950">佣金明細</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">推廣者</th>
                    <th className="px-5 py-3">推廣碼</th>
                    <th className="px-5 py-3">訂單</th>
                    <th className="px-5 py-3">Gross 分潤基礎</th>
                    <th className="px-5 py-3">Net reference</th>
                    <th className="px-5 py-3">比例</th>
                    <th className="px-5 py-3">佣金</th>
                    <th className="px-5 py-3">狀態</th>
                    <th className="px-5 py-3">歸因時間</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {commissions.map((commission) => {
                    const commissionBaseAmountCents = commission.commissionBaseAmountCents ?? commission.orderAmountCents;
                    const netReferenceAmountCents = commission.netReferenceAmountCents ?? 0;
                    return (
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
                      <td className="px-5 py-4">{formatCurrency(commissionBaseAmountCents)}</td>
                      <td className="px-5 py-4">
                        <span>{formatCurrency(netReferenceAmountCents)}</span>
                        <span className="mt-1 block text-xs text-slate-500">扣服務費／退款後，僅供對照</span>
                      </td>
                      <td className="px-5 py-4">{commission.commissionRateBps / 100}%</td>
                      <td className="px-5 py-4 font-bold text-slate-950">{formatCurrency(commission.commissionAmountCents)}</td>
                      <td className="px-5 py-4"><Badge tone={statusTone(commission.status)}>{commission.status}</Badge></td>
                      <td className="px-5 py-4 text-slate-500">{formatDateTime(commission.attributedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        </Card>
      )}

      {payouts.length === 0 ? (
        <div className="mt-6"><EmptyState title="尚無分潤月結" description="佣金進入鎖帳後，系統會依推廣者與月份建立可追蹤的 payout。" /></div>
      ) : (
          <Card className="mt-6">
            <h2 className="text-lg font-semibold text-slate-950">分潤月結</h2>
            <div className="mt-4 grid gap-3">
              {payouts.map((payout) => (
                <div key={payout.id} className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-slate-950">{payout.monthKey} · {payout.affiliate?.name ?? "未綁定推廣者"}</p>
                    <p className="mt-1 text-sm text-slate-500">調整 {formatCurrency(payout.adjustmentAmountCents)}</p>
                    <p className="mt-1 text-xs text-slate-500">出款 reference：{payout.outcomeReference ?? "未記錄"}</p>
                    <p className="mt-1 text-xs text-slate-500">付款備註／作廢原因：{payout.outcomeReason ?? "未記錄"}</p>
                    <Link href={`/affiliates/commissions/${encodeURIComponent(payout.id)}`} className="mt-2 inline-flex text-sm font-semibold text-primary hover:underline">
                      查看 ledger 與 payout 明細
                    </Link>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={statusTone(payout.status)}>{payout.status}</Badge>
                    <p className="text-lg font-bold text-slate-950">{formatCurrency(payout.finalAmountCents)}</p>
                  </div>
                  {payout.status === "pending"
                    && payout.vendorId === vendor.id
                    && payout.payoutItemId === null
                    && payout.finalAmountCents > 0
                    && payout.finalAmountCents === payout.commissionAmountCents + payout.adjustmentAmountCents ? (
                    <div className="grid gap-2 md:col-span-3 md:grid-cols-[1fr_auto] md:items-end">
                      <p className="text-sm text-slate-600">商家完成自行付款後，請留下人工出款 reference 與付款備註；若作廢，系統會沖回尚未支付的佣金並同步更新聯盟月結狀態。</p>
                      <div className="flex flex-wrap gap-2">
                        <form action={recordAffiliatePayoutOutcomeAction} className="flex flex-wrap items-end gap-2">
                          <CsrfField />
                          <input type="hidden" name="id" value={payout.id} />
                          <input type="hidden" name="status" value="paid" />
                          <input name="outcomeReference" required maxLength={200} placeholder="人工出款 reference" aria-label="人工出款 reference" className="h-9 w-40 rounded-md border border-border px-2 text-xs" />
                          <input name="reason" required maxLength={500} placeholder="付款備註" aria-label="付款備註" className="h-9 w-32 rounded-md border border-border px-2 text-xs" />
                          <FormSubmitButton
                            pendingChildren="記錄中…"
                            pendingMessage="正在記錄聯盟出款結果，請勿重複送出。"
                            className="h-9 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                          >標記已付款</FormSubmitButton>
                        </form>
                        <form action={recordAffiliatePayoutOutcomeAction} className="flex flex-wrap items-end gap-2">
                          <CsrfField />
                          <input type="hidden" name="id" value={payout.id} />
                          <input type="hidden" name="status" value="void" />
                          <input name="reason" required maxLength={500} placeholder="作廢原因" aria-label="作廢原因" className="h-9 w-32 rounded-md border border-border px-2 text-xs" />
                          <FormSubmitButton
                            pendingChildren="沖回中…"
                            pendingMessage="正在作廢月結並沖回佣金，請勿重複送出。"
                            className="h-9 rounded-md border border-border px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >標記作廢並沖回佣金</FormSubmitButton>
                        </form>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
      )}
    </>
  );
}
