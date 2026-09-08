import { saveCommissionRuleAction } from "@/app/actions/commission-rule-actions";
import { CsrfField } from "@/components/csrf-field";
import { CommissionSimulator } from "@/components/commission-simulator";
import { Badge, Card, Field, PageHeader, SelectField, SubmitButton } from "@/components/ui";
import { requireVendorOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";

const TIER_ROWS = 8;
const UPLINE_ROWS = 8;

export default async function CommissionSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireVendorOwner();
  const [activeRule, products] = await Promise.all([getDb().commissionRuleSet.findFirst({
    where: { vendorId: auth.vendor.id, currency: "TWD", status: "ACTIVE" },
    orderBy: [{ activatedAt: "desc" }, { version: "desc" }],
    include: {
      tiers: { orderBy: { minMonthlySalesCents: "asc" } },
      quantityTiers: { orderBy: { minQuantity: "asc" } },
      uplineLevels: { orderBy: { level: "asc" } },
      productOverrides: true,
    },
  }), getDb().product.findMany({
    where: { vendorId: auth.vendor.id, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  })]);

  return (
    <>
      <PageHeader
        title="階梯式與團隊分潤"
        description="依推廣者當月累積成交額選擇佣金階梯，並把培育獎金分配給有效上下線關係中的團隊長。每次儲存都會建立新版本。"
      />
      {params.updated ? <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">新分潤規則已啟用，既有訂單 snapshot 不受影響。</p> : null}
      {params.error ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{params.error === "rule_conflict" ? "規則版本同時被更新，請重新整理後再試。" : "規則格式不正確，請檢查門檻順序、費率與總上限。"}</p> : null}

      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">目前規則</h2>
            <p className="mt-1 text-sm text-slate-600">{activeRule ? `版本 ${activeRule.version}，總分潤上限 ${activeRule.maxTotalRateBps / 100}%` : "尚未啟用動態規則，訂單沿用各推廣者的固定佣金率。"}</p>
          </div>
          <Badge tone={activeRule ? "green" : "gray"}>{activeRule ? "ACTIVE" : "LEGACY"}</Badge>
        </div>
      </Card>

      <div className="mb-5">
        <CommissionSimulator
          policyVersion={activeRule?.version ?? 1}
          tiers={activeRule?.quantityTiers.length ? activeRule.quantityTiers : undefined}
        />
      </div>

      <form action={saveCommissionRuleAction} className="grid gap-5">
        <CsrfField />
        <Card>
          <h2 className="mb-1 text-lg font-semibold text-slate-950">基本守衛</h2>
          <p className="mb-4 text-sm text-slate-600">最高階梯費率加上所有團隊長獎金，不得超過總分潤上限。</p>
          <div className="grid gap-4 md:grid-cols-2">
            <SelectField label="幣別" name="currency" defaultValue={activeRule?.currency ?? "TWD"}>
              <option value="TWD">TWD</option>
            </SelectField>
            <Field label="總分潤上限（BPS）" name="maxTotalRateBps" type="number" required min={1} max={10000} step={1} defaultValue={activeRule?.maxTotalRateBps ?? 3000} />
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-semibold text-slate-950">商品專屬覆蓋率</h2>
          <p className="mb-4 text-sm text-slate-600">指定商品成交時優先使用此費率；複合租戶外鍵會拒絕其他商家的商品。</p>
          <div className="grid gap-3">
            {products.map((product) => {
              const override = activeRule?.productOverrides.find((item) => item.productId === product.id);
              return (
                <div key={product.id} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <input type="hidden" name="overrideProductId" value={product.id} />
                  <span className="self-center text-sm font-medium text-slate-800">{product.name}</span>
                  <Field label="專屬分潤（BPS，留白表示不覆蓋）" name="overrideRateBps" type="number" min={0} max={10000} step={1} defaultValue={override?.rateBps ?? ""} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-semibold text-slate-950">累積成交件數階梯</h2>
          <p className="mb-4 text-sm text-slate-600">第一階從第 1 件開始；成交訂單會先加入該推廣者在本商家的累積件數，再選擇適用費率。</p>
          <div className="grid gap-3">
            {Array.from({ length: TIER_ROWS }, (_, index) => {
              const tier = activeRule?.quantityTiers[index];
              return (
                <div key={index} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
                  <Field label={`第 ${index + 1} 階起始件數`} name="tierMinQuantity" type="number" min={1} step={1} required={index === 0} readOnly={index === 0} defaultValue={tier?.minQuantity ?? (index === 0 ? 1 : "")} />
                  <Field label={`第 ${index + 1} 階佣金（BPS）`} name="tierQuantityRateBps" type="number" min={0} max={10000} step={1} required={index === 0} defaultValue={tier?.rateBps ?? (index === 0 ? 1500 : "")} />
                </div>
              );
            })}
          </div>
          {/* Legacy amount tier remains a valid compatibility row for older readers. */}
          <input type="hidden" name="tierMinAmount" value="0" />
          <input type="hidden" name="tierRateBps" value={activeRule?.quantityTiers[0]?.rateBps ?? 1500} />
        </Card>

        <Card>
          <h2 className="mb-1 text-lg font-semibold text-slate-950">團隊長培育獎金</h2>
          <p className="mb-4 text-sm text-slate-600">依有效的直接上線逐層分配。某層沒有綁定推廣者時，該層不產生負債。</p>
          <div className="grid gap-3 md:grid-cols-3">
            {Array.from({ length: UPLINE_ROWS }, (_, index) => (
              <Field
                key={index}
                label={`第 ${index + 1} 層獎金（BPS）`}
                name="uplineBonusRateBps"
                type="number"
                min={1}
                max={10000}
                step={1}
                defaultValue={activeRule?.uplineLevels[index]?.bonusRateBps ?? ""}
              />
            ))}
          </div>
        </Card>

        <div><SubmitButton pendingChildren="啟用中…">建立並啟用新版本</SubmitButton></div>
      </form>
    </>
  );
}
