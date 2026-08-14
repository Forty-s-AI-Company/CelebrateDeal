import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { addBuyerSupportReplyAction } from "@/app/actions/buyer-support-actions";
import { CsrfField } from "@/components/csrf-field";
import { PublicPolicyShell } from "@/components/public-policy";
import { Badge, Card, SubmitButton, TextArea } from "@/components/ui";
import {
  buyerVisibleSupportCaseScopes,
  resolveBuyerSupportGrants,
} from "@/lib/buyer-support-access";
import { getDb } from "@/lib/db";
import { revealSupportCaseContent, type SupportCaseContentKind } from "@/lib/support-case-pii";

export const dynamic = "force-dynamic";

function contentKind(eventType: string): SupportCaseContentKind | null {
  if (eventType === "created") return "initial_summary";
  if (eventType === "buyer_reply_added") return "buyer_reply";
  if (eventType === "customer_reply_added") return "customer_reply";
  return null;
}

function localDate(value: Date) {
  return value.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

export default async function BuyerSupportRequestDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ updated?: string | string[] }>;
}) {
  const { id } = await params;
  const grants = await resolveBuyerSupportGrants(getDb(), await cookies());
  if (grants.length === 0) notFound();
  const supportCase = await getDb().supportCase.findFirst({
    where: {
      id,
      OR: buyerVisibleSupportCaseScopes(grants),
    },
    include: {
      order: { select: { orderNumber: true, buyerMaskedName: true, buyerMaskedEmail: true } },
      events: {
        where: { audience: "buyer" },
        orderBy: { occurredAt: "asc" },
        take: 200,
      },
    },
  });
  if (!supportCase) notFound();
  const grant = grants.find((item) => item.vendorId === supportCase.vendorId && item.orderId === supportCase.orderId);
  if (!grant) notFound();

  const events = supportCase.events.map((event) => {
    const kind = contentKind(event.eventType);
    if (!kind || !event.payloadEncryptedEnvelope) return { ...event, content: null, unavailable: false };
    try {
      return {
        ...event,
        content: revealSupportCaseContent(event.payloadEncryptedEnvelope, {
          vendorId: supportCase.vendorId,
          supportCaseId: supportCase.id,
          recordId: event.id,
          kind,
        }),
        unavailable: false,
      };
    } catch {
      return { ...event, content: null, unavailable: true };
    }
  });
  const updated = (await searchParams)?.updated;

  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-4xl" aria-labelledby="request-title">
        <Link href="/support/requests" className="text-sm font-semibold text-primary hover:underline">← 返回我的客服案件</Link>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="request-title" className="text-3xl font-bold tracking-tight text-slate-950">{supportCase.caseNumber}</h1>
            <p className="mt-2 text-sm text-slate-600">訂單 {supportCase.order.orderNumber} · {supportCase.order.buyerMaskedName} · {supportCase.order.buyerMaskedEmail}</p>
          </div>
          <div className="flex gap-2"><Badge>{supportCase.status}</Badge><Badge tone={supportCase.priority === "p1" ? "orange" : "gray"}>{supportCase.priority.toUpperCase()}</Badge></div>
        </div>
        {updated ? <p role="status" className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">客服案件已更新。</p> : null}

        <Card className="mt-6">
          <h2 className="font-semibold text-slate-950">對話紀錄</h2>
          {events.length === 0 ? <p className="mt-3 text-sm text-slate-600">目前沒有可向買家顯示的訊息。</p> : (
            <ol className="mt-4 divide-y divide-border">
              {events.map((event) => (
                <li key={event.id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-2 text-sm"><b>{event.actorBuyerGrantId ? "買家" : "客服"}</b><time className="text-slate-500">{localDate(event.occurredAt)}</time></div>
                  {event.content ? <p className="mt-3 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">{event.content}</p> : null}
                  {event.unavailable ? <p role="alert" className="mt-3 text-sm text-red-700">這筆內容目前無法安全解密，客服不會以猜測內容取代。</p> : null}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {supportCase.status !== "closed" ? (
          <Card className="mt-6">
            <h2 className="font-semibold text-slate-950">新增回覆</h2>
            <form action={addBuyerSupportReplyAction} className="mt-4 grid gap-3">
              <CsrfField />
              <input type="hidden" name="grantId" value={grant.id} />
              <input type="hidden" name="supportCaseId" value={supportCase.id} />
              <input type="hidden" name="revision" value={supportCase.revision} />
              <input type="hidden" name="dedupKey" value={randomUUID()} />
              <TextArea label="回覆內容" name="message" required maxLength={4_000} rows={5} placeholder="補充實際狀況；請勿填完整卡號、CVV、密碼或 Token。" />
              <SubmitButton pendingChildren="傳送中…" pendingMessage="正在安全傳送回覆，請勿重複送出。">送出回覆</SubmitButton>
            </form>
          </Card>
        ) : null}
      </main>
    </PublicPolicyShell>
  );
}
