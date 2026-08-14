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
import { reconcilePayUniRefund } from "@/lib/payuni-refund-reconciliation";

const RESULT_MESSAGES = {
  reconciled: "已完成 PayUni Sandbox 退款對帳，待處理退款保留已原子化轉為已處理。",
  already_reconciled: "此交易已完成退款對帳，系統沒有再次查詢後寫入。",
  provider_not_refunded: "PayUni 查詢結果確認這次退款沒有成立；本機 reservation 已安全釋放，可重新確認資料後再操作。",
  nothing_pending: "目前沒有可執行的 pending reservation；系統未查詢 PayUni，也未變更本機帳務。",
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
        select: { id: true, refundAmountCents: true, status: true, createdAt: true },
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

    let outcome: Awaited<ReturnType<typeof reconcilePayUniRefund>>;
    try {
      const snapshot = await provider.queryPayment({ transaction: target });
      outcome = await reconcilePayUniRefund({
        db,
        transactionId: target.id,
        providerSnapshot: snapshot,
        actor: { id: finance.member.id, label: finance.member.role },
      });
    } catch {
      redirect(`/admin/billing/refund-reconciliation/${target.id}?status=error`);
    }
    revalidatePath(`/admin/billing/refund-reconciliation/${target.id}`);
    revalidatePath("/admin/billing/dashboard");
    redirect(`/admin/billing/refund-reconciliation/${target.id}?status=${outcome.disposition}`);
  }

  const message = resultMessage(query?.status);
  const pendingAmountCents = transaction.refunds.reduce((sum, refund) => sum + refund.refundAmountCents, 0);

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
        </Card>
      </div>
    </>
  );
}
