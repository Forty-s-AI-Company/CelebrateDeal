import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createSupportCaseAction } from "@/app/actions/support-case-actions";
import {
  grantCommerceEntitlementAction,
  transitionServiceFulfillmentAction,
  transitionShippingFulfillmentAction,
} from "@/app/actions/commerce-order-actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, SelectField, SubmitButton, TextArea } from "@/components/ui";
import type { CommerceOrderPii } from "@/lib/commerce-order-pii";
import type { CommerceOrderDetailRecord } from "@/lib/commerce-order-read-model";
import type { CustomCheckoutAnswers, CustomCheckoutFields } from "@/lib/commerce-custom-checkout";
import { formatCurrency } from "@/lib/format";

const orderStatusLabels = {
  draft: "草稿",
  pending_payment: "待付款",
  paid: "已付款",
  payment_failed: "付款失敗",
  expired: "付款逾期",
  cancelled: "已取消",
  partially_refunded: "部分退款",
  refunded: "已退款",
} as const;

const fulfillmentLabels: Record<string, string> = {
  pending: "待處理",
  packing: "備貨中",
  shipped: "已出貨",
  refund_review: "退款後待物流確認",
  delivered: "已送達",
  returned: "已退回",
  granted: "已授權",
  revoked: "已撤銷",
  scheduling: "安排中",
  scheduled: "已排程",
  completed: "已完成",
  cancelled: "已取消",
};

function statusTone(status: string): "blue" | "orange" | "gray" | "green" | "red" {
  if (["paid", "delivered", "granted", "completed"].includes(status)) return "green";
  if (["pending_payment", "packing", "refund_review", "scheduling", "scheduled", "partially_refunded"].includes(status)) return "orange";
  if (["payment_failed", "cancelled", "revoked", "refunded"].includes(status)) return "red";
  return "gray";
}

function localDate(value: Date | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(value)
    : "—";
}

function taipeiDateTimeLocal(value: Date | null | undefined) {
  if (!value) return "";
  return value.toLocaleString("sv-SE", { timeZone: "Asia/Taipei" }).replace(" ", "T").slice(0, 16);
}

function HiddenFulfillmentIdentity({ orderId, id, revision, idName = "fulfillmentId" }: {
  orderId: string;
  id: string;
  revision: number;
  idName?: "fulfillmentId" | "entitlementId";
}) {
  return (
    <>
      <CsrfField />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name={idName} value={id} />
      <input type="hidden" name="revision" value={revision} />
    </>
  );
}

function ShippingActions({ orderId, fulfillment }: {
  orderId: string;
  fulfillment: NonNullable<CommerceOrderDetailRecord["items"][number]["shippingFulfillment"]>;
}) {
  if (fulfillment.status === "pending") {
    return (
      <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
        <form action={transitionShippingFulfillmentAction} className="self-end">
          <HiddenFulfillmentIdentity orderId={orderId} id={fulfillment.id} revision={fulfillment.revision} />
          <input type="hidden" name="nextStatus" value="packing" />
          <SubmitButton pendingChildren="更新中…">開始備貨</SubmitButton>
        </form>
        <ShippingForm orderId={orderId} fulfillment={fulfillment} />
      </div>
    );
  }
  if (fulfillment.status === "packing") return <ShippingForm orderId={orderId} fulfillment={fulfillment} />;
  if (fulfillment.status === "shipped") {
    return (
      <form action={transitionShippingFulfillmentAction}>
        <HiddenFulfillmentIdentity orderId={orderId} id={fulfillment.id} revision={fulfillment.revision} />
        <input type="hidden" name="nextStatus" value="delivered" />
        <SubmitButton pendingChildren="更新中…">標記已送達</SubmitButton>
      </form>
    );
  }
  if (fulfillment.status === "refund_review") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-950">這筆訂單已全額退款，但包裹先前已出貨。請依實際物流結果結案，系統會保留原出貨與追蹤紀錄。</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <form action={transitionShippingFulfillmentAction}>
            <HiddenFulfillmentIdentity orderId={orderId} id={fulfillment.id} revision={fulfillment.revision} />
            <input type="hidden" name="nextStatus" value="returned" />
            <SubmitButton pendingChildren="結案中…" pendingMessage="正在記錄包裹退回結果，請勿重複送出。">標記包裹已退回</SubmitButton>
          </form>
          <form action={transitionShippingFulfillmentAction}>
            <HiddenFulfillmentIdentity orderId={orderId} id={fulfillment.id} revision={fulfillment.revision} />
            <input type="hidden" name="nextStatus" value="delivered" />
            <SubmitButton pendingChildren="更新中…" pendingMessage="正在記錄包裹送達結果，請勿重複送出。">標記仍已送達</SubmitButton>
          </form>
        </div>
      </div>
    );
  }
  return null;
}

