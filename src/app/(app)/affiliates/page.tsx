import Link from "next/link";
import { Plus, WalletCards } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { calculateAffiliateConversionRate } from "@/lib/affiliate-performance";

export default async function AffiliatesPage() {
  const vendor = await requireVendor();
  const affiliates = await getDb().affiliate.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { clicks: true } } },
  });
  const conversionCounts = await getDb().affiliateClick.groupBy({
    by: ["affiliateId"],
    where: {
      vendorId: vendor.id,
      affiliateId: { in: affiliates.map((affiliate) => affiliate.id) },
      convertedAt: { not: null },
    },
    _count: { _all: true },
  });
  const conversionsByAffiliateId = new Map(
    conversionCounts.flatMap((count) => count.affiliateId ? [[count.affiliateId, count._count._all] as const] : []),
  );

  return (
    <>
      <PageHeader
        title="聯盟夥伴"
        description="管理推廣碼、來源渠道、點擊與轉換成效。"
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/affiliates/commissions" tone="secondary"><WalletCards size={16} />分潤報表</ButtonLink>
            <ButtonLink href="/affiliates/new"><Plus size={16} />新增夥伴</ButtonLink>
          </div>
        }
      />
      {affiliates.length === 0 ? (
        <EmptyState title="還沒有聯盟夥伴" description="建立推廣碼後，公開直播頁可透過 ref 參數追蹤來源。" action={<ButtonLink href="/affiliates/new">新增夥伴</ButtonLink>} />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">夥伴名稱</th>
                  <th className="px-5 py-3">推廣碼</th>
                  <th className="px-5 py-3">來源</th>
                  <th className="px-5 py-3">狀態</th>
                  <th className="px-5 py-3 text-right">點擊</th>
                  <th className="px-5 py-3 text-right">轉換</th>
                  <th className="px-5 py-3 text-right">轉換率</th>
                  <th className="px-5 py-3 text-right">佣金比例</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {affiliates.map((affiliate) => {
                  const clicks = affiliate._count.clicks;
                  const conversions = conversionsByAffiliateId.get(affiliate.id) ?? 0;
                  const conversionRate = calculateAffiliateConversionRate(clicks, conversions);

                  return (
                    <tr key={affiliate.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <Link href={`/affiliates/${affiliate.id}`} className="font-semibold text-primary hover:underline">
                          {affiliate.name}
                        </Link>
                      </td>
                      <td className="px-5 py-4 font-mono text-slate-700">{affiliate.code}</td>
                      <td className="px-5 py-4 text-slate-600">{affiliate.source ?? "未設定"}</td>
                      <td className="px-5 py-4"><Badge tone={affiliate.isActive ? "green" : "gray"}>{affiliate.isActive ? "啟用" : "停用"}</Badge></td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-950">{clicks}</td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-950">{conversions}</td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-950">{conversionRate}%</td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-950">{affiliate.commissionRateBps / 100}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
