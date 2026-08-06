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
    if (target.status === "refunded" && target.refundedAmountCents === target.grossAmountCents && target.refunds.length === 0) {
      redirect(`/admin/billing/refund-reconciliation/${id}?status=already_reconciled`);
    }
    const provider = getPaymentProvider("payuni");
    if (!provider.queryPayment || !target.providerTradeNo) {
      redirect(`/admin/billing/refund-reconciliation/${id}?status=error`);
    }

    try {
      const snapshot = await provider.queryPayment({ transaction: target });
      const outcome = await reconcilePayUniRefund({
        db,
        transactionId: target.id,
        providerSnapshot: snapshot,
        actor: { id: finance.member.id, label: finance.member.role },
      });
      revalidatePath(`/admin/billing/refund-reconciliation/${target.id}`);
      revalidatePath("/admin/billing/dashboard");
      redirect(`/admin/billing/refund-reconciliation/${target.id}?status=${outcome.disposition}`);
    } catch {
      redirect(`/admin/billing/refund-reconciliation/${target.id}?status=error`);
    }
  }

  const message = resultMessage(query?.status);
  const pendingAmountCents = transaction.refunds.reduce((sum, refund) => sum + refund.refundAmountCents, 0);

  return (
    <>
      <PageHeader
        title="PayUni 退款終態對帳"
        description="只對帳已由 PayUni Sandbox 接受、但本機仍保留 pending reservation 的退款；不會重送退款。"
        action={<Link href="/admin/billing/dashboard" className="text-sm font-semibold text-primary hover:underline">返回財務總覽</Link>}
      />

      {message ? (
        <Card className={query?.status === "error" ? "mb-6 border-orange-200 bg-orange-50" : "mb-6 border-green-200 bg-green-50"}>
          <p className="text-sm font-semibold text-slate-900">{message}</p>
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
            送出後只會對 PayUni Sandbox 做一次 provider query；只有交易序號、訂單編號、原始金額、退款終態與本機 pending 金額全部一致，才會在同一個 Serializable transaction 內完成對帳。
          </p>
          <form action={reconcileAction} className="mt-5 grid gap-3">
            <CsrfField />
            <input type="hidden" name="id" value={transaction.id} />
            {transaction.refunds.length > 0 && transaction.status !== "refunded" ? (
              <SubmitButton>執行 Sandbox 終態對帳</SubmitButton>
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
