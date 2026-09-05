import { CopyReferralLink } from "@/components/copy-referral-link";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card, PageHeader } from "@/components/ui";
import { affiliatePortalLogoutAction, requestAffiliatePayoutAction, saveAffiliateBankAccountAction } from "@/app/actions/affiliate-portal-actions";
import { requireAffiliatePortal } from "@/lib/affiliate-portal-auth";
import { getAffiliatePortalDashboard } from "@/lib/affiliate-portal";
import { maskBankAccount, resolveStoredBankAccount } from "@/lib/bank-account";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { LineLoginButton } from "@/components/line-login-button";

const commissionLabels = {
  pending: { label: "待確認", tone: "orange" },
  approved: { label: "已核准", tone: "blue" },
  locked: { label: "可提領", tone: "green" },
  paid: { label: "已付款", tone: "green" },
  void: { label: "已作廢", tone: "gray" },
} as const;

function maskedAccount(envelope: string | null, vendorId: string) {
  if (!envelope) return null;
  try {
    return maskBankAccount(resolveStoredBankAccount({ vendorId, bankAccountEncrypted: envelope }));
  } catch {
    return null;
  }
}

export default async function AffiliatePortalPage({
  searchParams,
}: {
  searchParams: Promise<{ bank?: string; payout?: string; error?: string }>;
}) {
  const { auth, affiliate, vendor } = await requireAffiliatePortal();
  const dashboard = await getAffiliatePortalDashboard(getDb(), {
    vendorId: vendor.id,
    affiliateId: affiliate.id,
    userId: auth.user.id,
  });
  if (!dashboard) return null;
  const params = await searchParams;
  const bank = maskedAccount(dashboard.affiliate.bankAccountEncrypted, vendor.id);
  const wallet = dashboard.wallet;

  const feedback = params.bank === "saved"
    ? "銀行帳戶已安全儲存。"
    : params.payout === "requested"
      ? "提領申請已送出。"
      : params.error === "bank_required"
        ? "請先綁定銀行帳戶。"
        : params.error
          ? "資料無法送出，請檢查後再試。"
          : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <p className="font-bold text-slate-950">CelebrateDeal <span className="text-primary">Affiliate</span></p>
          <form action={affiliatePortalLogoutAction}>
            <CsrfField />
            <FormSubmitButton pendingChildren="登出中…" pendingMessage="正在登出工作台。" className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">登出</FormSubmitButton>
          </form>
        </div>
      </header>
    <main className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader title={`嗨，${affiliate.name}`} description={`${vendor.name} · 推廣碼 ${affiliate.code}`} />
      {feedback ? <p role={params.error ? "alert" : "status"} className={`mb-5 rounded-md px-4 py-3 text-sm ${params.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{feedback}</p> : null}
      <div className="mb-5"><LineLoginButton request={{ mode: "promoter", redirectPath: "/affiliate-portal" }}>綁定 LINE 接收佣金通知</LineLoginButton></div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="即時點擊數" value={dashboard.metrics.clickCount.toLocaleString("zh-TW")} />
        <Metric label="轉換訂單數" value={dashboard.metrics.conversionCount.toLocaleString("zh-TW")} />
        <Metric label="總帶貨金額" value={formatCurrency(dashboard.metrics.salesAmountCents)} />
        <Metric label="可提領佣金" value={formatCurrency(wallet.approved)} accent />
      </div>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-slate-950">你的專屬推薦連結</h2>
        <p className="mb-4 mt-1 text-sm text-slate-600">分享這個連結，點擊與訂單會自動歸到你的推廣碼。</p>
        <CopyReferralLink value={dashboard.referralUrl} />
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="grid gap-6">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold text-slate-950">佣金錢包與歷史明細</h2></div>
            <div className="grid grid-cols-3 border-b border-border bg-slate-50 text-center">
              <WalletAmount label="Pending" amount={wallet.pending} />
              <WalletAmount label="Approved" amount={wallet.approved} />
              <WalletAmount label="Paid" amount={wallet.paid} />
            </div>
            <div className="divide-y divide-border">
              {dashboard.commissions.length === 0 ? <p className="p-5 text-sm text-slate-500">尚無佣金紀錄。</p> : dashboard.commissions.map((commission) => {
                const status = commissionLabels[commission.status];
                return (
                  <article key={commission.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div>
                      <p className="font-semibold text-slate-950">{commission.orderNumber ?? "訂單處理中"}</p>
                      <p className="mt-1 text-sm text-slate-500">{formatDateTime(commission.attributedAt)} · 帶貨 {formatCurrency(commission.commissionBaseAmountCents)}</p>
                    </div>
                    <div className="flex items-center gap-3 sm:justify-end"><Badge tone={status.tone}>{status.label}</Badge><strong>{formatCurrency(commission.commissionAmountCents)}</strong></div>
                  </article>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4"><h2 className="text-lg font-semibold text-slate-950">提領申請</h2></div>
            <div className="divide-y divide-border">
              {dashboard.payouts.length === 0 ? <p className="p-5 text-sm text-slate-500">目前沒有可提領批次。</p> : dashboard.payouts.map((payout) => (
                <article key={payout.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{payout.monthKey} · {formatCurrency(payout.finalAmountCents)}</p>
                    <p className="mt-1 text-sm text-slate-500">{payout.status === "paid" ? `已付款 ${payout.paidAt ? formatDateTime(payout.paidAt) : ""}` : payout.requestedAt ? `已申請 ${formatDateTime(payout.requestedAt)}` : "尚未申請"}</p>
                  </div>
                  {payout.status === "pending" && !payout.requestedAt ? (
                    <form action={requestAffiliatePayoutAction}>
                      <CsrfField />
                      <input type="hidden" name="payoutId" value={payout.id} />
                      <FormSubmitButton pendingChildren="送出中…" pendingMessage="正在送出提領申請。" disabled={!bank} className="min-h-11 rounded-md bg-cta px-4 text-sm font-semibold text-white hover:bg-cta-dark">一鍵申請提領</FormSubmitButton>
                    </form>
                  ) : <Badge tone={payout.status === "paid" ? "green" : payout.status === "void" ? "gray" : "blue"}>{payout.status === "paid" ? "Paid" : payout.status === "void" ? "Void" : "Requested"}</Badge>}
                </article>
              ))}
            </div>
          </Card>
        </div>

        <Card className="h-fit">
          <h2 className="text-lg font-semibold text-slate-950">銀行帳戶</h2>
          {bank ? <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">已綁定：{bank.bankCode} / {bank.accountNumber} / {bank.accountName}</p> : <p className="mt-2 text-sm text-slate-600">尚未綁定。帳戶資料會加密保存。</p>}
          <form action={saveAffiliateBankAccountAction} className="mt-5 grid gap-4">
            <CsrfField />
            <label className="grid gap-1 text-sm font-medium text-slate-700">戶名<input name="accountName" required maxLength={100} autoComplete="name" className="h-11 rounded-md border border-border px-3" /></label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">銀行代碼<input name="bankCode" required inputMode="numeric" pattern="[0-9]{3,7}" className="h-11 rounded-md border border-border px-3" /></label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">帳號<input name="accountNumber" required inputMode="numeric" pattern="[0-9]{6,20}" autoComplete="off" className="h-11 rounded-md border border-border px-3" /></label>
            <FormSubmitButton pendingChildren="儲存中…" pendingMessage="正在加密並儲存銀行帳戶。" className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">{bank ? "更新銀行帳戶" : "綁定銀行帳戶"}</FormSubmitButton>
          </form>
        </Card>
      </div>
    </main></div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <Card className={accent ? "bg-gradient-to-br from-white to-orange-50" : undefined}><p className="text-sm text-slate-500">{label}</p><p className={`mt-2 text-2xl font-bold ${accent ? "text-orange-700" : "text-slate-950"}`}>{value}</p></Card>;
}

function WalletAmount({ label, amount }: { label: string; amount: number }) {
  return <div className="px-2 py-4"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-slate-950 sm:text-base">{formatCurrency(amount)}</p></div>;
}
