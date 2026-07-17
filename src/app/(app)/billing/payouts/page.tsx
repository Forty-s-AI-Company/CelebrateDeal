import { Download, Landmark } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "executed" || status === "paid") return "green" as const;
  if (status.includes("fail")) return "orange" as const;
  if (status.includes("review")) return "blue" as const;
  return "gray" as const;
}

export default async function BillingPayoutsPage() {
  const vendor = await requireVendor();
  const batches = await getDb().payoutBatch.findMany({
    where: { items: { some: { vendorId: vendor.id } } },
    orderBy: { batchDate: "desc" },
    include: {
      items: {
        where: { vendorId: vendor.id },
        include: { vendor: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const pendingCount = batches.flatMap((batch) => batch.items).filter((item) => item.status !== "paid").length;

  return (
    <>
      <PageHeader
        title="批次出款"
        description="每月固定日產生待出款清單，支援人工覆核、鎖單、匯出銀行批次轉帳檔與失敗重送紀錄。"
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm font-medium text-slate-500">出款批次</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{batches.length}</p>
        </Card>
        <Card className="bg-gradient-to-br from-white to-orange-50">
          <p className="text-sm font-medium text-slate-500">待覆核筆數</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{pendingCount}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">匯出格式</p>
          <p className="mt-2 text-sm text-slate-600">MVP 先保留 CSV 匯出路徑，正式版接銀行指定格式。</p>
        </Card>
      </div>

      {batches.length === 0 ? (
        <EmptyState title="尚無出款批次" description="產生月結並排定出款日後，這裡會列出批次與每筆銀行轉帳項目。" />
      ) : (
        <div className="grid gap-5">
          {batches.map((batch) => (
            <Card key={batch.id} className="overflow-hidden p-0">
              <div className="flex flex-col gap-3 border-b border-border px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-950">{batch.batchNumber}</h2>
                    <Badge tone={statusTone(batch.status)}>{batch.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    批次日 {formatDateTime(batch.batchDate)} · {batch.items.length} 筆 · {formatCurrency(batch.items.reduce((total, item) => total + item.payoutAmountCents, 0))}
                  </p>
                </div>
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <Download size={16} />
                  匯出銀行檔
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3">商家</th>
                      <th className="px-5 py-3">銀行</th>
                      <th className="px-5 py-3">戶名</th>
                      <th className="px-5 py-3">金額</th>
                      <th className="px-5 py-3">狀態</th>
                      <th className="px-5 py-3">失敗原因</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {batch.items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-4 font-semibold text-slate-950">{item.vendor.name}</td>
                        <td className="px-5 py-4">
                          <Landmark className="mr-2 inline text-slate-400" size={16} />
                          {item.bankCode} / {item.bankAccountNumber}
                        </td>
                        <td className="px-5 py-4">{item.bankAccountName}</td>
                        <td className="px-5 py-4 font-bold text-slate-950">{formatCurrency(item.payoutAmountCents)}</td>
                        <td className="px-5 py-4"><Badge tone={statusTone(item.status)}>{item.status}</Badge></td>
                        <td className="px-5 py-4 text-slate-500">{item.failReason ?? "-"}</td>
                      </tr>
                    ))}
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
