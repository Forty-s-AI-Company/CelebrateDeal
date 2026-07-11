import {
  approveAffiliateCommissionAction,
  createAffiliatePayoutAction,
  createManualCommissionAdjustmentAction,
  transitionAffiliatePayoutAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function tone(status: string) {
  if (status === "paid" || status === "approved") return "green" as const;
  if (status === "reversed") return "orange" as const;
  if (status === "locked") return "blue" as const;
  return "gray" as const;
}

export default async function AdminAffiliatePayoutsPage() {
  await requirePlatformAdmin();
  const db = getDb();
  const [lockedGroups, payouts, pendingCommissions, affiliates] = await Promise.all([
    db.affiliateCommission.groupBy({
      by: ["vendorId", "affiliateId", "monthKey"],
      where: { status: "locked", affiliateId: { not: null }, affiliatePayoutId: null },
      _sum: { commissionAmountCents: true },
      _count: { _all: true },
      orderBy: [{ monthKey: "desc" }],
    }),
    db.affiliatePayout.findMany({
      include: { vendor: true, affiliate: true, _count: { select: { commissions: true } } },
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.affiliateCommission.findMany({
      where: { status: "pending", affiliateId: { not: null } },
      include: { vendor: true, affiliate: true },
      orderBy: { attributedAt: "desc" },
      take: 30,
    }),
    db.affiliate.findMany({ where: { isActive: true }, include: { vendor: true }, orderBy: [{ vendorId: "asc" }, { name: "asc" }] }),
  ]);
  const vendorIds = [...new Set(lockedGroups.map((group) => group.vendorId))];
  const affiliateIds = lockedGroups.flatMap((group) => group.affiliateId ? [group.affiliateId] : []);
  const [vendors, lockedAffiliates] = await Promise.all([
    db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } }),
    db.affiliate.findMany({ where: { id: { in: affiliateIds } }, select: { id: true, name: true } }),
  ]);
  const vendorNames = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));
  const affiliateNames = new Map(lockedAffiliates.map((affiliate) => [affiliate.id, affiliate.name]));

  return (
    <>
      <PageHeader title="聯盟佣金與出款" description="將已鎖定佣金建立為固定出款集合，依序覆核、付款或付款前沖銷；所有操作保留 audit log。" />

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h2 className="text-lg font-semibold text-slate-950">可建立出款</h2>
          <div className="mt-4 grid gap-3">
            {lockedGroups.length === 0 ? <p className="text-sm text-slate-500">目前沒有尚未建立出款的 locked commissions。</p> : lockedGroups.map((group) => group.affiliateId ? (
              <form key={`${group.vendorId}-${group.affiliateId}-${group.monthKey}`} action={createAffiliatePayoutAction} className="grid gap-3 border-b border-border py-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                <CsrfField />
                <input type="hidden" name="vendorId" value={group.vendorId} />
                <input type="hidden" name="affiliateId" value={group.affiliateId} />
                <input type="hidden" name="monthKey" value={group.monthKey} />
                <div><p className="font-semibold text-slate-950">{affiliateNames.get(group.affiliateId) ?? "未知推廣者"}</p><p className="text-sm text-slate-500">{vendorNames.get(group.vendorId) ?? group.vendorId} · {group.monthKey} · {group._count._all} 筆</p></div>
                <p className="font-bold text-slate-950">{formatCurrency(group._sum.commissionAmountCents ?? 0)}</p>
                <button className="h-9 rounded-md bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark">建立出款</button>
              </form>
            ) : null)}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-950">人工調整</h2>
          <form action={createManualCommissionAdjustmentAction} className="mt-4 grid gap-3">
            <CsrfField />
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">推廣者<select name="affiliateId" required className="h-10 rounded-md border border-border bg-white px-3 text-sm">{affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.id}>{affiliate.vendor.name} · {affiliate.name}</option>)}</select></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium text-slate-700">月份<input name="monthKey" type="month" required className="h-10 rounded-md border border-border px-3" /></label><label className="grid gap-1.5 text-sm font-medium text-slate-700">調整金額<input name="amount" type="number" step="1" required className="h-10 rounded-md border border-border px-3" /></label></div>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">原因<input name="reason" required maxLength={120} className="h-10 rounded-md border border-border px-3" /></label>
            <button className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">新增 adjustment</button>
          </form>
        </Card>
      </div>

      <Card className="mb-6 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold text-slate-950">待核准佣金</h2></div>
        {pendingCommissions.length === 0 ? <div className="p-5"><EmptyState title="沒有待核准佣金" description="可信 paid webhook 建立的佣金會先進入 pending。" /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">推廣者</th><th className="px-5 py-3">訂單</th><th className="px-5 py-3">月份</th><th className="px-5 py-3">佣金</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-border">{pendingCommissions.map((commission) => <tr key={commission.id}><td className="px-5 py-4"><p className="font-semibold">{commission.affiliate?.name}</p><p className="text-xs text-slate-500">{commission.vendor.name}</p></td><td className="px-5 py-4">{commission.orderNumber ?? commission.sourceId}</td><td className="px-5 py-4">{commission.monthKey}</td><td className="px-5 py-4 font-semibold">{formatCurrency(commission.commissionAmountCents)}</td><td className="px-5 py-4 text-right"><form action={approveAffiliateCommissionAction}><CsrfField /><input type="hidden" name="id" value={commission.id} /><button className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-slate-50">核准</button></form></td></tr>)}</tbody></table></div>}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold text-slate-950">出款批次</h2></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">推廣者</th><th className="px-5 py-3">月份</th><th className="px-5 py-3">明細</th><th className="px-5 py-3">金額</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">更新</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-border">{payouts.map((payout) => <tr key={payout.id}><td className="px-5 py-4"><p className="font-semibold">{payout.affiliate?.name ?? "未綁定"}</p><p className="text-xs text-slate-500">{payout.vendor.name}</p></td><td className="px-5 py-4">{payout.monthKey}</td><td className="px-5 py-4">{payout._count.commissions} 筆</td><td className="px-5 py-4 font-semibold">{formatCurrency(payout.finalAmountCents)}</td><td className="px-5 py-4"><Badge tone={tone(payout.status)}>{payout.status}</Badge></td><td className="px-5 py-4 text-slate-500">{formatDateTime(payout.paidAt ?? payout.approvedAt ?? payout.createdAt)}</td><td className="px-5 py-4"><div className="flex justify-end gap-2">{payout.status === "pending" ? <><PayoutAction id={payout.id} status="approved" label="核准" /><PayoutAction id={payout.id} status="reversed" label="沖銷" /></> : null}{payout.status === "approved" ? <><PayoutAction id={payout.id} status="paid" label="標記已付" /><PayoutAction id={payout.id} status="reversed" label="沖銷" /></> : null}</div></td></tr>)}</tbody></table></div>
      </Card>
    </>
  );
}

function PayoutAction({ id, status, label }: { id: string; status: "approved" | "paid" | "reversed"; label: string }) {
  return <form action={transitionAffiliatePayoutAction}><CsrfField /><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} /><button className="h-9 rounded-md border border-border px-3 text-xs font-semibold hover:bg-slate-50">{label}</button></form>;
}
