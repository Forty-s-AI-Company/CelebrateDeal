import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";

import { createBuyerSupportCaseAction } from "@/app/actions/buyer-support-actions";
import { CsrfField } from "@/components/csrf-field";
import { PolicyDraftNotice, PublicPolicyShell } from "@/components/public-policy";
import { Card, SelectField, SubmitButton, TextArea } from "@/components/ui";
import {
  buyerVisibleSupportCaseScopes,
  resolveBuyerSupportGrants,
} from "@/lib/buyer-support-access";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "訂單客服查詢 | CelebrateDeal",
  description: "使用結帳時安全建立的訂單憑證查詢與回覆客服案件。",
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BuyerSupportRequestsPage({ searchParams }: {
  searchParams?: Promise<{ error?: string | string[] }>;
}) {
  const grants = await resolveBuyerSupportGrants(getDb(), await cookies());
  const scopes = buyerVisibleSupportCaseScopes(grants);
  const cases = scopes.length > 0
    ? await getDb().supportCase.findMany({
        where: { OR: scopes },
        select: {
          id: true,
          vendorId: true,
          orderId: true,
          caseNumber: true,
          category: true,
          priority: true,
          status: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      })
    : [];
  const error = one((await searchParams)?.error);

  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-5xl" aria-labelledby="buyer-support-title">
        <div className="mb-7">
          <p className="text-sm font-semibold text-primary">訂單協助</p>
          <h1 id="buyer-support-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">我的客服案件</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">這裡只辨識目前瀏覽器結帳時取得的安全訂單憑證，不支援以訂單編號或 Email 猜測查詢。</p>
        </div>
        <PolicyDraftNotice status="LIMITED ACCESS — BROWSER ORDER CAPABILITY REQUIRED" owner="buyer support capability" />
        {error ? <p role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">操作未完成。憑證可能已過期、請求過於頻繁，或案件資料剛被更新；請從原結帳瀏覽器再試一次。</p> : null}

        {grants.length === 0 ? (
          <Card className="mt-6">
            <h2 className="font-semibold text-slate-950">找不到可用的訂單客服憑證</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">請使用完成結帳時的同一個瀏覽器與裝置開啟此頁。基於安全理由，我們不會在這裡要求完整卡號、密碼、Token 或 Cookie。</p>
            <Link href="/support" className="mt-4 inline-flex min-h-11 items-center font-semibold text-primary hover:underline">查看一般客服與安全受理方式 →</Link>
          </Card>
        ) : (
          <div className="mt-6 grid gap-6">
            {grants.map((grant) => {
              const orderCases = cases.filter((item) => item.vendorId === grant.vendorId && item.orderId === grant.orderId);
              return (
                <Card key={grant.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-950">{grant.order.vendor.name}</h2>
                      <p className="mt-1 text-sm text-slate-600">訂單 {grant.order.orderNumber} · {grant.order.buyerMaskedName} · {grant.order.buyerMaskedEmail}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{grant.order.status}</span>
                  </div>

                  {orderCases.length > 0 ? (
                    <div className="mt-5 grid gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">既有案件</h3>
                      {orderCases.map((supportCase) => (
                        <Link key={supportCase.id} href={`/support/requests/${encodeURIComponent(supportCase.id)}`} className="rounded-md border border-border p-3 text-sm hover:bg-slate-50">
                          <b>{supportCase.caseNumber}</b><span className="ml-2 text-slate-600">{supportCase.category} · {supportCase.status} · {supportCase.priority.toUpperCase()}</span>
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  <form action={createBuyerSupportCaseAction} className="mt-6 grid gap-3 border-t border-border pt-5">
                    <CsrfField />
                    <input type="hidden" name="grantId" value={grant.id} />
                    <input type="hidden" name="intakeKey" value={randomUUID()} />
                    <SelectField label="需要協助的類型" name="category" defaultValue="general">
                      <option value="payment">付款問題</option>
                      <option value="refund">退款問題</option>
                      <option value="fulfillment">出貨／履約</option>
                      <option value="access">內容／服務存取</option>
                      <option value="general">其他問題</option>
                    </SelectField>
                    <TextArea label="問題說明" name="summary" required maxLength={4_000} rows={5} placeholder="請描述發生時間、畫面狀態與希望獲得的協助。請勿填完整卡號、CVV、密碼或 Token。" />
                    <SubmitButton pendingChildren="建立中…" pendingMessage="正在安全建立客服案件，請勿重複送出。">建立客服案件</SubmitButton>
                  </form>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </PublicPolicyShell>
  );
}
