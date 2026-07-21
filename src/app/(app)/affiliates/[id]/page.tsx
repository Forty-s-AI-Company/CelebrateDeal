import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";

export default async function AffiliateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const affiliate = await getDb().affiliate.findFirst({
    where: { id, vendorId: vendor.id },
    include: {
      clicks: { orderBy: { createdAt: "desc" }, take: 20 },
      commissions: { orderBy: { attributedAt: "desc" }, take: 20 },
      payouts: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!affiliate) notFound();

  const clicks = affiliate.clicks.length;
  const conversions = affiliate.clicks.filter((click) => click.convertedAt).length;
  const conversionRate = clicks > 0 ? Math.round((conversions / clicks) * 100) : 0;
  const commissionTotal = affiliate.commissions.reduce((sum, commission) => sum + commission.commissionAmountCents, 0);

  return (
    <>
      <PageHeader
        title={affiliate.name}
        description={`推廣碼 ${affiliate.code} · ${affiliate.source ?? "未設定來源"}`}
        action={<ButtonLink href={`/affiliates/${affiliate.id}/edit`}><Pencil size={16} />編輯夥伴</ButtonLink>}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-slate-500">點擊</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{clicks}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">轉換</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{conversions}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">轉換率</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{conversionRate}%</p>
        </Card>
        <Card className="bg-gradient-to-br from-white to-orange-50">
          <p className="text-sm text-slate-500">累計佣金</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{formatCurrency(commissionTotal)}</p>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-950">佣金紀錄</h2>
          </div>
          <div className="divide-y divide-border">
            {affiliate.commissions.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">尚無佣金紀錄。</p>
            ) : affiliate.commissions.map((commission) => (
              <div key={commission.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                <div>
                  <p className="font-semibold text-slate-950">{commission.orderNumber ?? "未綁定訂單"}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatDateTime(commission.attributedAt)} · 成交 {formatCurrency(commission.orderAmountCents)}</p>
                </div>
                <Badge tone={commission.status === "approved" ? "green" : "orange"}>{commission.status}</Badge>
                <p className="text-lg font-bold text-slate-950">{formatCurrency(commission.commissionAmountCents)}</p>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-6">
          <Card>
            <h2 className="text-lg font-semibold text-slate-950">推廣設定</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-slate-500">狀態</dt><dd><Badge tone={affiliate.isActive ? "green" : "gray"}>{affiliate.isActive ? "啟用" : "停用"}</Badge></dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">佣金比例</dt><dd className="font-semibold">{affiliate.commissionRateBps / 100}%</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">聯絡 Email</dt><dd className="font-semibold">{affiliate.contactEmail ?? "-"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">追蹤連結</dt><dd className="font-mono text-primary">?ref={affiliate.code}</dd></div>
            </dl>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-slate-950">最近來源事件</h2>
            <div className="mt-4 grid gap-2">
              {affiliate.clicks.map((click) => (
                <div key={click.id} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium text-slate-950">{click.landingPath}</p>
                  <p className="mt-1 text-slate-500">{formatDateTime(click.createdAt)} · {click.convertedAt ? "已轉換" : "未轉換"}</p>
                </div>
              ))}
            </div>
          </Card>

          <Link href="/affiliates/commissions" className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800 hover:bg-blue-100">
            查看完整分潤報表
          </Link>
        </div>
      </div>
    </>
  );
}
