import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  addSupportCaseNoteAction,
  addSupportCaseCustomerReplyAction,
  assignSupportCaseAction,
  requestSupportRefundHandoffAction,
  transitionSupportCaseAction,
} from "@/app/actions/support-case-actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, PageHeader, SelectField, SubmitButton, TextArea } from "@/components/ui";
import { requireVendorSupportMfa } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { revealSupportCaseContent, type SupportCaseContentKind } from "@/lib/support-case-pii";

const statusLabels: Record<string, string> = {
  open: "待受理",
  in_progress: "處理中",
  waiting_customer: "等待買家",
  waiting_finance: "等待平台財務",
  resolved: "已解決",
  closed: "已結案",
};

const eventLabels: Record<string, string> = {
  created: "建立案件",
  note_added: "新增內部紀錄",
  buyer_reply_added: "買家回覆",
  customer_reply_added: "回覆買家",
  status_changed: "更新案件狀態",
  assignment_changed: "變更案件 owner",
  refund_requested: "送出退款交接",
  refund_review_started: "平台財務開始檢視",
  refund_declined: "平台財務退回退款請求",
  refund_completed: "退款已由 canonical ledger 確認",
};

const nextStatuses: Record<string, readonly string[]> = {
  open: ["in_progress", "waiting_customer", "resolved"],
  in_progress: ["waiting_customer", "resolved"],
  waiting_customer: ["in_progress", "resolved"],
  waiting_finance: [],
  resolved: ["in_progress", "closed"],
  closed: [],
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function eventContentKind(eventType: string): SupportCaseContentKind | null {
  if (eventType === "created") return "initial_summary";
  if (eventType === "note_added") return "internal_note";
  if (eventType === "buyer_reply_added") return "buyer_reply";
  if (eventType === "customer_reply_added") return "customer_reply";
  return null;
}

function localDate(value: Date | null | undefined) {
  return value ? value.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }) : "—";
}

function revealTimeline<T extends { id: string; eventType: string; payloadEncryptedEnvelope: string | null }>(
  events: T[],
  vendorId: string,
  supportCaseId: string,
) {
  return events.map((event) => {
    const kind = eventContentKind(event.eventType);
    if (!kind || !event.payloadEncryptedEnvelope) return { ...event, content: null, contentUnavailable: false };
    try {
      return {
        ...event,
        content: revealSupportCaseContent(event.payloadEncryptedEnvelope, {
          vendorId,
          supportCaseId,
          recordId: event.id,
          kind,
        }),
        contentUnavailable: false,
      };
    } catch {
      return { ...event, content: null, contentUnavailable: true };
    }
  });
}

function revealRefundReason(
  handoff: { id: string; reasonEncryptedEnvelope: string } | null,
  vendorId: string,
  supportCaseId: string,
) {
  if (!handoff) return { refundReason: null, refundReasonUnavailable: false };
  try {
    return {
      refundReason: revealSupportCaseContent(handoff.reasonEncryptedEnvelope, {
        vendorId,
        supportCaseId,
        recordId: handoff.id,
        kind: "refund_reason",
      }),
      refundReasonUnavailable: false,
    };
  } catch {
    return { refundReason: null, refundReasonUnavailable: true };
  }
}

function responseIsOverdue(input: { firstRespondedAt: Date | null; responseDueAt: Date }, now = new Date()) {
  return !input.firstRespondedAt && input.responseDueAt < now;
}

function refundCanBeRequested(input: {
  refundHandoff: unknown;
  status: string;
  order: {
    status: string;
    primaryPaymentTransactionId: string | null;
    paidAmountCents: number;
    refundedAmountCents: number;
  };
}) {
  return !input.refundHandoff
    && !["resolved", "closed"].includes(input.status)
    && ["paid", "partially_refunded"].includes(input.order.status)
    && Boolean(input.order.primaryPaymentTransactionId)
    && input.order.paidAmountCents > input.order.refundedAmountCents;
}

async function loadSupportCaseDetail(id: string, vendorId: string, canManageOrders: boolean) {
  const db = getDb();
  const membersPromise = canManageOrders
    ? db.vendorMember.findMany({
      where: { vendorId, status: "active", role: { in: ["owner", "admin", "support"] } },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    })
    : Promise.resolve([]);
  const managerFinancePromise = canManageOrders
    ? db.supportCase.findFirst({
      where: { id, vendorId },
      select: {
        refundHandoff: true,
        order: {
          select: {
            status: true,
            paidAmountCents: true,
            refundedAmountCents: true,
            primaryPaymentTransactionId: true,
          },
        },
      },
    })
    : Promise.resolve(null);
  const [supportCase, members, managerFinance] = await Promise.all([
    db.supportCase.findFirst({
      where: { id, vendorId },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            currency: true,
            buyerMaskedName: true,
            buyerMaskedEmail: true,
          },
        },
        createdBy: { include: { user: { select: { name: true } } } },
        assignedMember: { include: { user: { select: { name: true } } } },
        events: {
          orderBy: { occurredAt: "desc" },
          take: 200,
          include: {
            actor: { include: { user: { select: { name: true } } } },
            platformActor: { select: { name: true } },
          },
        },
      },
    }),
    membersPromise,
    managerFinancePromise,
  ]);
  if (!supportCase || (canManageOrders && !managerFinance)) return null;

  const refundDetails = managerFinance
    ? revealRefundReason(managerFinance.refundHandoff, vendorId, supportCase.id)
    : { refundReason: null, refundReasonUnavailable: false };
  const remainingRefundCents = managerFinance
    ? managerFinance.order.paidAmountCents - managerFinance.order.refundedAmountCents
    : 0;
  const canRequestRefund = managerFinance
    ? refundCanBeRequested({
      status: supportCase.status,
      refundHandoff: managerFinance.refundHandoff,
      order: managerFinance.order,
    })
    : false;

  return {
    supportCase,
    members,
    managerFinance,
    remainingRefundCents,
    canRequestRefund,
    ...refundDetails,
  };
}

