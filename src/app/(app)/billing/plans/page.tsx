import { Badge, Card, PageHeader } from "@/components/ui";
import { cookies } from "next/headers";
import { requireVendorFinance } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { PLATFORM_REFERRAL_COOKIE } from "@/lib/platform-referral";
import { allowedPaymentUrl, checkoutSessionFromMetadata, metadataObject } from "@/lib/payment-checkout-presentation";
import { DirectEntryAttributionReset } from "@/components/direct-entry-attribution-reset";
import { ExternalPaymentForm } from "@/components/external-payment-form";
import { BillingPlanCheckoutForm } from "@/components/billing-plan-checkout-form";

type BillingPlansSearchParams = { status?: string | string[]; error?: string | string[]; transactionId?: string | string[]; referral?: string | string[] };

type BillingPlansPageProps = {
  searchParams?: Promise<BillingPlansSearchParams>;
};

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

type PlatformReferralPresentation = {
  status: "recorded" | "expired" | "unrecorded";
  clickId: string | null;
  code: string | null;
  ownerName: string | null;
};

async function loadPlatformReferralPresentation(referralContextRequested: boolean): Promise<PlatformReferralPresentation> {
  const referralClickId = referralContextRequested ? (await cookies()).get(PLATFORM_REFERRAL_COOKIE)?.value ?? null : null;
  if (!referralClickId) return { status: "unrecorded", clickId: null, code: null, ownerName: null };

  const referralClick = await getDb().platformReferralClick.findUnique({
    where: { id: referralClickId },
    select: {
      id: true,
      expiresAt: true,
      referralCode: {
        select: {
          code: true,
          isActive: true,
          owner: { select: { name: true } },
        },
      },
    },
  });
  if (!referralClick) return { status: "unrecorded", clickId: null, code: null, ownerName: null };
  if (!referralClick.referralCode.isActive || referralClick.expiresAt <= new Date()) {
    return { status: "expired", clickId: null, code: null, ownerName: null };
  }
  return {
    status: "recorded",
    clickId: referralClick.id,
    code: referralClick.referralCode.code,
    ownerName: referralClick.referralCode.owner.name,
  };
}

async function loadPendingPlanCheckout(vendorId: string, transactionId: string | undefined, canManageBilling: boolean) {
  if (!canManageBilling || !transactionId || transactionId.length > 64) return null;
  const db = getDb();
  const transaction = await db.paymentTransaction.findFirst({
    where: {
      id: transactionId,
      vendorId,
      paymentMode: "platform",
      status: "pending",
    },
    select: { id: true, metadata: true },
  });
  if (!transaction) return null;

  const metadata = metadataObject(transaction.metadata);
  const subscriptionId = typeof metadata.platformSubscriptionId === "string" ? metadata.platformSubscriptionId : "";
  const billingPlanId = typeof metadata.billingPlanId === "string" ? metadata.billingPlanId : "";
  if (
    metadata.billingPurpose !== "platform_subscription_checkout"
    || !subscriptionId
    || subscriptionId.length > 64
    || !billingPlanId
    || billingPlanId.length > 64
  ) {
    return null;
  }

  const subscription = await db.vendorSubscription.findFirst({
    where: {
      id: subscriptionId,
      vendorId,
      planId: billingPlanId,
      status: "pending_payment",
    },
    select: { id: true },
  });
  return subscription ? checkoutSessionFromMetadata(metadata) : null;
}

