import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getMerchantAffiliatePolicy } from "@/lib/merchant-affiliate-policy-service";
import { getCsrfToken, CSRF_FIELD_NAME } from "@/lib/csrf";
import { MerchantAffiliatePolicyForm } from "@/components/merchant-affiliate-policy-form";
import { PageHeader, ButtonLink } from "@/components/ui";

export default async function AffiliatePolicyPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const { vendor, auth } = await requireVendorManagerContext("/affiliates/policy");
  if (!auth.user || !vendor.enabledFeatureModules.includes("affiliate_program")) notFound();
  const current = await getMerchantAffiliatePolicy(getDb(), { vendorId: vendor.id, userId: auth.user.id });
  const query = await searchParams, search = (query.q ?? "").trim().slice(0, 120), cursor = query.cursor ?? null;
  if (cursor && !/^[A-Za-z0-9_-]{1,191}$/u.test(cursor)) notFound();
  const where = { vendorId: vendor.id, commerceDomain: "merchant" as const, currency: "TWD", ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}) };
  if (cursor && !await getDb().product.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) notFound();
  const rows = await getDb().product.findMany({ where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: 26, select: { id: true, name: true } });
  const products = rows.slice(0, 25);
  // Keep every persisted override visible even when it is outside this search page.
  const selected = current.policy?.terms.productOverrides.map(item => item.productId) ?? [];
  const retained = selected.length ? await getDb().product.findMany({ where: { vendorId: vendor.id, id: { in: selected } }, select: { id: true, name: true } }) : [];
  for (const product of retained) if (!products.some(item => item.id === product.id)) products.push(product);
  const next = rows.length > 25 ? rows[24]!.id : null;
  return <><PageHeader title="聯盟佣金政策" description="設定商務商品的成交階梯、團隊多層佣金與商品比例。既有結帳固定保留原始政策；課程與平台推薦沿用各自分潤契約。" action={<ButtonLink href="/affiliates">回到聯盟夥伴</ButtonLink>} />
    <p className="mb-4" role="status">{current.policy ? `目前政策版本 ${current.policy.version}` : "目前未啟用階梯政策，新結帳沿用夥伴原有固定比例。"}</p>
    <form method="get" className="mb-4 flex gap-3"><label>搜尋佣金商品<input name="q" defaultValue={search} maxLength={120} className="block min-h-11 rounded border px-3" /></label><button className="min-h-11 self-end rounded border px-4">搜尋商品</button></form>
    {next ? <Link className="mb-4 block min-h-11 underline" href={`?q=${encodeURIComponent(search)}&cursor=${encodeURIComponent(next)}`}>下一頁商品</Link> : null}
    <MerchantAffiliatePolicyForm initial={current.policy?.terms ?? null} revision={current.revision} products={products} csrfToken={await getCsrfToken()} csrfFieldName={CSRF_FIELD_NAME} />
  </>;
}
