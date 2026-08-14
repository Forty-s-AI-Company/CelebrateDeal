import Link from "next/link";

import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

export default async function AdminSupportCasesPage() {
  await requireFinanceAdmin();
  const handoffs = await getDb().supportRefundHandoff.findMany({
    include: {
      vendor: { select: { name: true } },
      supportCase: { select: { caseNumber: true, priority: true, status: true } },
      order: { select: { orderNumber: true, currency: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 300,
  });

  return (
    <>
      <PageHeader title="退款客服交接" description="平台財務只在這裡檢視商家請求；真正退款仍走既有 provider reservation／MFA／reconciliation 流程。" />
      {handoffs.length === 0 ? <EmptyState title="目前沒有退款交接" description="商家從 tenant-scoped 客服案件送出後，請求會顯示在這裡。" /> : (
        <div className="grid gap-3">
          {handoffs.map((handoff) => (
            <Link key={handoff.id} href={`/admin/support-cases/${encodeURIComponent(handoff.id)}`} className="rounded-lg border border-border bg-white p-4 shadow-sm hover:bg-slate-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">{handoff.supportCase.caseNumber} · {handoff.vendor.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">訂單 {handoff.order.orderNumber}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={handoff.supportCase.priority === "p0" ? "red" : handoff.supportCase.priority === "p1" ? "orange" : "gray"}>{handoff.supportCase.priority.toUpperCase()}</Badge>
                  <Badge tone={handoff.status === "completed" ? "green" : handoff.status === "declined" ? "red" : "orange"}>{handoff.status}</Badge>
                  <b>{formatCurrency(handoff.requestedAmountCents, handoff.order.currency)}</b>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