export default async function BillingPlansPage({ searchParams }: BillingPlansPageProps) {
  const queryPromise = searchParams ?? Promise.resolve<BillingPlansSearchParams>({});
  const { vendor, member } = await requireVendorFinance("/billing/plans");
  const canManageBilling = member.role === "owner";
  const query = await queryPromise;
  const transactionId = queryValue(query.transactionId);
  const referralContextRequested = queryValue(query.referral) === "1";
  const referralPresentationPromise = loadPlatformReferralPresentation(referralContextRequested);
  const [plans, currentSubscription, pendingCheckout, csrfToken, referralPresentation] = await Promise.all([
    getDb().billingPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPriceCents: "asc" },
    }),
    getDb().vendorSubscription.findFirst({
      where: { vendorId: vendor.id, status: "active" },
      include: { plan: true },
      orderBy: { startedAt: "desc" },
    }),
    loadPendingPlanCheckout(vendor.id, transactionId, canManageBilling),
    canManageBilling ? getCsrfToken() : Promise.resolve(""),
    referralPresentationPromise,
  ]);
  const status = queryValue(query.status);
  const error = queryValue(query.error);
  const checkout = pendingCheckout;
  const formAction = checkout?.mode === "form_post" ? allowedPaymentUrl(checkout.formAction) : null;
  const checkoutUrl = checkout?.mode === "redirect" ? allowedPaymentUrl(checkout.checkoutUrl) : null;

  return (
    <>
      <DirectEntryAttributionReset isDirectEntry={referralPresentation.status !== "recorded"} />
       <PageHeader title="方案" description="平台月費、包含用量與服務費分開計算；Stream 包含額度用完後會暫停新播放，目前不會自動超額扣款。" />
      {status === "changed" ? (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          方案已更新，新的月費與額度會套用到既有月結流程。
        </p>
      ) : null}
      {status === "current" ? (
        <p role="status" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          這已經是目前方案，沒有建立重複訂閱。
        </p>
      ) : null}
      {status === "checkout" && checkout ? (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <p role="status" className="text-sm font-medium text-amber-900">方案付款已建立，請完成付款以啟用新方案。</p>
          <p className="mt-1 text-xs text-amber-800">付款交易由伺服器建立並綁定方案；只有驗證通過的 paid callback 會啟用訂閱與額度。</p>
          {formAction && Object.keys(checkout.formPayload).length > 0 ? (
            <ExternalPaymentForm action={formAction} payload={checkout.formPayload} />
          ) : checkoutUrl ? (
            <a href={checkoutUrl} className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
              前往安全付款頁
            </a>
          ) : (
            <p className="mt-3 text-sm text-amber-800">目前付款 adapter 尚未提供外部付款頁，交易會保持 pending，不會誤啟用方案。</p>
          )}
        </Card>
      ) : null}
      {status === "checkout" && !checkout && canManageBilling ? (
        <p role="alert" className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-800">
          找不到可安全繼續的方案付款。交易可能已完成、失效或不屬於目前的方案變更，系統沒有送出付款資料。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          {error === "unavailable"
            ? "方案不存在或已停止銷售，請重新整理後再選擇。"
            : error === "provider_not_configured"
              ? "平台付款服務尚未完成設定，方案尚未啟用，請聯絡客服。"
              : error === "checkout"
                ? "付款頁建立失敗，方案尚未啟用，請稍後再試。"
                : "方案更新發生衝突，請稍後再試。"}
        </p>
      ) : null}
      <Card className="mb-4 bg-blue-50/60">
        <p className="text-sm font-medium text-slate-600">目前方案</p>
        <p className="mt-1 text-xl font-semibold text-slate-950">{currentSubscription?.plan.name ?? "尚未選擇"}</p>
        <p className="mt-1 text-sm text-slate-500">
          平台方案付款會建立一筆綁定方案的 pending 交易；收到可信 paid callback 前，不會啟用新方案。
        </p>
      </Card>
      <Card className="mb-4 border-violet-200 bg-violet-50/60">
        <p className="text-sm font-semibold text-violet-950">平台推薦歸因</p>
        {referralPresentation.status === "recorded" ? (
          <dl className="mt-2 grid gap-1 text-sm text-violet-900 sm:grid-cols-3">
            <div><dt className="text-xs text-violet-700">推薦人 ID</dt><dd className="font-semibold">{referralPresentation.code}</dd></div>
            <div><dt className="text-xs text-violet-700">推薦人名稱</dt><dd className="font-semibold">{referralPresentation.ownerName}</dd></div>
            <div><dt className="text-xs text-violet-700">歸因狀態</dt><dd className="font-semibold">已記錄</dd></div>
          </dl>
        ) : (
          <>
            <p className="mt-1 text-sm text-violet-900">{referralPresentation.status === "expired" ? "推薦連結已過期，未記錄推薦人。" : "未記錄推薦人。"}</p>
            <p className="mt-1 text-xs text-violet-800">若要歸給推薦人，請重新點擊推薦人提供的官方連結；也可以向推薦人索取推薦人 ID 或請他重新傳送連結。</p>
          </>
        )}
        <p className="mt-2 border-t border-violet-200 pt-2 text-xs text-violet-800">
          推薦佣金規則：每個新訂閱只計首次成功付款；續費不重複計算，退款／拒付依帳務 ledger 回沖。
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id} className="grid gap-4 bg-gradient-to-br from-white to-slate-50">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{plan.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
              </div>
              <Badge tone={plan.isActive ? "blue" : "gray"}>{plan.code}</Badge>
            </div>
            <p className="text-3xl font-bold text-slate-950">{formatCurrency(plan.monthlyPriceCents)}</p>
            <div className="grid gap-2 text-sm text-slate-600">
              <PlanRow label="內含播放" value={`${Math.round(plan.includedStreamMinutes / 60).toLocaleString()} 小時 / 月`} />
              <PlanRow label="內含活動" value={`${plan.includedEvents.toLocaleString()} 場 / 月`} />
              <PlanRow label="內含推廣者" value={`${plan.includedAffiliates.toLocaleString()} 人`} />
              <PlanRow label="儲存額度" value={`${plan.includedStorageMinutes.toLocaleString()} 分鐘`} />
              <PlanRow label="平台金流月費" value={formatCurrency(plan.paymentServiceFeeCents)} />
              <PlanRow label="交易服務費" value={`${plan.transactionFeeRateBps / 100}%`} />
            </div>
            <div className="rounded-lg bg-white p-3 text-xs text-slate-500 shadow-sm">
              <p>超額：Stream 包含額度用完後暫停新播放；月結帳單會依實際用量產生，目前未啟用自動超額扣款。</p>
              <p className="mt-1">月結參考單價：播放每 100 小時 {formatCurrency(plan.overflowWatchHourPriceCents)}、活動每 10 場 {formatCurrency(plan.overflowEventUnitPriceCents)}、推廣者每 10 人 {formatCurrency(plan.overflowAffiliateUnitPriceCents)}、儲存每 100 分鐘 {formatCurrency(plan.overflowStorageMinutePriceCents * 100)}。帳單可從帳單頁手動完成付款。</p>
            </div>
            {currentSubscription?.planId === plan.id ? (
              <button type="button" disabled className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-200 px-4 text-sm font-semibold text-slate-600">
                目前方案
              </button>
            ) : canManageBilling ? (
              <BillingPlanCheckoutForm
                csrfToken={csrfToken}
                planId={plan.id}
                referralClickId={referralPresentation.status === "recorded" ? referralPresentation.clickId : null}
                label={currentSubscription ? "變更方案" : "選擇方案"}
              />
            ) : (
              <button type="button" disabled className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-100 px-4 text-sm font-semibold text-slate-500">
                僅限商店擁有者異動
              </button>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-white px-3 py-2">
      <span>{label}</span>
      <b className="text-slate-950">{value}</b>
    </div>
  );
}
