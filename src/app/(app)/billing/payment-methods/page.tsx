import { Badge, Card, PageHeader } from "@/components/ui";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { requireVendorFinance } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment-providers";
import { formatDateTime } from "@/lib/format";
import { hasPaymentMethodSetupCapability } from "@/lib/payment-method-setup";
import { revokePaymentMethodReferenceAction, startPaymentMethodSetupAction } from "@/app/actions/payment-method-actions";

type PaymentMethodsSearchParams = { error?: string | string[]; status?: string | string[] };

type PaymentMethodsPageProps = {
  searchParams?: Promise<PaymentMethodsSearchParams>;
};

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function providerSetupState() {
  try {
    const provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
    return {
      id: provider.id,
      available: hasPaymentMethodSetupCapability(provider),
    };
  } catch {
    return { id: "未設定", available: false };
  }
}

function errorMessage(error: string | undefined) {
  switch (error) {
    case "invalid_scope":
      return "付款方式設定對象無效，請從目前商家帳號重新選擇。";
    case "provider_not_configured":
      return "目前尚未設定可用的付款 provider。尚未完成前不會啟用扣款。";
    case "provider_setup_unsupported":
      return "目前 provider 尚未提供安全的付款方式設定流程；不會要求 CelebrateDeal 儲存卡號或手動 token。";
    case "provider_form_post_unsupported":
      return "provider 要求表單導轉，但目前尚未完成安全的短期 session 保存；因此已停止導轉。";
    case "provider_setup_unavailable":
      return "付款方式設定尚未完成，請依 provider 指示完成驗證後再回到這裡。";
    case "provider_setup_failed":
      return "付款 provider 設定流程失敗，未建立或儲存任何付款資料；請稍後重試。";
    case "invalid_reference":
      return "找不到目前商家可管理的付款方式 reference。";
    case "provider_revoke_failed":
      return "本機已先停用這個付款方式，provider 撤銷尚未確認；請依 provider／客服流程處理，不會自動重試。";
    case "local_revoked_provider_unsupported":
      return "本機已停用這個付款方式，但目前 provider 沒有遠端撤銷 adapter；後續扣款會 fail closed。";
    default:
      return null;
  }
}

function statusMessage(status: string | undefined) {
  if (status === "revoked") return "付款方式已撤銷；後續使用會停止。";
  if (status === "already_revoked") return "這個付款方式先前已撤銷，沒有重複呼叫 provider。";
  return null;
}

function statusTone(status: string) {
  if (status === "verified") return "green" as const;
  if (status === "pending") return "orange" as const;
  return "gray" as const;
}

function statusLabel(status: string) {
  switch (status) {
    case "verified": return "已驗證";
    case "pending": return "待驗證";
    case "expired": return "已過期";
    case "revoked": return "已撤銷";
    default: return status;
  }
}

