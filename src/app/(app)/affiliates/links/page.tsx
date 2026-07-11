import { Link2 } from "lucide-react";
import { upsertAffiliateProductLinkAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, EmptyState, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { requireVendorOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";

const errorMessages: Record<string, string> = {
  invalid_link: "請選擇同一工作區的推廣者與外部商城商品，並輸入 HTTPS 網址。",
  invalid_url: "商城連結必須是有效的 HTTPS 網址。",
  ownership_mismatch: "找不到可設定的推廣者或商品。",
};

export default async function AffiliateProductLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireVendorOwner();
  const [affiliates, products, links] = await Promise.all([
    getDb().affiliate.findMany({
      where: { vendorId: auth.vendor.id, isActive: true },
      orderBy: { name: "asc" },
    }),
    getDb().product.findMany({
      where: { vendorId: auth.vendor.id, checkoutMode: "external", isActive: true },
      orderBy: { name: "asc" },
    }),
    getDb().affiliateProductLink.findMany({
      where: { vendorId: auth.vendor.id },
      include: { affiliate: true, product: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const canCreate = affiliates.length > 0 && products.length > 0;

  return (
    <>
      <PageHeader
        title="個人商城連結"
        description="為推廣者設定外部商城個人連結。有效歸因會優先使用個人連結，否則回退商品預設連結。"
      />
      {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">商城連結已更新。</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "商城連結更新失敗。"}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><Link2 size={18} />設定連結</h2>
          <p className="mt-1 text-sm text-slate-500">只接受 HTTPS。停用後會自動回退到商品預設商城連結。</p>
          {canCreate ? (
            <form action={upsertAffiliateProductLinkAction} className="mt-4 grid gap-4">
              <CsrfField />
              <SelectField label="推廣者" name="affiliateId">
                {affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.id}>{affiliate.name} · {affiliate.code}</option>)}
              </SelectField>
              <SelectField label="外部商城商品" name="productId">
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </SelectField>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                個人商品 URL
                <input name="url" type="url" required placeholder="https://..." className="h-10 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input name="isActive" type="checkbox" defaultChecked className="h-4 w-4 accent-blue-600" />
                啟用個人連結
              </label>
              <SubmitButton>儲存連結</SubmitButton>
            </form>
          ) : (
            <p className="mt-4 rounded-md border border-border bg-slate-50 p-4 text-sm text-slate-600">請先建立啟用中的聯盟夥伴，並將至少一項商品設為外部商城結帳。</p>
          )}
        </Card>

        {links.length === 0 ? (
          <EmptyState title="尚無個人商城連結" description="建立後，公開直播頁會依有效的伺服器端歸因選擇個人連結。" />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold text-slate-950">目前設定</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">推廣者</th><th className="px-5 py-3">商品</th><th className="px-5 py-3">URL</th><th className="px-5 py-3">狀態</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {links.map((link) => (
                    <tr key={link.id}>
                      <td className="px-5 py-4"><p className="font-semibold text-slate-900">{link.affiliate.name}</p><p className="text-xs text-slate-500">{link.affiliate.code}</p></td>
                      <td className="px-5 py-4 text-slate-700">{link.product.name}</td>
                      <td className="max-w-[320px] truncate px-5 py-4 font-mono text-xs text-slate-600" title={link.url}>{link.url}</td>
                      <td className="px-5 py-4"><Badge tone={link.isActive ? "green" : "gray"}>{link.isActive ? "啟用" : "停用"}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
