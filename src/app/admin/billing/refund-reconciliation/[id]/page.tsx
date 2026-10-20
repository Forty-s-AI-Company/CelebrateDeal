import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, PageHeader, SubmitButton } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { getPaymentProvider } from "@/lib/payment-providers";
import { PayUniRefundReconciliationError, reconcilePayUniRefund } from "@/lib/payuni-refund-reconciliation";
import {
  payUniRefundHoldEarliestReleaseAt,
  payUniRefundHoldNextCountableAt,
  payUniRefundHoldPolicy,
  recordPayUniRefundHoldCheck,
  resetPayUniRefundHoldChecks,
} from "@/lib/payuni-refund-hold-release";

const RESULT_MESSAGES = {
  reconciled: "已完成 PayUni Sandbox 退款對帳，待處理退款保留已原子化轉為已處理。",
  already_reconciled: "此交易已完成退款對帳，系統沒有再次查詢後寫入。",
  nothing_pending: "目前沒有可執行的 pending reservation；系統未查詢 PayUni，也未變更本機帳務。",
  no_refund_confirmed: "PayUni 目前顯示這筆保留沒有退款；已記錄一次確認，保留維持不變。",
  hold_released: "已依連續確認釋放退款保留，該筆保留標為失敗並寫入稽核紀錄；此交易可重新申請退款。",
  hold_not_ready: "已記錄本次「沒有退款」確認，但尚未達到釋放條件（連續確認次數或時間窗），保留維持不變。",
  error: "退款對帳未完成，系統未變更本機帳務。",
} as const;

function resultMessage(value: unknown) {
  return typeof value === "string" && value in RESULT_MESSAGES
    ? RESULT_MESSAGES[value as keyof typeof RESULT_MESSAGES]
    : null;
}

