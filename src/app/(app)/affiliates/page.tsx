import { Plus, WalletCards } from "lucide-react";
import { Badge, ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function AffiliatesPage() {
  const vendor = await requireVendor();
  const affiliates = await getDb().affiliate.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    include: { clicks: true },
  });

  return (
    <>
      <PageHeader
        title="聯盟夥伴"
        description="管理推廣碼、來源渠道、點擊、報名與轉換摘要。"
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {affiliates.map((affiliate) => {
            const clicks = affiliate.clicks.length;
            const conversions = affiliate.clicks.filter((click) => click.convertedAt).length;
            return (
              <a key={affiliate.id} href={`/affiliates/${affiliate.id}`} className="rounded-lg border border-border bg-white p-4 shadow-sm hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">{affiliate.name}</h2>
                    <p className="mt-1 font-mono text-sm text-primary">?ref={affiliate.code}</p>
                  </div>
                  <Badge tone={affiliate.isActive ? "green" : "gray"}>{affiliate.isActive ? "啟用" : "停用"}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <span className="rounded-md bg-slate-50 p-2"><b className="block">{clicks}</b><small>點擊</small></span>
                  <span className="rounded-md bg-slate-50 p-2"><b className="block">{conversions}</b><small>轉換</small></span>
                  <span className="rounded-md bg-slate-50 p-2"><b className="block">{affiliate.commissionRateBps / 100}%</b><small>佣金</small></span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
