import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorFinance } from "@/lib/auth";
import { monthRange } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "void") return "orange" as const;
  return "blue" as const;
}

function validMonthRange(monthKey: string) {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(monthKey)) return null;
  return monthRange(monthKey);
}

export default async function MerchantCoursePayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { vendor } = await requireVendorFinance(`/billing/course-payouts/${encodeURIComponent(id)}`);
  const db = getDb();
  const payout = await db.coursePayout.findFirst({
    where: { id, vendorId: vendor.id },
    include: {
      recipient: {
        include: { vendorMember: { include: { user: { select: { name: true } } } } },
      },
    },
  });
  if (!payout) notFound();

  const period = validMonthRange(payout.monthKey);
  const allocationScope = period ? {
    vendorId: vendor.id,
    recipientMembershipId: payout.recipientMembershipId,
    paymentTransaction: { occurredAt: { gte: period.start, lt: period.end } },
  } : null;
  const allocationCandidates = allocationScope ? await db.courseCommissionAllocation.findMany({
    where: {
      ...allocationScope,
    },
    orderBy: { createdAt: "desc" },
    take: 251,
    include: {
      product: { select: { name: true } },
      paymentTransaction: { select: { orderNumber: true, occurredAt: true } },
    },
  }) : [];
  const allocationTruncated = allocationCandidates.length > 250;
  const allocations = allocationCandidates.slice(0, 250);
  const allocationIds = allocations.map((allocation) => allocation.id);
  const [completeBalance, balanceRows, ledgerRows] = allocationScope ? await Promise.all([
    db.courseCommissionLedgerEntry.aggregate({
      where: { vendorId: vendor.id, allocation: allocationScope },
      _sum: { amountCents: true },
    }),
    db.courseCommissionLedgerEntry.groupBy({
      by: ["courseCommissionAllocationId"],
      where: { vendorId: vendor.id, courseCommissionAllocationId: { in: allocationIds } },
      _sum: { amountCents: true },
    }),
    db.courseCommissionLedgerEntry.findMany({
      where: { vendorId: vendor.id, courseCommissionAllocationId: { in: allocationIds } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 501,
    }),
  ]) : [{ _sum: { amountCents: null } }, [], []];
  const balancesByAllocation = new Map(balanceRows.map((row) => [row.courseCommissionAllocationId, row._sum.amountCents ?? 0]));
  const ledgerTruncated = ledgerRows.length > 500;
  const entriesByAllocation = new Map<string, typeof ledgerRows>();
  for (const entry of ledgerRows.slice(0, 500)) {
    const entries = entriesByAllocation.get(entry.courseCommissionAllocationId) ?? [];
    entries.push(entry);
    entriesByAllocation.set(entry.courseCommissionAllocationId, entries);
  }
  const ledgerBalance = completeBalance._sum.amountCents ?? 0;
  const reconciled = period !== null && ledgerBalance === payout.commissionAmountCents;

  return (
    <>
      <PageHeader title={`課程分潤 ${payout.monthKey}`} description="以 immutable allocation 與 append-only ledger 核對 F/G 分潤、退款、dispute 與 payout 結果。" />
      <div className="mb-4"><Link href="/billing/course-payouts" className="text-sm font-semibold text-primary hover:underline">← 返回課程分潤</Link></div>
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card><p className="text-sm text-slate-500">Recipient</p><p className="mt-2 font-semibold text-slate-950">{payout.recipient.vendorMember.user.name}</p></Card>
        <Card><p className="text-sm text-slate-500">Gross</p><p className="mt-2 text-xl font-bold text-slate-950">{payout.grossSalesAmountCents == null ? "未知" : formatCurrency(payout.grossSalesAmountCents)}</p></Card>
        <Card><p className="text-sm text-slate-500">Net reference</p><p className="mt-2 text-xl font-bold text-slate-950">{payout.netReferenceAmountCents == null ? "未知" : formatCurrency(payout.netReferenceAmountCents)}</p></Card>
        <Card><p className="text-sm text-slate-500">Payable</p><p className="mt-2 text-xl font-bold text-slate-950">{formatCurrency(payout.finalAmountCents)}</p><p className="mt-1 text-xs text-slate-500">分潤 {formatCurrency(payout.commissionAmountCents)} · 調整 {formatCurrency(payout.adjustmentAmountCents)}</p></Card>
      </div>
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="font-semibold text-slate-950">Payout outcome</h2><p className="mt-1 text-sm text-slate-600">{payout.outcomeReference ?? payout.outcomeReason ?? "尚未記錄"}{payout.paidAt ? ` · ${formatDateTime(payout.paidAt)}` : ""}</p></div>
          <Badge tone={statusTone(payout.status)}>{payout.status}</Badge>
        </div>
      </Card>
      {!period ? <p role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">此 payout 的月份格式無效，已停止 ledger 查詢並保留摘要供財務追查。</p> : (
        <p role={reconciled ? "status" : "alert"} className={`mb-6 rounded-md border px-3 py-2 text-sm ${reconciled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          Ledger balance {formatCurrency(ledgerBalance)}，payout commission {formatCurrency(payout.commissionAmountCents)}。{reconciled ? "金額一致。" : "金額不一致，請交由平台財務核對後再處理 payout。"}
        </p>
      )}
      {ledgerTruncated ? <p role="status" className="mb-6 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">Ledger 明細超過 500 筆；金額仍由完整 aggregate 對帳，此頁只顯示前 500 筆事件。</p> : null}
      {allocationTruncated ? <p role="status" className="mb-6 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">Allocation 超過 250 筆；金額仍由完整 aggregate 對帳，此頁只顯示最近 250 筆 allocation。</p> : null}

      {allocations.length === 0 ? <EmptyState title="此月份沒有 allocation ledger" description="目前沒有符合 recipient、商家與交易月份的課程分潤資料。" /> : (
        <div className="grid gap-4">
          {allocations.map((allocation) => {
            const balance = balancesByAllocation.get(allocation.id) ?? 0;
            const entries = entriesByAllocation.get(allocation.id) ?? [];
            return (
              <Card key={allocation.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold text-slate-950">{allocation.product.name}</h2><p className="mt-1 text-sm text-slate-600">訂單 {allocation.paymentTransaction.orderNumber} · {allocation.recipientRole} · {allocation.shareBps / 100}% · {formatDateTime(allocation.paymentTransaction.occurredAt)}</p></div>
                  <p className="font-bold text-slate-950">Balance {formatCurrency(balance, allocation.currency)}</p>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-slate-500">Gross base</dt><dd className="font-semibold">{formatCurrency(allocation.grossAmountCents, allocation.currency)}</dd></div><div><dt className="text-slate-500">Allocation snapshot</dt><dd className="font-semibold">{formatCurrency(allocation.amountCents, allocation.currency)}</dd></div><div><dt className="text-slate-500">Policy</dt><dd className="font-semibold">v{allocation.policyVersion}</dd></div></dl>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[840px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">時間</th><th className="px-3 py-2">事件</th><th className="px-3 py-2">金額</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Dispute case</th></tr></thead><tbody className="divide-y divide-border">{entries.map((entry) => <tr key={entry.id}><td className="px-3 py-2">{formatDateTime(entry.occurredAt)}</td><td className="px-3 py-2"><Badge tone={entry.amountCents < 0 ? "orange" : "blue"}>{entry.entryType}</Badge></td><td className="px-3 py-2 font-semibold">{formatCurrency(entry.amountCents, allocation.currency)}</td><td className="px-3 py-2">{entry.providerName}</td><td className="break-all px-3 py-2 text-slate-600">{entry.eventIdentity}</td><td className="break-all px-3 py-2 text-slate-600">{entry.disputeCaseId ?? "-"}</td></tr>)}</tbody></table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