export default async function AdminBillingRefundReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string }>;
}) {
  await requireFinanceAdmin();
  const { id } = await params;
  const query = await searchParams;
  const transaction = await getDb().paymentTransaction.findUnique({
    where: { id },
    include: {
      vendor: true,
      refunds: {
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          refundAmountCents: true,
          status: true,
          createdAt: true,
          providerNoRefundCheckCount: true,
          providerNoRefundLastCheckedAt: true,
        },
      },
    },
  });
  if (!transaction) notFound();

  // This page owns only the PayUni Sandbox reconciliation contract. Keep
  // unsupported providers visibly fail-closed instead of rendering a button
  // that the server action will reject after submission.
  if (transaction.providerName !== "payuni") {
    return (
      <>
        <PageHeader
          title="退款終態對帳不可用"
          description="目前只有 PayUni Sandbox 交易可以在此頁執行終態對帳。"
          action={<Link href="/admin/billing/dashboard" className="text-sm font-semibold text-primary hover:underline">返回財務總覽</Link>}
        />
        <Card>
          <p className="text-sm leading-6 text-slate-600">
            此交易使用尚未支援的付款 provider，系統不會顯示或執行 PayUni Sandbox 對帳操作。
          </p>
        </Card>
      </>
    );
  }

  async function reconcileAction(formData: FormData) {
    "use server";

    await assertServerActionSecurity(formData);
    const finance = await requireFinanceAdmin();
    const targetId = formData.get("id");
    if (typeof targetId !== "string" || targetId !== id) {
      redirect(`/admin/billing/refund-reconciliation/${id}?status=error`);
    }

    const db = getDb();
    const target = await db.paymentTransaction.findUnique({
      where: { id: targetId },
      include: { refunds: { where: { status: "pending" }, select: { id: true } } },
    });
    if (!target || target.providerName !== "payuni") {
      redirect(`/admin/billing/refund-reconciliation/${id}?status=error`);
    }
    // A terminal local state is already authoritative for idempotency. Do not
    // call PayUni again when no pending reservation remains.
    if (target.refunds.length === 0 && (target.status === "refunded" || target.status === "partially_refunded")) {
      redirect(`/admin/billing/refund-reconciliation/${id}?status=nothing_pending`);
    }
    const provider = getPaymentProvider("payuni");
    if (!provider.queryPayment || !target.providerTradeNo) {
      redirect(`/admin/billing/refund-reconciliation/${id}?status=error`);
    }

    let status: string;
    try {
      const snapshot = await provider.queryPayment({ transaction: target });
      const actor = { id: finance.member.id, label: finance.member.role };
      try {
        status = (await reconcilePayUniRefund({ db, transactionId: target.id, providerSnapshot: snapshot, actor })).disposition;
      } catch (error) {
        if (!(error instanceof PayUniRefundReconciliationError)) throw error;
        if (error.reason !== "local_state_ambiguous") {
          // A validated answer that contradicts the ledger breaks the streak.
          await resetPayUniRefundHoldChecks(db, target.id);
          throw error;
        }
        // F-046: PayUni still reports no refund. Record one confirmation only;
        // releasing the hold is a separate, explicit admin action.
        await recordPayUniRefundHoldCheck({ db, transactionId: target.id, providerSnapshot: snapshot, actor, release: false });
        status = "no_refund_confirmed";
      }
    } catch {
      status = "error";
    }
    revalidatePath(`/admin/billing/refund-reconciliation/${target.id}`);
    revalidatePath("/admin/billing/dashboard");
    redirect(`/admin/billing/refund-reconciliation/${target.id}?status=${status}`);
  }

  async function releaseHoldAction(formData: FormData) {
    "use server";

    await assertServerActionSecurity(formData);
    const finance = await requireFinanceAdmin();
    const targetId = formData.get("id");
    const refundRecordId = formData.get("refundRecordId");
    if (typeof targetId !== "string" || targetId !== id || typeof refundRecordId !== "string" || !refundRecordId) {
      redirect(`/admin/billing/refund-reconciliation/${id}?status=error`);
    }
    const db = getDb();
    const target = await db.paymentTransaction.findUnique({ where: { id: targetId } });
    const provider = getPaymentProvider("payuni");
    if (!target || target.providerName !== "payuni" || !target.providerTradeNo || !provider.queryPayment) {
      redirect(`/admin/billing/refund-reconciliation/${id}?status=error`);
    }

    let status: string;
    try {
      // The release itself needs a fresh "no refund" answer from PayUni.
      const snapshot = await provider.queryPayment({ transaction: target });
      const result = await recordPayUniRefundHoldCheck({
        db,
        transactionId: target.id,
        refundRecordId,
        providerSnapshot: snapshot,
        actor: { id: finance.member.id, label: finance.member.role },
        release: true,
      });
      status = result.disposition === "released" ? "hold_released" : "hold_not_ready";
    } catch {
      status = "error";
    }
    revalidatePath(`/admin/billing/refund-reconciliation/${target.id}`);
    revalidatePath("/admin/billing/dashboard");
    redirect(`/admin/billing/refund-reconciliation/${target.id}?status=${status}`);
  }

  const message = resultMessage(query?.status);
  const pendingAmountCents = transaction.refunds.reduce((sum, refund) => sum + refund.refundAmountCents, 0);
  const holdPolicy = payUniRefundHoldPolicy();
  const heldRefund = transaction.refunds.length === 1 && transaction.status !== "refunded" ? transaction.refunds[0] : undefined;
  const holdNextCountableAt = heldRefund ? payUniRefundHoldNextCountableAt(heldRefund, holdPolicy) : null;
  const holdEarliestReleaseAt = heldRefund ? payUniRefundHoldEarliestReleaseAt(heldRefund, holdPolicy) : null;
  const holdWindowHours = Math.round(holdPolicy.windowMs / 3_600_000);
  const holdIntervalHours = Math.round(holdPolicy.minIntervalMs / 3_600_000);

  return (
    <>
      <PageHeader
        title="PayUni 退款終態對帳"
        description="核對結果不明、但本機仍保留 pending reservation 的退款；只查詢 PayUni，不會重送退款。"
        action={<Link href="/admin/billing/dashboard" className="text-sm font-semibold text-primary hover:underline">返回財務總覽</Link>}
      />

      {message ? (
        <Card className={query?.status === "error" ? "mb-6 border-orange-200 bg-orange-50" : "mb-6 border-green-200 bg-green-50"}>
          <p
            role={query?.status === "error" ? "alert" : "status"}
            aria-live={query?.status === "error" ? "assertive" : "polite"}
            className="text-sm font-semibold text-slate-900"
          >
            {message}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-950">本機交易</h2>
            <Badge tone={transaction.status === "refunded" ? "green" : "orange"}>{transaction.status}</Badge>
          </div>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">商家</dt><dd className="font-semibold text-slate-950">{transaction.vendor.name}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">訂單編號</dt><dd className="font-mono text-xs text-slate-950">{transaction.orderNumber ?? "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Provider 交易序號</dt><dd className="text-slate-950">{transaction.providerTradeNo ? "已保存（不在此頁顯示）" : "缺少"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">原始金額</dt><dd className="font-semibold text-slate-950">{formatCurrency(transaction.grossAmountCents)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">本機已退</dt><dd className="font-semibold text-slate-950">{formatCurrency(transaction.refundedAmountCents)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Pending reservation</dt><dd className="font-semibold text-orange-700">{formatCurrency(pendingAmountCents)} · {transaction.refunds.length} 筆</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">最後更新</dt><dd className="text-slate-950">{formatDateTime(transaction.refundedAt ?? transaction.createdAt)}</dd></div>
          </dl>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-950">受控操作</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            送出後只會對 PayUni Sandbox 做一次 provider query。退款已成立時完成本機帳務；PayUni 明確顯示未退款時安全釋放 reservation；任何識別或金額不一致都不寫入。
          </p>
          <form action={reconcileAction} className="mt-5 grid gap-3">
            <CsrfField />
            <input type="hidden" name="id" value={transaction.id} />
            {transaction.refunds.length > 0 && transaction.status !== "refunded" ? (
              <SubmitButton
                pendingChildren="查詢並核對中…"
                pendingMessage="正在查詢 PayUni Sandbox 並核對退款終態，請勿重複送出。"
              >
                執行 Sandbox 終態對帳
              </SubmitButton>
            ) : (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">目前沒有可安全對帳的 pending reservation。</p>
            )}
          </form>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            沒有 pending reservation、provider 回應未驗證、金額不一致或環境不是 Sandbox 時，系統會 fail closed，不寫入資料。
          </p>

          {heldRefund && holdNextCountableAt && holdEarliestReleaseAt ? (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <h3 className="text-base font-semibold text-slate-950">釋放退款保留</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                保留建立 {holdWindowHours} 小時後，PayUni 每次確認「沒有退款」才計數，兩次計數至少間隔 {holdIntervalHours} 小時；連續 {holdPolicy.requiredConfirmations} 次（含釋放時的最新一次查詢）後才可人工釋放。太早或間隔不足的查詢只記稽核、不計數。系統不會自動釋放；釋放後該筆保留標為失敗並寫入稽核紀錄。
              </p>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-slate-500">已連續確認</dt><dd className="font-semibold text-slate-950">{heldRefund.providerNoRefundCheckCount} / {holdPolicy.requiredConfirmations} 次</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">最近確認</dt><dd className="text-slate-950">{heldRefund.providerNoRefundLastCheckedAt ? formatDateTime(heldRefund.providerNoRefundLastCheckedAt) : "尚未確認"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">下次可計數</dt><dd className="text-slate-950">{formatDateTime(holdNextCountableAt)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">最早可釋放</dt><dd className="text-slate-950">{formatDateTime(holdEarliestReleaseAt)}</dd></div>
              </dl>
              <form action={releaseHoldAction} className="mt-4 grid gap-3">
                <CsrfField />
                <input type="hidden" name="id" value={transaction.id} />
                <input type="hidden" name="refundRecordId" value={heldRefund.id} />
                <SubmitButton
                  pendingChildren="查詢並核對中…"
                  pendingMessage="正在向 PayUni 查詢最新狀態，確認沒有退款後才會釋放保留，請勿重複送出。"
                >
                  查詢 PayUni 並釋放保留
                </SubmitButton>
              </form>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
