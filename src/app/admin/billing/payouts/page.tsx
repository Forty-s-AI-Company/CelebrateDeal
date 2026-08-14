import Link from "next/link";
import { Download, Landmark, RotateCcw } from "lucide-react";
import { markPayoutBatchExportedAction, updatePayoutItemStatusAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { maskBankAccount } from "@/lib/bank-account";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "completed" || status === "paid") return "green" as const;
  if (status === "failed") return "orange" as const;
  if (status === "exported" || status === "retrying") return "blue" as const;
  return "gray" as const;
}

export default async function AdminBillingPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireFinanceAdmin();
  const { error } = await searchParams;
  const batches = await getDb().payoutBatch.findMany({
    orderBy: { batchDate: "desc" },
    include: {
      items: {
        include: { vendor: true, settlement: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return (
    <>
      <PageHeader
        title="平台批次出款"
        description="覆核銀行批次轉帳檔、記錄出款成功或失敗，並保留重送狀態。"
        action={<div className="flex flex-wrap gap-4"><Link href="/admin/billing/settlements" className="text-sm font-semibold text-primary hover:underline">回月結管理</Link><Link href="/admin/billing/course-payouts" className="text-sm font-semibold text-primary hover:underline">課程 F/G payable</Link><Link href="/admin/billing/platform-referral-payouts" className="text-sm font-semibold text-primary hover:underline">Platform referral payable</Link></div>}
      />
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          出款狀態更新未執行；請重新整理後依目前狀態操作，失敗項目必須填寫原因。
        </p>
      ) : null}

      {batches.length === 0 ? (
        <EmptyState title="尚無出款批次" description="請先在月結管理鎖定 settlement，再建立出款批次。" />
      ) : (
        <div className="grid gap-6">
          {batches.map((batch) => (
            <Card key={batch.id} className="overflow-hidden p-0">
              <div className="flex flex-col gap-3 border-b border-border px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-950">{batch.batchNumber}</h2>
                    <Badge tone={statusTone(batch.status)}>{batch.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDateTime(batch.batchDate)} · {batch.totalCount} 筆 · {formatCurrency(batch.totalAmountCents)}
                    {batch.exportedAt ? ` · 已匯出 ${formatDateTime(batch.exportedAt)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {batch.status === "draft" ? (
                    <form action={markPayoutBatchExportedAction}>
                      <CsrfField />
                      <input type="hidden" name="id" value={batch.id} />
                      <FormSubmitButton
                        pendingChildren="標記中…"
                        pendingMessage="正在標記批次匯出狀態，請勿重複送出。"
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Download size={16} />
                        標記已匯出
                      </FormSubmitButton>
                    </form>
                  ) : null}
                  <Link href={`/admin/billing/payouts/${batch.id}/csv`} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
                    <Download size={16} />
                    下載 CSV
                  </Link>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1160px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3">商家</th>
                      <th className="px-5 py-3">銀行</th>
                      <th className="px-5 py-3">戶名</th>
                      <th className="px-5 py-3">金額</th>
                      <th className="px-5 py-3">狀態</th>
                      <th className="px-5 py-3">出款 reference</th>
                      <th className="px-5 py-3">失敗原因</th>
                      <th className="px-5 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {batch.items.map((item) => {
                      const bankAccount = maskBankAccount({
                        accountName: item.bankAccountDisplayName,
                        bankCode: item.bankCodeDisplay,
                        accountNumber: item.bankAccountDisplayNumber,
                      });
                      return (
                      <tr key={item.id} className="align-top hover:bg-slate-50/70">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-950">{item.vendor.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{item.settlement?.monthKey ?? "未綁定月結"}</p>
                        </td>
                        <td className="px-5 py-4">
                          <Landmark className="mr-2 inline text-slate-400" size={16} />
                          {bankAccount.bankCode} / {bankAccount.accountNumber}
                        </td>
                        <td className="px-5 py-4">{bankAccount.accountName}</td>
                        <td className="px-5 py-4 font-bold text-slate-950">{formatCurrency(item.payoutAmountCents)}</td>
                        <td className="px-5 py-4">
                          <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                          {item.retryCount > 0 ? <p className="mt-1 text-xs text-slate-500"><RotateCcw className="mr-1 inline" size={12} />重送 {item.retryCount} 次</p> : null}
                        </td>
                        <td className="max-w-52 break-all px-5 py-4 text-xs text-slate-600">{item.outcomeReference ?? "-"}</td>
                        <td className="px-5 py-4 text-slate-500">{item.failReason ?? "-"}</td>
                        <td className="px-5 py-4">
                          <div className="grid gap-2">
                            {item.status === "pending" || item.status === "retrying" ? (
                              <>
                                <form action={updatePayoutItemStatusAction} className="flex flex-wrap gap-2">
                                  <CsrfField />
                                  <input type="hidden" name="id" value={item.id} />
                                  <input type="hidden" name="status" value="paid" />
                                  <input name="outcomeReference" required maxLength={200} placeholder="人工出款 reference" className="h-9 w-44 rounded-md border border-border px-2 text-xs" />
                                  <FormSubmitButton
                                    pendingChildren="更新中…"
                                    pendingMessage="正在記錄平台出款結果，請勿重複送出。"
                                    className="h-9 rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700"
                                  >標記 paid</FormSubmitButton>
                                </form>
                                <form action={updatePayoutItemStatusAction} className="flex flex-wrap gap-2">
                                  <CsrfField />
                                  <input type="hidden" name="id" value={item.id} />
                                  <input type="hidden" name="status" value="failed" />
                                  <input name="failReason" required maxLength={500} placeholder="失敗原因" className="h-9 w-40 rounded-md border border-border px-2 text-xs" />
                                  <FormSubmitButton
                                    pendingChildren="更新中…"
                                    pendingMessage="正在記錄平台出款失敗，請勿重複送出。"
                                    className="h-9 rounded-md bg-orange-600 px-3 text-xs font-semibold text-white hover:bg-orange-700"
                                  >標記 failed</FormSubmitButton>
                                </form>
                              </>
                            ) : null}
                            {item.status === "failed" ? (
                              <form action={updatePayoutItemStatusAction}>
                                <CsrfField />
                                <input type="hidden" name="id" value={item.id} />
                                <input type="hidden" name="status" value="retrying" />
                                <FormSubmitButton
                                  pendingChildren="更新中…"
                                  pendingMessage="正在把出款項目切換為重試狀態，請勿重複送出。"
                                  className="h-9 rounded-md border border-border px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >標記 retry</FormSubmitButton>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
