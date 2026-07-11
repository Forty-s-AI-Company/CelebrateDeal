import { reviewExternalOrderEvidenceAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

export default async function AdminExternalOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;
  await requirePlatformAdmin();
  const evidence = await getDb().externalOrderEvidence.findMany({
    include: { vendor: true, affiliate: true, product: true, submittedBy: true },
    orderBy: [{ status: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  return (
    <>
      <PageHeader title="外部訂單審核" description="只有確認具備外部訂單證據的項目才會建立 approved 佣金；點擊紀錄本身不構成成交。" />
      {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">審核結果已寫入佣金帳本與 audit log。</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">審核失敗，資料可能已由其他管理員處理或關聯已失效。</p> : null}

      {evidence.length === 0 ? (
        <EmptyState title="沒有待審外部訂單" description="商家提交的外部訂單證據會出現在這裡。" />
      ) : (
        <div className="grid gap-4">
          {evidence.map((item) => (
            <Card key={item.id}>
              <div className="grid gap-4 xl:grid-cols-[1fr_1fr_auto] xl:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-slate-950">{item.externalOrderReference}</h2><Badge tone={item.status === "confirmed" ? "green" : item.status === "pending_review" ? "orange" : "gray"}>{item.status}</Badge></div>
                  <p className="mt-2 text-sm text-slate-600">{item.vendor.name} · {item.product.name}</p>
                  <p className="mt-1 text-xs text-slate-500">提交者 {item.submittedBy.email} · {formatDateTime(item.createdAt)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-slate-500">推廣者</p><p className="mt-1 font-semibold">{item.affiliate.name}</p><p className="text-xs text-slate-500">{item.referralCode}</p></div>
                  <div><p className="text-xs text-slate-500">證據快照</p><p className="mt-1 font-semibold">{formatCurrency(item.amountCents, item.currency)}</p><p className="text-xs text-slate-500">佣金 {item.commissionRateBps / 100}%</p></div>
                </div>
                {item.status === "pending_review" ? (
                  <form action={reviewExternalOrderEvidenceAction} className="grid min-w-[240px] gap-2">
                    <CsrfField />
                    <input type="hidden" name="evidenceId" value={item.id} />
                    <input name="reviewNote" maxLength={500} placeholder="審核備註（選填）" className="h-9 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
                    <div className="grid grid-cols-2 gap-2">
                      <button name="decision" value="rejected" className="h-9 rounded-md border border-red-200 text-sm font-semibold text-red-700 hover:bg-red-50">拒絕</button>
                      <button name="decision" value="confirmed" className="h-9 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">確認成交</button>
                    </div>
                  </form>
                ) : <p className="text-sm text-slate-500">{item.reviewNote ?? "已完成審核"}</p>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