export default async function SupportCaseDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string | string[]; updated?: string | string[] }>;
}) {
  const { id } = await params;
  const { vendor, member } = await requireVendorSupportMfa(`/support-cases/${encodeURIComponent(id)}`);
  const canManageOrders = member.role === "owner" || member.role === "admin";
  const detail = await loadSupportCaseDetail(id, vendor.id, canManageOrders);
  if (!detail) notFound();
  const {
    supportCase,
    members,
    managerFinance,
    remainingRefundCents,
    canRequestRefund,
    refundReason,
    refundReasonUnavailable,
  } = detail;

  const timeline = revealTimeline(supportCase.events, vendor.id, supportCase.id);
  const query = await searchParams;
  const error = one(query?.error);
  const updated = one(query?.updated);
  const isResponseOverdue = responseIsOverdue(supportCase);

  return (
    <>
      <PageHeader title={`客服案件 ${supportCase.caseNumber}`} description="內容加密、事件 append-only；退款請求只建立平台財務 handoff，不代表 provider 已退款。" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/support-cases" className="text-sm font-semibold text-primary hover:underline">← 返回客服佇列</Link>
        <div className="flex gap-2">
          <Badge tone={supportCase.priority === "p0" ? "red" : supportCase.priority === "p1" ? "orange" : "gray"}>{supportCase.priority.toUpperCase()}</Badge>
          <Badge tone={supportCase.status === "resolved" || supportCase.status === "closed" ? "green" : "blue"}>{statusLabels[supportCase.status]}</Badge>
        </div>
      </div>
      {updated ? <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">案件已更新：{updated}</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">操作未完成；資料可能已更新或目前狀態不允許此操作，請重新確認。</p> : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="grid gap-5">
          <Card>
            <h2 className="font-semibold text-slate-950">訂單與案件資料</h2>
            <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
              <div><dt className="text-slate-500">訂單</dt><dd>{canManageOrders ? <Link href={`/orders/${encodeURIComponent(supportCase.order.id)}`} className="font-semibold text-primary hover:underline">{supportCase.order.orderNumber}</Link> : <span className="font-semibold">{supportCase.order.orderNumber}</span>}</dd></div>
              <div><dt className="text-slate-500">買家</dt><dd className="font-medium">{supportCase.order.buyerMaskedName} · {supportCase.order.buyerMaskedEmail}</dd></div>
              <div><dt className="text-slate-500">類型</dt><dd className="font-medium">{supportCase.category}</dd></div>
              <div><dt className="text-slate-500">Owner</dt><dd className="font-medium">{supportCase.assignedMember?.user.name ?? "未指派"}</dd></div>
              <div><dt className="text-slate-500">首次回應</dt><dd>{localDate(supportCase.firstRespondedAt)}</dd></div>
              <div><dt className="text-slate-500">首次回應期限</dt><dd className={isResponseOverdue ? "font-semibold text-red-700" : undefined}>{localDate(supportCase.responseDueAt)}</dd></div>
              <div><dt className="text-slate-500">建立人</dt><dd>{supportCase.createdBy?.user.name ?? "買家"}</dd></div>
            </dl>
          </Card>

          <Card>
            <h2 className="font-semibold text-slate-950">案件時間軸</h2>
            <ol className="mt-4 divide-y divide-slate-100">
              {timeline.map((event) => (
                <li key={event.id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-2 text-sm">
                    <b>{eventLabels[event.eventType]}</b>
                    <time className="text-slate-500">{localDate(event.occurredAt)}</time>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{event.actor?.user.name ?? event.platformActor?.name ?? (event.actorBuyerGrantId ? "買家" : "系統")}</p>
                  {event.content ? <p className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">{event.content}</p> : null}
                  {event.contentUnavailable ? <p role="alert" className="mt-3 text-sm text-red-700">這筆加密內容目前無法解密；請勿從其他來源猜測。</p> : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="grid content-start gap-5">
          {supportCase.status !== "closed" ? (
            <Card>
              <h2 className="font-semibold text-slate-950">回覆買家</h2>
              <form action={addSupportCaseCustomerReplyAction} className="mt-4 grid gap-3">
                <CsrfField />
                <input type="hidden" name="supportCaseId" value={supportCase.id} />
                <input type="hidden" name="revision" value={supportCase.revision} />
                <input type="hidden" name="dedupKey" value={randomUUID()} />
                <TextArea label="公開回覆" name="message" required maxLength={4_000} rows={5} placeholder="買家會在客服查詢頁看到這段內容。請勿貼內部備註或敏感資料。" />
                <SubmitButton pendingChildren="傳送中…" pendingMessage="正在安全傳送回覆，請勿重複送出。">傳送給買家</SubmitButton>
              </form>
            </Card>
          ) : null}

          {supportCase.status !== "closed" ? (
            <Card>
              <h2 className="font-semibold text-slate-950">新增內部紀錄</h2>
              <form action={addSupportCaseNoteAction} className="mt-4 grid gap-3">
                <CsrfField />
                <input type="hidden" name="supportCaseId" value={supportCase.id} />
                <input type="hidden" name="revision" value={supportCase.revision} />
                <input type="hidden" name="dedupKey" value={randomUUID()} />
                <TextArea label="處理紀錄" name="note" required maxLength={4_000} rows={5} placeholder="記錄已確認事實與下一步；不要貼付款憑證或敏感資料。" />
                <SubmitButton pendingChildren="保存中…">保存紀錄</SubmitButton>
              </form>
            </Card>
          ) : null}

          {canManageOrders && supportCase.status !== "closed" ? (
            <Card>
              <h2 className="font-semibold text-slate-950">指派 owner</h2>
              <form action={assignSupportCaseAction} className="mt-4 grid gap-3">
                <CsrfField />
                <input type="hidden" name="supportCaseId" value={supportCase.id} />
                <input type="hidden" name="revision" value={supportCase.revision} />
                <input type="hidden" name="dedupKey" value={randomUUID()} />
                <SelectField label="負責成員" name="assignedMemberId" defaultValue={supportCase.assignedMemberId}>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.user.name} · {member.role}</option>)}
                </SelectField>
                <SubmitButton pendingChildren="指派中…">更新 owner</SubmitButton>
              </form>
            </Card>
          ) : null}

          {canManageOrders && nextStatuses[supportCase.status]?.length ? (
            <Card>
              <h2 className="font-semibold text-slate-950">更新狀態</h2>
              <div className="mt-4 grid gap-2">
                {nextStatuses[supportCase.status].map((status) => (
                  <form key={status} action={transitionSupportCaseAction}>
                    <CsrfField />
                    <input type="hidden" name="supportCaseId" value={supportCase.id} />
                    <input type="hidden" name="revision" value={supportCase.revision} />
                    <input type="hidden" name="dedupKey" value={randomUUID()} />
                    <input type="hidden" name="nextStatus" value={status} />
                    <SubmitButton pendingChildren="更新中…">標記為「{statusLabels[status]}」</SubmitButton>
                  </form>
                ))}
              </div>
            </Card>
          ) : null}

          {managerFinance ? <Card>
            <h2 className="font-semibold text-slate-950">退款交接</h2>
            {managerFinance.refundHandoff ? (
              <div className="mt-3 text-sm leading-6 text-slate-600">
                <p><b>狀態：</b>{managerFinance.refundHandoff.status}</p>
                <p><b>申請金額：</b>{formatCurrency(managerFinance.refundHandoff.requestedAmountCents, supportCase.order.currency)}</p>
                {refundReason ? <p className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 p-3">{refundReason}</p> : null}
                {refundReasonUnavailable ? <p role="alert" className="mt-2 text-red-700">退款原因目前無法解密。</p> : null}
                <p className="mt-3 text-xs">只有平台財務完成 provider 操作並產生 canonical CommerceOrderRefund 後，案件才會顯示 completed。</p>
              </div>
            ) : canRequestRefund ? (
              <form action={requestSupportRefundHandoffAction} className="mt-4 grid gap-3">
                <CsrfField />
                <input type="hidden" name="supportCaseId" value={supportCase.id} />
                <input type="hidden" name="revision" value={supportCase.revision} />
                <input type="hidden" name="dedupKey" value={randomUUID()} />
                <Field label={`申請退款金額（最多 ${formatCurrency(remainingRefundCents, supportCase.order.currency)}）`} name="requestedAmount" type="number" required min={0.01} max={remainingRefundCents / 100} step={0.01} />
                <TextArea label="退款原因" name="reason" required maxLength={4_000} rows={4} />
                <SubmitButton pendingChildren="交接中…" pendingMessage="正在建立退款交接，請勿重複送出。">交給平台財務</SubmitButton>
              </form>
            ) : <p className="mt-3 text-sm text-slate-600">目前訂單狀態或剩餘可退款金額不允許建立退款交接。</p>}
          </Card> : null}
        </aside>
      </div>
    </>
  );
}