function ShippingForm({ orderId, fulfillment }: {
  orderId: string;
  fulfillment: NonNullable<CommerceOrderDetailRecord["items"][number]["shippingFulfillment"]>;
}) {
  return (
    <form action={transitionShippingFulfillmentAction} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
      <HiddenFulfillmentIdentity orderId={orderId} id={fulfillment.id} revision={fulfillment.revision} />
      <input type="hidden" name="nextStatus" value="shipped" />
      <Field label="物流／交付方式" name="carrierName" required maxLength={120} defaultValue={fulfillment.carrierName} placeholder="例如：黑貓、自取" />
      <Field label="追蹤編號（選填）" name="trackingNumber" maxLength={160} defaultValue={fulfillment.trackingNumber} />
      <Field label="追蹤網址（HTTPS／選填）" name="trackingUrl" maxLength={2048} defaultValue={fulfillment.trackingUrl} />
      <div className="md:col-span-3"><SubmitButton pendingChildren="出貨中…">確認出貨</SubmitButton></div>
    </form>
  );
}

function ServiceActions({ orderId, fulfillment }: {
  orderId: string;
  fulfillment: NonNullable<CommerceOrderDetailRecord["items"][number]["serviceFulfillment"]>;
}) {
  if (fulfillment.status === "completed" || fulfillment.status === "cancelled") return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <form action={transitionServiceFulfillmentAction} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <HiddenFulfillmentIdentity orderId={orderId} id={fulfillment.id} revision={fulfillment.revision} />
        <input type="hidden" name="nextStatus" value="scheduled" />
        <Field label="服務時間（台北時間）" name="scheduledAt" type="datetime-local" required defaultValue={taipeiDateTimeLocal(fulfillment.scheduledAt)} />
        <SubmitButton pendingChildren="排程中…">{fulfillment.status === "scheduled" ? "更新時間" : "確認排程"}</SubmitButton>
      </form>
      {fulfillment.status === "scheduled" ? (
        <form action={transitionServiceFulfillmentAction} className="self-end rounded-md border border-slate-200 p-3">
          <HiddenFulfillmentIdentity orderId={orderId} id={fulfillment.id} revision={fulfillment.revision} />
          <input type="hidden" name="nextStatus" value="completed" />
          <SubmitButton pendingChildren="更新中…">標記服務完成</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function BuyerDetails({ order, pii }: { order: CommerceOrderDetailRecord; pii: CommerceOrderPii | null }) {
  const shipping = pii?.shipping;
  return (
    <Card>
      <h2 className="text-base font-semibold text-slate-950">買家與交付資料</h2>
      {!pii ? <p role="alert" className="mt-3 text-sm text-red-700">加密資料暫時無法解密；請勿改用其他來源猜測地址，稍後再試。</p> : null}
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div><dt className="text-slate-500">姓名</dt><dd className="font-medium">{pii?.buyer.name ?? order.buyerMaskedName}</dd></div>
        <div className="min-w-0"><dt className="text-slate-500">Email</dt><dd className="break-all font-medium">{pii?.buyer.email ?? order.buyerMaskedEmail}</dd></div>
        <div><dt className="text-slate-500">電話</dt><dd className="font-medium">{pii?.buyer.phone ?? order.buyerMaskedPhone ?? "—"}</dd></div>
        <div><dt className="text-slate-500">收件摘要</dt><dd className="font-medium">{order.shippingMaskedSummary ?? "不需配送"}</dd></div>
      </dl>
      {shipping ? (
        <address className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm not-italic leading-6">
          {shipping.recipientName} · {shipping.phone}<br />
          {shipping.postalCode ? `${shipping.postalCode} ` : ""}{shipping.countryCode} {shipping.administrativeArea}{shipping.locality}<br />
          {shipping.addressLine1}{shipping.addressLine2 ? ` ${shipping.addressLine2}` : ""}
        </address>
      ) : null}
    </Card>
  );
}

const supportStatusLabels: Record<string, string> = {
  open: "待受理",
  in_progress: "處理中",
  waiting_customer: "等待買家",
  waiting_finance: "等待平台財務",
  resolved: "已解決",
  closed: "已結案",
};

function SupportCasesPanel({ order }: { order: CommerceOrderDetailRecord }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">客服案件</h2>
          <p className="mt-1 text-sm text-slate-600">從這張訂單建立案件；內文會加密保存，退款請求只會交給平台財務，不會直接呼叫付款服務。</p>
        </div>
        <Link href="/support-cases" className="text-sm font-semibold text-primary hover:underline">查看客服佇列</Link>
      </div>
      {order.supportCases.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {order.supportCases.map((supportCase) => (
            <li key={supportCase.id}>
              <Link href={`/support-cases/${encodeURIComponent(supportCase.id)}`} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-3 text-sm hover:bg-slate-50">
                <span>
                  <b className="block text-slate-950">{supportCase.caseNumber}</b>
                  <span className="text-slate-500">{supportCase.category} · {supportCase.assignedMember?.user.name ?? "未指派"}</span>
                </span>
                <span className="flex gap-2">
                  <Badge tone={supportCase.priority === "p0" ? "red" : supportCase.priority === "p1" ? "orange" : "gray"}>{supportCase.priority.toUpperCase()}</Badge>
                  <Badge tone={supportCase.status === "resolved" || supportCase.status === "closed" ? "green" : "blue"}>{supportStatusLabels[supportCase.status]}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="mt-4 text-sm text-slate-500">這張訂單尚無客服案件。</p>}
      <form action={createSupportCaseAction} className="mt-5 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
        <CsrfField />
        <input type="hidden" name="orderId" value={order.id} />
        <input type="hidden" name="intakeKey" value={randomUUID()} />
        <SelectField label="問題類型" name="category" defaultValue="general">
          <option value="payment">付款狀態</option>
          <option value="refund">退款需求</option>
          <option value="fulfillment">履約／配送</option>
          <option value="access">數位內容／服務存取</option>
          <option value="general">其他問題</option>
        </SelectField>
        <SelectField label="優先等級" name="priority" defaultValue="p2">
          <option value="p0">P0 — 金流錯帳或全面阻斷</option>
          <option value="p1">P1 — 單筆狀態異常</option>
          <option value="p2">P2 — 一般詢問</option>
        </SelectField>
        <div className="md:col-span-2">
          <TextArea label="案件摘要" name="summary" required maxLength={4_000} rows={4} placeholder="記錄買家反映內容與已確認事實；不要貼卡號、CVV、Token、Cookie 或原始 provider payload。" />
        </div>
        <div className="md:col-span-2"><SubmitButton pendingChildren="建立中…" pendingMessage="正在建立客服案件，請勿重複送出。">建立客服案件</SubmitButton></div>
      </form>
    </Card>
  );
}

export function CommerceOrderDetail({ order, pii, customCheckoutAnswersByItemId = {}, feedback }: {
  order: CommerceOrderDetailRecord;
  pii: CommerceOrderPii | null;
  customCheckoutAnswersByItemId?: Record<string, { fields: CustomCheckoutFields; answers: CustomCheckoutAnswers | null; unavailable: boolean }>;
  feedback?: { error?: string; updated?: string };
}) {
  const isFulfillable = order.status === "paid" || order.status === "partially_refunded";
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/orders" className="text-sm font-medium text-blue-700 hover:underline">← 返回訂單</Link>
        <Badge tone={statusTone(order.status)}>{orderStatusLabels[order.status]}</Badge>
      </div>
      {feedback?.updated ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">履約狀態已更新。</p> : null}
      {feedback?.error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">資料已被其他操作更新，或目前狀態不允許這個動作；請重新確認。</p> : null}
      <Card>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="min-w-0"><p className="text-xs text-slate-500">訂單編號</p><p className="break-all font-semibold">{order.orderNumber}</p></div>
          <div><p className="text-xs text-slate-500">成立時間</p><p className="font-semibold">{localDate(order.createdAt)}</p></div>
          <div><p className="text-xs text-slate-500">訂單金額</p><p className="font-semibold">{formatCurrency(order.totalAmountCents, order.currency)}</p></div>
          <div><p className="text-xs text-slate-500">累計退款</p><p className="font-semibold">{formatCurrency(order.refundedAmountCents, order.currency)}</p></div>
        </div>
      </Card>
      <BuyerDetails order={order} pii={pii} />
      <SupportCasesPanel order={order} />
      <section className="grid gap-4" aria-labelledby="order-items-heading">
        <h2 id="order-items-heading" className="text-lg font-semibold text-slate-950">商品與履約</h2>
        {order.items.map((item) => {
          const customCheckout = customCheckoutAnswersByItemId[item.id];
          return (
          <Card key={item.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="font-semibold [overflow-wrap:anywhere]">{item.productName}</h3><p className="break-words text-sm text-slate-500">{item.quantity} × {formatCurrency(item.unitPriceCents, order.currency)} · {item.fulfillmentType}</p></div>
              {item.shippingFulfillment ? <Badge tone={statusTone(item.shippingFulfillment.status)}>{fulfillmentLabels[item.shippingFulfillment.status]}</Badge> : null}
              {item.entitlement ? <Badge tone={statusTone(item.entitlement.status)}>{fulfillmentLabels[item.entitlement.status]}</Badge> : null}
              {item.serviceFulfillment ? <Badge tone={statusTone(item.serviceFulfillment.status)}>{fulfillmentLabels[item.serviceFulfillment.status]}</Badge> : null}
            </div>
            {item.shippingFulfillment ? <p className="mt-3 text-sm text-slate-600">物流：{item.shippingFulfillment.carrierName ?? "尚未指定"} · 追蹤：{item.shippingFulfillment.trackingNumber ?? "—"}</p> : null}
            {item.serviceFulfillment ? <p className="mt-3 text-sm text-slate-600">服務時間：{localDate(item.serviceFulfillment.scheduledAt)}</p> : null}
            {customCheckout ? (
              <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm">
                <h4 className="font-semibold text-violet-950">買家自訂資料</h4>
                {customCheckout.unavailable ? <p role="alert" className="mt-2 text-red-700">加密資料暫時無法解密，請稍後再試。</p> : (
                  <dl className="mt-2 grid gap-2">
                    {customCheckout.fields.map((field) => <div key={field.key} className="grid gap-1 sm:grid-cols-[180px_1fr]"><dt className="text-slate-600">{field.label}</dt><dd className="whitespace-pre-wrap font-medium text-slate-950">{String(customCheckout.answers?.[field.key] ?? "")}</dd></div>)}
                  </dl>
                )}
              </div>
            ) : null}
            {isFulfillable || (order.status === "refunded" && item.shippingFulfillment?.status === "refund_review") ? <div className="mt-4">
              {item.shippingFulfillment ? <ShippingActions orderId={order.id} fulfillment={item.shippingFulfillment} /> : null}
              {isFulfillable && item.entitlement?.status === "pending" ? (
                <form action={grantCommerceEntitlementAction}>
                  <HiddenFulfillmentIdentity orderId={order.id} id={item.entitlement.id} revision={item.entitlement.revision} idName="entitlementId" />
                  <SubmitButton pendingChildren="授權中…">建立數位授權</SubmitButton>
                </form>
              ) : null}
              {isFulfillable && item.serviceFulfillment ? <ServiceActions orderId={order.id} fulfillment={item.serviceFulfillment} /> : null}
            </div> : null}
          </Card>
          );
        })}
      </section>
      <Card>
        <h2 className="text-base font-semibold text-slate-950">退款與事件歷史</h2>
        <p className="mt-2 text-sm text-slate-600">正式退款仍由平台財務 MFA 流程執行；本頁只顯示已完成、可追溯的結果。</p>
        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {order.events.map((event) => <li key={event.id} className="flex flex-wrap justify-between gap-2 py-3"><span>{event.eventType}</span><time className="text-slate-500">{localDate(event.occurredAt)}</time></li>)}
          {order.events.length === 0 ? <li className="py-3 text-slate-500">尚無事件</li> : null}
        </ul>
      </Card>
    </div>
  );
}
