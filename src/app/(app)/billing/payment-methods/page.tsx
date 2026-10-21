import { Badge, Card, PageHeader } from "@/components/ui";
import { StepUpMfaNotice } from "@/components/step-up-mfa-notice";
import { recentMfaStatus } from "@/lib/recent-mfa";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PaymentMethodSetupStartForm } from "@/components/payment-method-setup-start-form";
import { requireVendorFinance } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment-providers";
import { formatDateTime } from "@/lib/format";
import { hasPaymentMethodSetupCapability } from "@/lib/payment-method-setup";
import { payUniLiveProbeAvailable } from "@/lib/payuni-live-probe";
import { revokePaymentMethodReferenceAction } from "@/app/actions/payment-method-actions";

type PaymentMethodsSearchParams = {
  error?: string | string[];
  status?: string | string[];
  setup?: string | string[];
  reason?: string | string[];
};

type PaymentMethodsPageProps = {
  searchParams?: Promise<PaymentMethodsSearchParams>;
};

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function providerSetupState(vendorId: string) {
  try {
    const provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
    return {
      id: provider.id,
      available: hasPaymentMethodSetupCapability(provider)
        && (provider.id !== "payuni" || process.env.PAYUNI_ENV !== "production" || payUniLiveProbeAvailable(vendorId)),
    };
  } catch {
    return { id: "未設定", available: false };
  }
}

