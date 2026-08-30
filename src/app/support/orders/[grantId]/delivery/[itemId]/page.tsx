import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { PublicPolicyShell } from "@/components/public-policy";
import { Card } from "@/components/ui";
import { resolveBuyerOrderItemDelivery } from "@/lib/buyer-support-access";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "付款後內容 | CelebrateDeal",
  description: "透過安全的訂單權限查看付款後內容。",
  robots: { index: false, follow: false },
};

export default async function BuyerOrderItemDeliveryPage({ params }: {
  params: Promise<{ grantId: string; itemId: string }>;
}) {
  const { grantId, itemId } = await params;
  const delivery = await resolveBuyerOrderItemDelivery(getDb(), await cookies(), { grantId, itemId });
  if (!delivery) notFound();

  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-3xl" aria-labelledby="delivery-title">
        <Link href={`/support/orders/${grantId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">← 返回訂單</Link>
        <Card className="mt-4">
          <p className="text-sm font-semibold text-primary">訂單 {delivery.orderNumber}</p>
          <h1 id="delivery-title" className="mt-2 break-words text-3xl font-bold tracking-tight text-slate-950">{delivery.title}</h1>
          <p className="mt-2 text-sm text-slate-600">{delivery.productName}</p>

          {delivery.instructions ? (
            <section className="mt-6 rounded-lg bg-slate-50 p-4" aria-labelledby="delivery-instructions-title">
              <h2 id="delivery-instructions-title" className="font-semibold text-slate-950">使用說明</h2>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{delivery.instructions}</p>
            </section>
          ) : null}

          {delivery.destinationUrl ? (
            <a
              href={delivery.destinationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              前往商家提供的安全入口
            </a>
          ) : null}
          <p className="mt-4 text-xs leading-5 text-slate-600">入口來自下單時保存的交付快照。全額退款、授權到期或商家撤銷後，本頁會停止提供內容。</p>
        </Card>
      </main>
    </PublicPolicyShell>
  );
}
