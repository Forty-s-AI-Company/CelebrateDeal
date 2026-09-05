import { saveCommissionRuleAction } from "@/app/actions/commission-rule-actions";
import { CsrfField } from "@/components/csrf-field";
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
  const activeRule = await getDb().commissionRuleSet.findFirst({
    where: { vendorId: auth.vendor.id, currency: "TWD", status: "ACTIVE" },
    orderBy: [{ activatedAt: "desc" }, { version: "desc" }],
    include: {
      tiers: { orderBy: { minMonthlySalesCents: "asc" } },
      uplineLevels: { orderBy: { level: "asc" } },
    },
  });

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
          <h2 className="mb-1 text-lg font-semibold text-slate-950">當月業績階梯</h2>
          <p className="mb-4 text-sm text-slate-600">第一階門檻固定從 0 元開始；成交訂單會先計入當月業績，再選擇適用費率。</p>
          <div className="grid gap-3">
            {Array.from({ length: TIER_ROWS }, (_, index) => {
              const tier = activeRule?.tiers[index];
              return (
                <div key={index} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2">
                  <Field label={`第 ${index + 1} 階門檻（元）`} name="tierMinAmount" type="number" min={0} step={1} required={index === 0} readOnly={index === 0} defaultValue={tier ? tier.minMonthlySalesCents / 100 : index === 0 ? 0 : ""} />
                  <Field label={`第 ${index + 1} 階佣金（BPS）`} name="tierRateBps" type="number" min={0} max={10000} step={1} required={index === 0} defaultValue={tier?.rateBps ?? (index === 0 ? 800 : "")} />
                </div>
              );
            })}
          </div>
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