export default async function PaymentMethodsPage({ searchParams }: PaymentMethodsPageProps) {
  const { vendor } = await requireVendorFinance("/billing/payment-methods");
  const [references, memberships] = await Promise.all([
    getDb().paymentMethodReference.findMany({
      where: { vendorId: vendor.id },
      select: {
        id: true,
        scopeType: true,
        membershipId: true,
        providerName: true,
        status: true,
        verifiedAt: true,
        expiresAt: true,
        lastValidatedAt: true,
        createdAt: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
    getDb().teamMembership.findMany({
      where: { vendorId: vendor.id, status: "ACTIVE", leftAt: null },
      select: {
        id: true,
        teamId: true,
        team: { select: { name: true } },
        vendorMember: { select: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const params = searchParams ? await searchParams : {};
  const message = errorMessage(queryValue(params.error));
  const status = statusMessage(queryValue(params.status));
  const provider = providerSetupState();
  const membershipNames = new Map(
    memberships.map((membership) => [membership.id, `${membership.team.name} · ${membership.vendorMember.user.name}`]),
  );

  return (
    <>
      <PageHeader
        title="付款方式設定"
        description="管理平台方案與 Stream 用量需要的付款方式驗證狀態；CelebrateDeal 只保留 provider opaque reference，不接觸卡號。"
      />
      {message ? <p role="alert" className="mb-6 rounded-md bg-orange-50 px-4 py-3 text-sm font-medium text-orange-800">{message}</p> : null}
      {status ? <p role="status" className="mb-6 rounded-md bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{status}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-sm font-medium text-slate-500">目前 provider</p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{provider.id}</p>
          <div className="mt-2"><Badge tone={provider.available ? "green" : "orange"}>{provider.available ? "可發起設定" : "尚未提供設定流程"}</Badge></div>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">商店付款方式</p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{references.filter((reference) => reference.scopeType === "VENDOR").length} 筆</p>
          <p className="mt-1 text-xs text-slate-500">需有已驗證且未過期的 reference 才能啟用商店扣款。</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">成員扣款對象</p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{memberships.length} 位</p>
          <p className="mt-1 text-xs text-slate-500">逐位成員驗證，避免把商店付款方式誤套用到會員扣款。</p>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">商店付款方式</h2>
            <p className="mt-1 text-sm text-slate-500">用於商店層級的平台方案、用量與扣款流程。設定完成前，相關流程會安全停止。</p>
          </div>
          {provider.available ? (
            <form action={startPaymentMethodSetupAction}>
              <CsrfField />
              <input type="hidden" name="scopeType" value="VENDOR" />
              <FormSubmitButton pendingChildren="建立中…" pendingMessage="正在建立商店付款方式驗證 session，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">開始商店驗證</FormSubmitButton>
            </form>
          ) : (
            <p role="status" className="rounded-md bg-orange-50 px-3 py-2 text-sm font-medium text-orange-800">
              目前沒有可用的安全設定流程
            </p>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-950">成員付款方式</h2>
          <p className="mt-1 text-sm text-slate-500">需要由每位成員各自建立並驗證付款 reference；頁面不顯示 provider customer reference 或付款方式 reference。</p>
        </div>
        {memberships.length > 0 ? (
          <div className="grid gap-3">
            {memberships.map((membership) => (
              <div key={membership.id} className="flex flex-col gap-3 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-slate-950">{membershipNames.get(membership.id)}</p>
                  <p className="mt-1 text-xs text-slate-500">此成員的驗證狀態會獨立檢查，不會沿用商店 reference。</p>
                </div>
                {provider.available ? (
                  <form action={startPaymentMethodSetupAction}>
                    <CsrfField />
                    <input type="hidden" name="scopeType" value="MEMBERSHIP" />
                    <input type="hidden" name="teamId" value={membership.teamId} />
                    <input type="hidden" name="membershipId" value={membership.id} />
                    <FormSubmitButton pendingChildren="建立中…" pendingMessage="正在建立成員付款方式驗證 session，請勿重複送出。" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">開始成員驗證</FormSubmitButton>
                  </form>
                ) : (
                  <p role="status" className="text-sm font-medium text-orange-800">
                    等待 provider 提供安全設定流程
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">目前沒有可設定的啟用中成員。</p>}
      </Card>

      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-slate-950">已保存的驗證狀態</h2>
        <p className="mt-1 text-sm text-slate-500">以下只呈現必要的狀態與時間，不呈現任何 card number、token 或 provider opaque reference。</p>
        <div className="mt-4 grid gap-3">
          {references.length > 0 ? references.map((reference) => (
            <div key={reference.id} className="grid gap-2 rounded-md border border-border p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-medium text-slate-950">{reference.scopeType === "VENDOR" ? "商店付款方式" : membershipNames.get(reference.membershipId ?? "") ?? "成員付款方式"}</p>
                <p className="mt-1 text-xs text-slate-500">Provider：{reference.providerName} · 建立於 {formatDateTime(reference.createdAt)}</p>
                <p className="mt-1 text-xs text-slate-500">最後驗證：{reference.lastValidatedAt ? formatDateTime(reference.lastValidatedAt) : "尚未驗證"}{reference.expiresAt ? ` · 到期 ${formatDateTime(reference.expiresAt)}` : ""}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={statusTone(reference.status)}>{statusLabel(reference.status)}</Badge>
                {reference.status !== "revoked" ? (
                  <form action={revokePaymentMethodReferenceAction}>
                    <CsrfField />
                    <input type="hidden" name="referenceId" value={reference.id} />
                    <FormSubmitButton pendingChildren="撤銷中…" pendingMessage="正在撤銷付款方式並停用後續扣款，請勿重複送出。" confirmMessage="確認撤銷這個付款方式？後續扣款會立即 fail closed。" className="min-h-10 rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50">撤銷</FormSubmitButton>
                  </form>
                ) : null}
              </div>
            </div>
          )) : <p className="text-sm text-slate-500">尚無付款方式 reference。</p>}
        </div>
      </Card>
    </>
  );
}
