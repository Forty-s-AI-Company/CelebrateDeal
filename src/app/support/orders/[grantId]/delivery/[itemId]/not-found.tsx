import Link from "next/link";

import { PublicPolicyShell } from "@/components/public-policy";
import { Card } from "@/components/ui";

export default function BuyerDeliveryNotFound() {
  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-2xl" aria-labelledby="delivery-unavailable-title">
        <Card>
          <h1 id="delivery-unavailable-title" className="text-2xl font-bold text-slate-950">付款後內容目前無法使用</h1>
          <p className="mt-3 text-sm leading-6 text-slate-700">可能原因包含訂單尚未付款、授權到期、全額退款、內容已撤銷，或這筆舊訂單沒有安全交付快照。</p>
          <div className="mt-5 flex flex-wrap gap-4 text-sm">
            <Link href="/support/orders" className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2">返回我的訂單</Link>
            <Link href="/support/requests" className="inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-2">建立客服案件</Link>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-600">本頁不會顯示已撤銷的入口、說明或任何加密內容。</p>
        </Card>
      </main>
    </PublicPolicyShell>
  );
}
