import Link from "next/link";
import { Banknote, Calculator, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import {
  approveSettlementAdjustmentAction,
  createPayoutBatchAction,
  generateSettlementAction,
  lockSettlementAction,
  rejectSettlementAdjustmentAction,
  updateSettlementAdjustmentAction,
} from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, Card, PageHeader, SubmitButton } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { financeSecondApprovalThresholdCents } from "@/lib/settlement-adjustment";

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function statusTone(status: string) {
  if (status === "paid" || status === "locked") return "green" as const;
  if (status === "ready_for_payout" || status === "reviewing") return "blue" as const;
  if (status === "failed") return "orange" as const;
  return "gray" as const;
}

const settlementErrorMessages: Record<string, string> = {
  conflict: "月結資料已被其他操作更新，請重新整理後再試一次。",
  invalid_payout_account: "無法建立出款批次：每個商家都必須恰好設定一筆有效的平台出款帳戶。",
  locked: "這筆月結已鎖定，不能再重新計算或調整。",
  missing: "找不到指定的商家或月結資料。",
  negative_payout: "調整後的結算金額不可小於 0 元，資料未儲存。",
  invalid_adjustment: "調整金額必須是整數新台幣（可為負數，可用千分位逗號），不接受小數或科學記號；資料未儲存。",
  adjustment_reason_required: "請填寫調整原因（500 字以內），資料未儲存。",
  same_approver: "大額調整必須由另一位平台管理員覆核，申請人不能自行核准。",
  not_pending: "這筆調整申請已處理或已被新的申請取代，請重新整理。",
  unsupported_currency: "這個月份有非新台幣（TWD）的交易，月結不會混加不同幣別；請先人工核對該商家的交易。",
  stale_settlement: "月結計算後又有新的退款或上期結轉，請先重新產生月結再鎖定。",
  carry_forward_target_locked: "這個月份的負餘額結轉已由下一期月結扣抵，而下一期已經鎖定，因此不能再重新計算或調整。資料未變更。請在下一個未鎖定的月份以人工調整補差額。",
  unclassified_payment_purpose: "這個月份有無法判定用途的付款（不是買家訂單、方案費或帳單款），月結不會猜測是否計入商家營收；請先由工程人員核對並更新交易用途後再產生月結。",
};

const settlementStatusMessages: Record<string, string> = {
  adjustment_pending: "調整金額超過覆核門檻，已送出待覆核申請；需由另一位平台管理員核准後才會生效。",
  adjustment_approved: "已核准調整並更新月結金額。",
  adjustment_rejected: "已退回調整申請，月結金額未變更。",
};

