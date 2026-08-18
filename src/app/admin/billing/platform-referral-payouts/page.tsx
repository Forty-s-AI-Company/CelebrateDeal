import { createPlatformReferralPayoutBatchAction, recordPlatformReferralPayoutOutcomeAction } from "@/app/actions/platform-referral-payout-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "void") return "orange" as const;
  if (status === "batched") return "blue" as const;
  return "gray" as const;
}

export default async function AdminPlatformReferralPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireFinanceAdmin();
  const { error } = await searchParams;
  const payouts = await getDb().platformReferralPayout.findMany({
    orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
    include: { owner: true, payoutBatch: true },
  });
  const open = payouts.filter((payout) => payout.status === "pending" || payout.status === "batched");
  const openAmount = open.reduce((sum, payout) => sum + payout.finalAmountCents, 0);

  return (
    <>
      <PageHeader
        title="Platform referral payable"
        description="按 immutable platform referral ledger 彙整推薦人應付金額；batch／paid 只代表本機人工 outcome，不代表銀行、KYC、稅務或外部轉帳已完成。"
      />
      {error ? <p className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">平台推薦 payout 操作未完成，請重新整理後依目前狀態處理。</p> : null}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card><p className="text-sm font-medium text-slate-500">待處理筆數</p><p className="mt-2 text-3xl font-bold text-slate-950">{open.length}</p></Card>
        <Card><p className="text-sm font-medium text-slate-500">待處理金額</p><p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(openAmount)}</p></Card>
        <Card><p className="text-sm font-medium text-slate-500">資料邊界</p><p className="mt-2 text-sm text-slate-600">人工覆核／reference；不讀取或保存銀行 credential。</p></Card>
      </div>

      <Card className="mb-6">
        <h2 className="font-semibold text-slate-950">建立本機 payout batch</h2>
        <p className="mt-1 text-sm text-slate-500">只同步 immutable ledger 與建立人工覆核批次，不會呼叫銀行或付款 provider。</p>
        <form action={createPlatformReferralPayoutBatchAction} className="mt-4 flex flex-wrap gap-2">
          <CsrfField />
          <input name="monthKey" required pattern="[0-9]{4}-(0[1-9]|1[0-2])" placeholder="2026-07" className="h-10 rounded-md border border-border px-3 text-sm" />
          <input name="batchNumber" required maxLength={120} placeholder="PRP-202607-001" className="h-10 w-48 rounded-md border border-border px-3 text-sm" />
          <FormSubmitButton pendingChildren="建立中…" pendingMessage="正在同步平台推薦 ledger 並建立 payout batch，請勿重複送出。" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">建立 batch</FormSubmitButton>
        </form>
      </Card>

      {payouts.length === 0 ? (
        <EmptyState title="尚無 platform referral payable" description="先同步 platform referral commission ledger，系統才會建立 owner／month read model。" />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">月份</th><th className="px-5 py-3">推薦人</th><th className="px-5 py-3">金額</th><th className="px-5 py-3">Batch</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">Outcome</th><th className="px-5 py-3">操作</th></tr></thead>
            <tbody className="divide-y divide-border">
              {payouts.map((payout) => (
                <tr key={payout.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-5 py-4"><p className="font-semibold text-slate-950">{payout.monthKey}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(payout.createdAt)}</p></td>
                  <td className="px-5 py-4"><p className="font-semibold text-slate-950">{payout.owner.name}</p><p className="mt-1 text-xs text-slate-500">{payout.owner.email}</p></td>
                  <td className="px-5 py-4 font-bold text-slate-950">{formatCurrency(payout.finalAmountCents)}</td>
                  <td className="px-5 py-4 text-slate-500">{payout.payoutBatch?.batchNumber ?? "-"}</td>
                  <td className="px-5 py-4"><Badge tone={statusTone(payout.status)}>{payout.status}</Badge></td>
                  <td className="px-5 py-4 text-slate-500">{payout.outcomeReference ?? payout.outcomeReason ?? "-"}</td>
                  <td className="px-5 py-4">
                    {payout.status === "batched" ? (
                      <div className="grid gap-2">
                        <form action={recordPlatformReferralPayoutOutcomeAction} className="flex flex-wrap gap-2"><CsrfField /><input type="hidden" name="id" value={payout.id} /><input type="hidden" name="status" value="paid" /><input name="outcomeReference" required maxLength={200} placeholder="人工 reference" className="h-9 w-40 rounded-md border border-border px-2 text-xs" /><FormSubmitButton pendingChildren="記錄中…" pendingMessage="正在記錄平台推薦 payout 已付款結果，請勿重複送出。" confirmMessage="確認人工出款已完成，並將這筆平台推薦 payout 標記為 paid？" className="h-9 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800">記錄 paid</FormSubmitButton></form>
                        <form action={recordPlatformReferralPayoutOutcomeAction} className="flex flex-wrap gap-2"><CsrfField /><input type="hidden" name="id" value={payout.id} /><input type="hidden" name="status" value="void" /><input name="outcomeReason" required maxLength={500} placeholder="void 原因" className="h-9 w-40 rounded-md border border-border px-2 text-xs" /><FormSubmitButton pendingChildren="作廢中…" pendingMessage="正在作廢平台推薦 payout 並寫入沖回紀錄，請勿重複送出。" confirmMessage="確認作廢這筆平台推薦 payout？系統會依 immutable ledger 寫入沖回紀錄。" className="h-9 rounded-md bg-cta px-3 text-xs font-semibold text-white hover:bg-cta-dark">記錄 void</FormSubmitButton></form>
                      </div>
                    ) : payout.status === "pending" ? (
                      <form action={recordPlatformReferralPayoutOutcomeAction} className="flex flex-wrap gap-2"><CsrfField /><input type="hidden" name="id" value={payout.id} /><input type="hidden" name="status" value="void" /><input name="outcomeReason" required maxLength={500} placeholder="void 原因" className="h-9 w-40 rounded-md border border-border px-2 text-xs" /><FormSubmitButton pendingChildren="作廢中…" pendingMessage="正在作廢待批次的平台推薦 payout，請勿重複送出。" confirmMessage="確認作廢這筆尚未批次的平台推薦 payout？" className="h-9 rounded-md bg-cta px-3 text-xs font-semibold text-white hover:bg-cta-dark">記錄 void</FormSubmitButton></form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
