import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";

import { reviewSupportRefundHandoffAction } from "@/app/actions/support-case-actions";
import { CsrfField } from "@/components/csrf-field";
import { SupportRefundSelection } from "@/components/support-refund-selection";
import { Badge, Card, PageHeader, SubmitButton } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { revealSupportCaseContent } from "@/lib/support-case-pii";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminSupportHandoffDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string | string[]; updated?: string | string[] }>;
}) {
  const { id } = await params;
  await requireFinanceAdmin();
  const handoff = await getDb().supportRefundHandoff.findUnique({
    where: { id },
    include: {
      vendor: { select: { name: true } },
      supportCase: { select: { id: true, caseNumber: true, priority: true, status: true } },
      order: {
        include: {
          refunds: {
            where: { status: "processed" },
            orderBy: { occurredAt: "desc" },
            include: { supportHandoffLinks: { select: { handoffId: true } } },
          },
        },
      },
      requestedBy: { include: { user: { select: { name: true } } } },
      reviewedBy: { select: { name: true } },
      completedRefund: true,
      completedRefundLinks: {
        include: { refund: true },
        orderBy: { linkedAt: "asc" },
      },
    },
  });
  if (!handoff) notFound();

  let reason: string | null = null;
  let reasonUnavailable = false;
  try {
    reason = revealSupportCaseContent(handoff.reasonEncryptedEnvelope, {
      vendorId: handoff.vendorId,
      supportCaseId: handoff.supportCaseId,
      recordId: handoff.id,
      kind: "refund_reason",
    });
  } catch {
    reasonUnavailable = true;
  }
  const availableRefunds = handoff.order.refunds.filter((refund) => (
    refund.paymentTransactionId === handoff.paymentTransactionId
    && refund.supportHandoffLinks.length === 0
  ));
  const query = await searchParams;
  const error = one(query?.error);
  const updated = one(query?.updated);

  return (
    <>
      <PageHeader title={`退款交接 ${handoff.supportCase.caseNumber}`} description="此頁記錄 support handoff；實際退款仍由 canonical 退款流程執行。完成交接時可綁定一筆或多筆 processed CommerceOrderRefund。" />
      <div className="mb-4 flex flex-wrap justify-between gap-3">
        <Link href="/admin/support-cases" className="text-sm font-semibold text-primary hover:underline">← 返回退款客服交接</Link>
        <Badge tone={handoff.status === "completed" ? "green" : handoff.status === "declined" ? "red" : "orange"}>{handoff.status}</Badge>
      </div>
      {updated ? <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">交接狀態已更新：{updated}</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">操作未完成：{error}。請重新確認 ledger 與目前 revision。</p> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-slate-950">交接摘要</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div><dt className="text-slate-500">商家</dt><dd className="font-medium">{handoff.vendor.name}</dd></div>
            <div><dt className="text-slate-500">訂單</dt><dd className="font-medium">{handoff.order.orderNumber}</dd></div>
            <div><dt className="text-slate-500">申請金額</dt><dd className="font-medium">{formatCurrency(handoff.requestedAmountCents, handoff.order.currency)}</dd></div>
            <div><dt className="text-slate-500">申請人</dt><dd className="font-medium">{handoff.requestedBy.user.name}</dd></div>
            <div><dt className="text-slate-500">檢視人</dt><dd className="font-medium">{handoff.reviewedBy?.name ?? "—"}</dd></div>
          </dl>
          {reason ? <p className="mt-4 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-6">{reason}</p> : null}
          {reasonUnavailable ? <p role="alert" className="mt-4 text-sm text-red-700">加密退款原因目前無法解密；不得猜測或從 log 補值。</p> : null}
          {handoff.completedRefundLinks.length > 0 ? (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <h3 className="text-sm font-semibold text-emerald-900">已綁定退款證據</h3>
              <ul className="mt-2 grid gap-1 text-sm text-emerald-900">
                {handoff.completedRefundLinks.map(({ refund }) => (
                  <li key={refund.id}>{formatCurrency(refund.amountCents, handoff.order.currency)} · {refund.providerName} · <span className="break-all">{refund.eventIdentity}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
          <Link href="/admin/billing/dashboard" className="mt-5 inline-flex min-h-11 items-center font-semibold text-primary hover:underline">前往 canonical 退款執行／reservation →</Link>
        </Card>
        <Card>
          <h2 className="font-semibold text-slate-950">財務處理</h2>
          {handoff.status === "requested" ? (
            <div className="mt-4 grid gap-3">
              <form action={reviewSupportRefundHandoffAction}>
                <CsrfField />
                <input type="hidden" name="handoffId" value={handoff.id} />
                <input type="hidden" name="revision" value={handoff.revision} />
                <input type="hidden" name="dedupKey" value={randomUUID()} />
                <input type="hidden" name="nextStatus" value="reviewing" />
                <SubmitButton pendingChildren="更新中…">開始財務檢視</SubmitButton>
              </form>
              <form action={reviewSupportRefundHandoffAction}>
                <CsrfField />
                <input type="hidden" name="handoffId" value={handoff.id} />
                <input type="hidden" name="revision" value={handoff.revision} />
                <input type="hidden" name="dedupKey" value={randomUUID()} />
                <input type="hidden" name="nextStatus" value="declined" />
                <SubmitButton pendingChildren="退回中…">退回商家補充</SubmitButton>
              </form>
            </div>
          ) : handoff.status === "reviewing" ? (
            <div className="mt-4 grid gap-4">
              {availableRefunds.length > 0 ? (
                <form action={reviewSupportRefundHandoffAction} className="grid gap-3">
                  <CsrfField />
                  <input type="hidden" name="handoffId" value={handoff.id} />
                  <input type="hidden" name="revision" value={handoff.revision} />
                  <input type="hidden" name="dedupKey" value={randomUUID()} />
                  <input type="hidden" name="nextStatus" value="completed" />
                  <SupportRefundSelection
                    refunds={availableRefunds.map((refund) => ({
                      id: refund.id,
                      providerName: refund.providerName,
                      eventIdentity: refund.eventIdentity,
                      amountCents: refund.amountCents,
                    }))}
                    requestedAmountCents={handoff.requestedAmountCents}
                    currency={handoff.order.currency}
                  />
                </form>
              ) : <p className="text-sm text-slate-600">尚無可用的 processed CommerceOrderRefund。Provider request、pending reservation 與已被其他 handoff 綁定的退款都不能作為完成證據。</p>}
              <form action={reviewSupportRefundHandoffAction}>
                <CsrfField />
                <input type="hidden" name="handoffId" value={handoff.id} />
                <input type="hidden" name="revision" value={handoff.revision} />
                <input type="hidden" name="dedupKey" value={randomUUID()} />
                <input type="hidden" name="nextStatus" value="declined" />
                <SubmitButton pendingChildren="退回中…">退回商家補充</SubmitButton>
              </form>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">此交接已進入終態。若需要新的退款處理，應由商家建立新的客服案件，不覆寫本紀錄。</p>
          )}
        </Card>
      </div>
    </>
  );
}