export default async function AdminBillingSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const { member } = await requireFinanceAdmin();
  const { error, status } = await searchParams;
  const errorMessage = error ? settlementErrorMessages[error] : null;
  const statusMessage = status ? settlementStatusMessages[status] : null;
  const approvalThresholdCents = financeSecondApprovalThresholdCents();
  const db = getDb();
  const [vendors, settlements] = await Promise.all([
    db.vendor.findMany({
      orderBy: { createdAt: "desc" },
      include: { subscriptions: { where: { status: "active" }, include: { plan: true }, take: 1 } },
    }),
    db.settlement.findMany({
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      include: {
        vendor: true,
        payoutBatch: true,
        // Pending requests plus those closed when the settlement was locked (review m-4).
        adjustmentRequests: {
          where: { status: { in: ["pending", "rejected_by_lock"] } },
          orderBy: { requestedAt: "desc" },
          take: 5,
        },
      },
    }),
  ]);

  const lockedReady = settlements.filter((settlement) => settlement.lockedAt && !settlement.payoutBatchId && settlement.finalPayoutAmountCents > 0);
  const pendingPayoutAmount = lockedReady.reduce((sum, settlement) => sum + settlement.finalPayoutAmountCents, 0);

  return (
    <>
      <PageHeader
        title="平台月結管理"
        description="產生商家月結、覆核人工調整、鎖單，並將已鎖定月結送入批次出款。"
        action={<Link href="/billing/settlements" className="text-sm font-semibold text-primary hover:underline">查看商家端月結</Link>}
      />

      {errorMessage ? (
        <p className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {statusMessage ? (
        <p className="mb-6 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
          {statusMessage}
        </p>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="bg-gradient-to-br from-white to-blue-50">
          <p className="text-sm font-medium text-slate-500">商家數</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{vendors.length}</p>
        </Card>
        <Card className="bg-gradient-to-br from-white to-orange-50">
          <p className="text-sm font-medium text-slate-500">待出款月結</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{lockedReady.length}</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-slate-500">待出款金額</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{formatCurrency(pendingPayoutAmount)}</p>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="flex items-center gap-2">
          <Calculator className="text-primary" size={18} />
          <h2 className="text-lg font-semibold text-slate-950">產生 / 重算月結</h2>
        </div>
        <form action={generateSettlementAction} className="mt-4 grid gap-3 md:grid-cols-[1.4fr_1fr_auto] md:items-end">
          <CsrfField />
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            商家
            <select name="vendorId" className="h-10 rounded-md border border-border bg-white px-3 text-sm">
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name} · {vendor.subscriptions[0]?.plan.name ?? "未設定方案"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            月份
            <input name="monthKey" type="month" defaultValue={currentMonthKey()} className="h-10 rounded-md border border-border bg-white px-3 text-sm" />
          </label>
          <SubmitButton pendingChildren="產生中…" pendingMessage="正在產生月結，請勿重複送出。">
            <RefreshCw size={16} />
            產生月結
          </SubmitButton>
        </form>
      </Card>

      <div className="grid gap-5">
        {settlements.map((settlement) => (
          <Card key={settlement.id} className="grid gap-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-950">{settlement.vendor.name} · {settlement.monthKey}</h2>
                  <Badge tone={statusTone(settlement.status)}>{settlement.status}</Badge>
                  {settlement.lockedAt ? <Badge tone="green"><LockKeyhole size={12} /> 已鎖單</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  建立 {formatDateTime(settlement.createdAt)}
                  {settlement.lockedAt ? ` · 鎖定 ${formatDateTime(settlement.lockedAt)}` : ""}
                  {settlement.payoutBatch ? ` · 批次 ${settlement.payoutBatch.batchNumber}` : ""}
                </p>
              </div>
              <div className="text-left xl:text-right">
                <p className="text-sm text-slate-500">實際撥款</p>
                <p className="text-3xl font-bold text-slate-950">{formatCurrency(settlement.finalPayoutAmountCents)}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Metric label="月費" value={settlement.monthlyFeeCents} />
              <Metric label="超額" value={settlement.overflowFeeCents} />
              <Metric label="金流月費" value={settlement.paymentServiceFeeCents} />
              <Metric label="交易服務費" value={settlement.transactionServiceFeeCents} />
              <Metric label="金流手續費" value={settlement.paymentGatewayFeeCents} />
              <Metric label="調整" value={settlement.adjustmentAmountCents} />
            </div>

            {settlement.carriedInCents !== 0 || settlement.carriedOutCents !== 0 ? (
              <div className="grid gap-1 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950" role="note">
                {settlement.carriedInCents !== 0 ? <p>上期負餘額扣抵：{formatCurrency(settlement.carriedInCents)}</p> : null}
                {settlement.carriedOutCents !== 0 ? (
                  <p>本期退款高於營收，待扣款 {formatCurrency(-settlement.carriedOutCents)} 結轉至下一期扣抵，本期不撥款。</p>
                ) : null}
              </div>
            ) : null}

            {settlement.adjustmentRequests.map((request) => request.status === "pending" ? (
              <PendingAdjustment
                key={request.id}
                request={request}
                requestedByCurrentAdmin={request.requestedBy === member.id}
                locked={Boolean(settlement.lockedAt)}
              />
            ) : (
              <div key={request.id} className="grid gap-1 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700" role="note">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="gray">鎖定時自動退回</Badge>
                  <span className="font-semibold text-slate-950">{formatCurrency(request.amountCents)}</span>
                  <span className="text-slate-500">申請於 {formatDateTime(request.requestedAt)}</span>
                </div>
                <p>原因：{request.reason}</p>
                <p>
                  月結鎖定時這筆申請尚未覆核，已自動退回，金額沒有生效
                  {request.requestedBy === member.id ? "（由你申請）" : ""}。如仍需調整，請於下期月結重新申請。
                </p>
              </div>
            ))}

            <div className="grid gap-4 xl:grid-cols-[1fr_auto_auto] xl:items-end">
              <form action={updateSettlementAdjustmentAction} className="grid gap-3 md:grid-cols-[150px_1fr_auto] md:items-end">
                <CsrfField />
                <input type="hidden" name="id" value={settlement.id} />
                <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  調整金額
                  <input
                    name="adjustmentAmount"
                    type="number"
                    step="1"
                    defaultValue={settlement.adjustmentAmountCents / 100}
                    disabled={Boolean(settlement.lockedAt)}
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:bg-slate-100"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                  調整原因（必填）
                  <input
                    name="adjustmentReason"
                    defaultValue={settlement.adjustmentReason ?? ""}
                    disabled={Boolean(settlement.lockedAt)}
                    required
                    maxLength={500}
                    placeholder="例如：補扣退款手續費"
                    className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:bg-slate-100"
                  />
                </label>
                <FormSubmitButton
                  disabled={Boolean(settlement.lockedAt)}
                  pendingChildren="儲存中…"
                  pendingMessage="正在儲存月結調整，請勿重複送出。"
                  className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  儲存調整
                </FormSubmitButton>
                <p className="text-xs text-slate-500 md:col-span-3">
                  整數新台幣；金額絕對值超過 {formatCurrency(approvalThresholdCents)} 時需另一位平台管理員覆核後才生效。
                </p>
              </form>

              {!settlement.lockedAt ? (
                <form action={lockSettlementAction}>
                  <CsrfField />
                  <input type="hidden" name="id" value={settlement.id} />
                  <FormSubmitButton
                    pendingChildren="鎖定中…"
                    pendingMessage="正在鎖定月結並建立分潤應付款，請勿重複送出。"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    <ShieldCheck size={16} />
                    鎖定月結
                  </FormSubmitButton>
                </form>
              ) : null}

              {settlement.lockedAt && !settlement.payoutBatchId && settlement.finalPayoutAmountCents > 0 ? (
                <form action={createPayoutBatchAction}>
                  <CsrfField />
                  <input type="hidden" name="settlementIds" value={settlement.id} />
                  <FormSubmitButton
                    pendingChildren="建立中…"
                    pendingMessage="正在建立出款批次，請勿重複送出。"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-cta px-4 text-sm font-semibold text-white hover:bg-cta-dark"
                  >
                    <Banknote size={16} />
                    建立出款
                  </FormSubmitButton>
                </form>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function PendingAdjustment({
  request,
  requestedByCurrentAdmin,
  locked,
}: {
  request: { id: string; amountCents: number; reason: string; requestedAt: Date; requestedBy: string; status: string };
  requestedByCurrentAdmin: boolean;
  locked: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="orange">待覆核調整</Badge>
        <span className="font-semibold text-slate-950">{formatCurrency(request.amountCents)}</span>
        <span className="text-sm text-slate-500">申請於 {formatDateTime(request.requestedAt)}</span>
      </div>
      <p className="text-sm text-slate-700">原因：{request.reason}</p>
      {requestedByCurrentAdmin ? (
        <p className="text-sm text-slate-600">這筆申請由你送出，需由另一位平台管理員核准；你可以撤回。</p>
      ) : null}
      {locked ? <p className="text-sm text-slate-600">月結已鎖定，這筆申請無法再核准，請退回。</p> : null}
      <div className="flex flex-wrap gap-3">
        {!requestedByCurrentAdmin && !locked ? (
          <form action={approveSettlementAdjustmentAction}>
            <CsrfField />
            <input type="hidden" name="requestId" value={request.id} />
            <FormSubmitButton
              pendingChildren="核准中…"
              pendingMessage="正在核准調整並更新月結，請勿重複送出。"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              核准調整
            </FormSubmitButton>
          </form>
        ) : null}
        <form action={rejectSettlementAdjustmentAction}>
          <CsrfField />
          <input type="hidden" name="requestId" value={request.id} />
          <FormSubmitButton
            pendingChildren="處理中…"
            pendingMessage="正在退回調整申請，請勿重複送出。"
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {requestedByCurrentAdmin ? "撤回申請" : "退回申請"}
          </FormSubmitButton>
        </form>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{formatCurrency(value)}</p>
    </div>
  );
}
