import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorFinance } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "paid") return "green" as const;
  if (status === "void") return "orange" as const;
  return "blue" as const;
}

function validMonthKey(monthKey: string) {
  return /^20\d{2}-(?:0[1-9]|1[0-2])$/u.test(monthKey);
}

export default async function AffiliatePayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { vendor } = await requireVendorFinance(`/affiliates/commissions/${encodeURIComponent(id)}`);
  const db = getDb();
  const payout = await db.affiliatePayout.findFirst({
    where: { id, vendorId: vendor.id },
    include: { affiliate: { select: { id: true, name: true, code: true } } },
  });
  if (!payout) notFound();

  const monthIsValid = validMonthKey(payout.monthKey);
  const commissionScope = monthIsValid ? {
    vendorId: vendor.id,
    affiliateId: payout.affiliateId,
    monthKey: payout.monthKey,
  } : null;
  const commissionCandidates = commissionScope ? await db.affiliateCommission.findMany({
    where: commissionScope,
    orderBy: [{ attributedAt: "desc" }, { id: "desc" }],
    take: 251,
  }) : [];
  const commissionTruncated = commissionCandidates.length > 250;
  const commissions = commissionCandidates.slice(0, 250);
  const commissionIds = commissions.map((commission) => commission.id);
  const [completeBalance, visibleBalances, ledgerCandidates, sourceTotals] = commissionScope ? await Promise.all([
    db.affiliateCommissionLedgerEntry.aggregate({
      where: { vendorId: vendor.id, commission: commissionScope },
      _sum: { amountCents: true },
    }),
    db.affiliateCommissionLedgerEntry.groupBy({
      by: ["affiliateCommissionId"],
      where: { vendorId: vendor.id, affiliateCommissionId: { in: commissionIds } },
      _sum: { amountCents: true },
    }),
    db.affiliateCommissionLedgerEntry.findMany({
      where: { vendorId: vendor.id, affiliateCommissionId: { in: commissionIds } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 501,
    }),
    db.affiliateCommission.aggregate({
      where: commissionScope,
      _sum: {
        commissionBaseAmountCents: true,
        netReferenceAmountCents: true,
      },
    }),
  ]) : [
    { _sum: { amountCents: null } },
    [],
    [],
    { _sum: { commissionBaseAmountCents: null, netReferenceAmountCents: null } },
  ];
  const balancesByCommission = new Map(visibleBalances.map((row) => [
    row.affiliateCommissionId,
    row._sum.amountCents ?? 0,
  ]));
  const ledgerTruncated = ledgerCandidates.length > 500;
  const entriesByCommission = new Map<string, typeof ledgerCandidates>();
  for (const entry of ledgerCandidates.slice(0, 500)) {
    const entries = entriesByCommission.get(entry.affiliateCommissionId) ?? [];
    entries.push(entry);
    entriesByCommission.set(entry.affiliateCommissionId, entries);
  }
  const ledgerBalance = completeBalance._sum.amountCents ?? 0;
  const expectedLedgerBalance = payout.status === "void" ? 0 : payout.commissionAmountCents;
  const reconciled = monthIsValid && ledgerBalance === expectedLedgerBalance;

  return (
    <>
      <PageHeader
        title={`聯盟月結 ${payout.monthKey}`}
        description="以商家、推廣者、月份與 append-only ledger 核對佣金、退款、dispute 與 payout 結果。"
      />
      <div className="mb-4">
        <Link href="/affiliates/commissions" className="text-sm font-semibold text-primary hover:underline">← 返回聯盟分潤</Link>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card><p className="text-sm text-slate-500">推廣者</p><p className="mt-2 font-semibold text-slate-950">{payout.affiliate.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{payout.affiliate.code}</p></Card>
        <Card><p className="text-sm text-slate-500">Gross snapshot</p><p className="mt-2 text-xl font-bold text-slate-950">{payout.grossSalesAmountCents == null ? "未知" : formatCurrency(payout.grossSalesAmountCents)}</p><p className="mt-1 text-xs text-slate-500">目前來源合計 {formatCurrency(sourceTotals._sum.commissionBaseAmountCents ?? 0)}</p></Card>
        <Card><p className="text-sm text-slate-500">Net reference snapshot</p><p className="mt-2 text-xl font-bold text-slate-950">{payout.netReferenceAmountCents == null ? "未知" : formatCurrency(payout.netReferenceAmountCents)}</p><p className="mt-1 text-xs text-slate-500">目前來源合計 {formatCurrency(sourceTotals._sum.netReferenceAmountCents ?? 0)}</p></Card>
        <Card><p className="text-sm text-slate-500">Payable</p><p className="mt-2 text-xl font-bold text-slate-950">{formatCurrency(payout.finalAmountCents)}</p><p className="mt-1 text-xs text-slate-500">佣金 {formatCurrency(payout.commissionAmountCents)} · 調整 {formatCurrency(payout.adjustmentAmountCents)}</p></Card>
      </div>

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">Payout outcome</h2>
            <dl className="mt-2 grid gap-2 text-sm text-slate-600">
              <div><dt className="inline font-medium text-slate-700">Reference：</dt><dd className="inline break-all">{payout.outcomeReference ?? "未記錄"}</dd></div>
              <div><dt className="inline font-medium text-slate-700">付款備註／作廢原因：</dt><dd className="inline">{payout.outcomeReason ?? "未記錄"}</dd></div>
              <div><dt className="inline font-medium text-slate-700">完成時間：</dt><dd className="inline">{payout.paidAt ? formatDateTime(payout.paidAt) : "未記錄"}</dd></div>
              {payout.payoutItemId ? <div><dt className="inline font-medium text-slate-700">處理方式：</dt><dd className="inline">已交由平台 payout item 管理，商家頁不提供人工結果操作。</dd></div> : null}
            </dl>
          </div>
          <Badge tone={statusTone(payout.status)}>{payout.status}</Badge>
        </div>
      </Card>

      {!monthIsValid ? (
        <p role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">此 payout 的月份格式無效，已停止 ledger 查詢並保留摘要供財務追查。</p>
      ) : (
        <p role={reconciled ? "status" : "alert"} className={`mb-6 rounded-md border px-3 py-2 text-sm ${reconciled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          Ledger balance {formatCurrency(ledgerBalance)}，目前狀態預期 {formatCurrency(expectedLedgerBalance)}。{reconciled ? "金額一致。" : "金額不一致，請先核對退款、爭議或已付款後回沖，再處理後續追償。"}
        </p>
      )}
      {ledgerTruncated ? <p role="status" className="mb-6 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">Ledger 明細超過 500 筆；金額仍由完整 aggregate 對帳，此頁只顯示前 500 筆事件。</p> : null}
      {commissionTruncated ? <p role="status" className="mb-6 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">Commission 超過 250 筆；金額仍由完整 aggregate 對帳，此頁只顯示最近 250 筆 commission。</p> : null}

      {commissions.length === 0 ? (
        <EmptyState title="此月份沒有 commission ledger" description="目前沒有符合商家、推廣者與月份的佣金資料。" />
      ) : (
        <div className="grid gap-4">
          {commissions.map((commission) => {
            const balance = balancesByCommission.get(commission.id) ?? 0;
            const entries = entriesByCommission.get(commission.id) ?? [];
            return (
              <Card key={commission.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">訂單 {commission.orderNumber ?? "未記錄"}</h2>
                    <p className="mt-1 text-sm text-slate-600">{commission.sourceType} · {commission.referralCode ?? "無推廣碼"} · {commission.commissionRateBps / 100}% · {formatDateTime(commission.attributedAt)}</p>
                  </div>
                  <div className="flex items-center gap-3"><Badge tone={statusTone(commission.status)}>{commission.status}</Badge><p className="font-bold text-slate-950">Balance {formatCurrency(balance)}</p></div>
                </div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-slate-500">Gross base</dt><dd className="font-semibold">{formatCurrency(commission.commissionBaseAmountCents)}</dd></div>
                  <div><dt className="text-slate-500">Net reference</dt><dd className="font-semibold">{formatCurrency(commission.netReferenceAmountCents)}</dd></div>
                  <div><dt className="text-slate-500">Commission snapshot</dt><dd className="font-semibold">{formatCurrency(commission.commissionAmountCents)}</dd></div>
                </dl>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[840px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">時間</th><th className="px-3 py-2">事件</th><th className="px-3 py-2">金額</th><th className="px-3 py-2">Provider</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Dispute case</th></tr></thead>
                    <tbody className="divide-y divide-border">{entries.map((entry) => <tr key={entry.id}><td className="px-3 py-2">{formatDateTime(entry.occurredAt)}</td><td className="px-3 py-2"><Badge tone={entry.amountCents < 0 ? "orange" : entry.amountCents > 0 ? "green" : "blue"}>{entry.entryType}</Badge></td><td className="px-3 py-2 font-semibold">{formatCurrency(entry.amountCents)}</td><td className="px-3 py-2">{entry.providerName}</td><td className="break-all px-3 py-2 text-slate-600">{entry.eventIdentity}</td><td className="break-all px-3 py-2 text-slate-600">{entry.disputeCaseId ?? "-"}</td></tr>)}</tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