function errorMessage(error: string | undefined) {
  switch (error) {
    case "invalid_scope":
      return "付款方式設定對象無效，請從目前商家帳號重新選擇。";
    case "consent_required":
      return "請先確認付款方式綁定及未來扣款授權範圍。";
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

/**
 * Copy for the PAYUNi ReturnURL redirect. The query is not trusted: success only
 * says a result came back, and the saved references below remain the source of truth.
 */
function setupReturnFailureMessage(setup: string | undefined, reason: string | undefined) {
  if (setup !== "failed") return null;
  switch (reason) {
    case "provider_declined":
      return "金流未完成綁定驗證，請稍後再試或改用其他卡片。這次沒有建立任何付款方式。";
    case "provider_pending":
      return "金流尚未確認這次綁定驗證的結果；確認後會自動更新，請稍後重新整理本頁。";
    case "rejected":
      return "這次驗證已失效或已處理過，沒有建立新的付款方式；如需綁定請重新開始驗證。";
    case "processing_failed":
      return "金流已回傳結果，但系統暫時無法完成處理，會再自動確認；請稍後重新整理本頁。";
    case "invalid_payload":
    case "unverified":
      return "無法確認金流回傳的綁定結果，這次沒有建立任何付款方式；請重新開始驗證。";
    case "unavailable":
      return "付款方式設定暫時無法使用，這次沒有建立任何付款方式；請稍後再試。";
    default:
      return "付款方式綁定未完成，這次沒有建立任何付款方式；請重新開始驗證。";
  }
}

function setupReturnSuccessMessage(setup: string | undefined) {
  return setup === "success" ? "金流已回傳綁定驗證結果；請以下方「已保存的驗證狀態」為準。" : null;
}

function statusMessage(status: string | undefined) {
  if (status === "revoked") return "付款方式已撤銷；後續使用會停止。";
  if (status === "already_revoked") return "這個付款方式先前已撤銷，沒有重複呼叫 provider。";
  return null;
}

/** 只呈現目前紀錄的有效性；發布仍由既有 guard 重新檢查，不代表顧客收款核可。 */
function referenceDisplayStatus(reference: { scopeType: string; membershipId: string | null; status: string; verifiedAt: Date | null; expiresAt: Date | null }, now: Date) {
  if (reference.status !== "verified") {
    return ["pending", "expired", "revoked"].includes(reference.status) ? reference.status : "unknown";
  }
  if (reference.scopeType === "VENDOR" && reference.membershipId !== null) return "unconfirmed";
  const verifiedAt = reference.verifiedAt?.getTime();
  const expiresAt = reference.expiresAt?.getTime();
  if (verifiedAt === undefined || !Number.isFinite(verifiedAt) || verifiedAt > now.getTime()
    || (expiresAt !== undefined && !Number.isFinite(expiresAt))) return "unconfirmed";
  if (expiresAt !== undefined && expiresAt <= now.getTime()) return "expired";
  return "verified";
}

function statusTone(status: string) {
  if (status === "verified") return "green" as const;
  if (status === "pending" || status === "unconfirmed") return "orange" as const;
  return "gray" as const;
}

function statusLabel(status: string) {
  switch (status) {
    case "verified": return "已驗證";
    case "pending": return "待驗證";
    case "expired": return "已過期";
    case "revoked": return "已撤銷";
    case "unconfirmed": return "驗證資料待確認";
    default: return "狀態待確認";
  }
}

export default async function PaymentMethodsPage({ searchParams }: PaymentMethodsPageProps) {
  const { user, session, vendor } = await requireVendorFinance("/billing/payment-methods");
  const stepUpStatus = recentMfaStatus({ user, session });
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
  const setupResult = queryValue(params.setup);
  const message = errorMessage(queryValue(params.error)) ?? setupReturnFailureMessage(setupResult, queryValue(params.reason));
  const status = statusMessage(queryValue(params.status)) ?? setupReturnSuccessMessage(setupResult);
  const provider = providerSetupState(vendor.id);
  const renderedAt = new Date();
  const membershipNames = new Map(
    memberships.map((membership) => [membership.id, `${membership.team.name} · ${membership.vendorMember.user.name}`]),
  );

  return (
    <>
      <PageHeader
        title="平台服務付款方式"
        description="管理平台方案與 Stream 用量的付款驗證；這不是顧客結帳收款設定。平台不保存卡號。"
      />
      {message ? <p role="alert" className="mb-6 rounded-md bg-orange-50 px-4 py-3 text-sm font-medium text-orange-800">{message}</p> : null}
      {status ? <p role="status" className="mb-6 rounded-md bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">{status}</p> : null}
      <div className="mb-6"><StepUpMfaNotice status={stepUpStatus} nextPath="/billing/payment-methods" operation="設定或撤銷付款方式" /></div>
      <p className="mb-6 text-sm text-slate-600">專案發布仍檢查有效的商家層級付款驗證紀錄，成員紀錄不計入。完成本頁設定不代表顧客收款已啟用或取得收款核可；顧客收款需另外確認，發布時也會重新檢查驗證有效性。</p>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="text-sm font-medium text-slate-500">目前 provider</p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{provider.id}</p>
          <div className="mt-2"><Badge tone={provider.available ? "green" : "orange"}>{provider.available ? "可發起設定" : "尚未提供設定流程"}</Badge></div>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">商家平台服務付款紀錄</p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{references.filter((reference) => reference.scopeType === "VENDOR").length} 筆</p>
          <p className="mt-1 text-xs text-slate-500">筆數包含待驗證與過期紀錄；平台扣款仍需已驗證且未過期的有效紀錄。</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">成員平台服務付款對象</p>
          <p className="mt-2 text-xl font-semibold text-slate-950">{memberships.length} 位</p>
          <p className="mt-1 text-xs text-slate-500">成員與商家紀錄分開驗證，不代表顧客結帳付款已啟用。</p>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">商家平台服務付款方式</h2>
            <p className="mt-1 text-sm text-slate-500">用於商店層級的平台方案、用量與扣款流程。設定完成前，相關流程會安全停止。</p>
          </div>
          {provider.available ? (
            <PaymentMethodSetupStartForm scopeType="VENDOR" providerId={provider.id} liveProbeAvailable={payUniLiveProbeAvailable(vendor.id)} csrfField={<CsrfField />} />
          ) : (
            <p role="status" className="rounded-md bg-orange-50 px-3 py-2 text-sm font-medium text-orange-800">
              目前沒有可用的安全設定流程
            </p>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-950">成員付款方式（平台服務）</h2>
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
                  <PaymentMethodSetupStartForm
                    scopeType="MEMBERSHIP"
                    providerId={provider.id}
                    teamId={membership.teamId}
                    membershipId={membership.id}
                    csrfField={<CsrfField />}
                  />
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
          {references.length > 0 ? references.map((reference) => {
            const displayStatus = referenceDisplayStatus(reference, renderedAt);
            return (
              <div key={reference.id} className="grid gap-2 rounded-md border border-border p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="font-medium text-slate-950">{reference.scopeType === "VENDOR" ? "商家平台服務付款方式" : membershipNames.get(reference.membershipId ?? "") ?? "成員付款方式"}</p>
                  <p className="mt-1 text-xs text-slate-500">Provider：{reference.providerName} · 建立於 {formatDateTime(reference.createdAt)}</p>
                  <p className="mt-1 text-xs text-slate-500">最近檢查時間：{reference.lastValidatedAt ? formatDateTime(reference.lastValidatedAt) : "尚無時間紀錄"}{reference.expiresAt ? ` · 到期 ${formatDateTime(reference.expiresAt)}` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={statusTone(displayStatus)}>{statusLabel(displayStatus)}</Badge>
                  {reference.status !== "revoked" ? (
                    <form action={revokePaymentMethodReferenceAction}>
                      <CsrfField />
                      <input type="hidden" name="referenceId" value={reference.id} />
                      <FormSubmitButton pendingChildren="撤銷中…" pendingMessage="正在撤銷付款方式並停用後續扣款，請勿重複送出。" confirmMessage="確認撤銷這個付款方式？後續扣款會立即 fail closed。" className="min-h-10 rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50">撤銷</FormSubmitButton>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          }) : <p className="text-sm text-slate-500">尚無平台服務付款紀錄。</p>}
        </div>
      </Card>
    </>
  );
}
