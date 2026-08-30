import { recordCoursePayoutOutcomeAction } from "@/app/actions/course-payout-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "void") return "orange" as const;
  return "blue" as const;
}

export default async function AdminCoursePayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireFinanceAdmin();
  const { error } = await searchParams;
  const payouts = await getDb().coursePayout.findMany({
    orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
    include: {
      vendor: true,
      recipient: { include: { vendorMember: { include: { user: true } } } },
    },
  });
  const pending = payouts.filter((payout) => payout.status === "pending");
  const pendingAmount = pending.reduce((sum, payout) => sum + payout.finalAmountCents, 0);

  return (
    <>
      <PageHeader
        title="課程 F/G payable"
        description="按 immutable F/G allocation snapshot 彙整商家應付金額；gross 分潤基礎、provider-net 參考與 payable 分開顯示。paid 只代表人工 outcome 已記錄，不代表銀行、KYC 或稅務已完成。"
      />
      {error ? <p className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">課程 payout 操作未完成，請重新整理後依目前狀態處理。</p> : null}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm font-medium text-slate-500">待處理筆數</p><p className="mt-2 text-3xl font-bold text-slate-950">{pending.length}</p></Card>
        <Card><p className="text-sm font-medium text-slate-500">待處理金額</p><p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(pendingAmount)}</p></Card>
        <Card><p className="text-sm font-medium text-slate-500">資料邊界</p><p className="mt-2 text-sm text-slate-600">人工覆核／reference；不讀取或保存銀行密碼資料。</p></Card>
      </div>

      {payouts.length === 0 ? (
        <EmptyState title="尚無課程 payable" description="先鎖定包含課程 F/G allocation 的商家月結，系統才會建立這裡的 read model。" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1280px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">月份／商家</th><th className="px-5 py-3">Recipient</th><th className="px-5 py-3">Gross 分潤基礎</th><th className="px-5 py-3">Net 參考</th><th className="px-5 py-3">Payable</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">Outcome</th><th className="px-5 py-3">操作</th></tr></thead>
            <tbody className="divide-y divide-border">
              {payouts.map((payout) => {
                const recipient = payout.recipient.vendorMember.user;
                return (
                  <tr key={payout.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-5 py-4"><p className="font-semibold text-slate-950">{payout.monthKey}</p><p className="mt-1 text-xs text-slate-500">{payout.vendor.name} · {formatDateTime(payout.createdAt)}</p></td>
                    <td className="px-5 py-4"><p className="font-semibold text-slate-950">{recipient.name}</p><p className="mt-1 text-xs text-slate-500">{recipient.email}</p></td>
                    <td className="px-5 py-4"><p className="font-semibold text-slate-950">{payout.grossSalesAmountCents == null ? "-" : formatCurrency(payout.grossSalesAmountCents)}</p><p className="mt-1 text-xs text-slate-500">按售價計算，不是扣費後金額</p></td>
                    <td className="px-5 py-4"><p className="font-semibold text-slate-950">{payout.netReferenceAmountCents == null ? "-" : formatCurrency(payout.netReferenceAmountCents)}</p><p className="mt-1 text-xs text-slate-500">provider reference，僅供參考</p></td>
                    <td className="px-5 py-4 font-bold text-slate-950">{formatCurrency(payout.finalAmountCents)}</td>
                    <td className="px-5 py-4"><Badge tone={statusTone(payout.status)}>{payout.status}</Badge></td>
                    <td className="px-5 py-4 text-slate-500">{payout.outcomeReference ?? payout.outcomeReason ?? "-"}</td>
                    <td className="px-5 py-4">
                      {payout.status === "pending" ? (
                        <div className="grid gap-2">
                          <form action={recordCoursePayoutOutcomeAction} className="flex flex-wrap gap-2"><CsrfField /><input type="hidden" name="id" value={payout.id} /><input type="hidden" name="status" value="paid" /><input name="outcomeReference" required maxLength={200} placeholder="人工 reference" className="h-9 w-40 rounded-md border border-border px-2 text-xs" /><FormSubmitButton pendingChildren="記錄中…" pendingMessage="正在記錄課程 payout 已付款結果，請勿重複送出。" confirmMessage="確認人工出款已完成，並將這筆課程 payout 標記為 paid？" className="h-9 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700">記錄 paid</FormSubmitButton></form>
                          <form action={recordCoursePayoutOutcomeAction} className="flex flex-wrap gap-2"><CsrfField /><input type="hidden" name="id" value={payout.id} /><input type="hidden" name="status" value="void" /><input name="outcomeReason" required maxLength={500} placeholder="void 原因" className="h-9 w-40 rounded-md border border-border px-2 text-xs" /><FormSubmitButton pendingChildren="作廢中…" pendingMessage="正在作廢課程 payout 並寫入沖回紀錄，請勿重複送出。" confirmMessage="確認作廢這筆課程 payout？系統會依 immutable ledger 寫入沖回紀錄。" className="h-9 rounded-md bg-orange-600 px-3 text-xs font-semibold text-white hover:bg-orange-700">記錄 void</FormSubmitButton></form>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
