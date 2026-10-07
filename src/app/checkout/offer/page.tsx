import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getCsrfToken } from "@/lib/csrf";
import { resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { resolvePaidOrderPostPurchaseOffer } from "@/lib/post-purchase-upsell-access";
import { UpsellOffer } from "@/app/checkout/upsell/upsell-offer";

export default async function CheckoutUpsellPage({ searchParams }: {
  searchParams: Promise<{ grant?: string | string[]; offer?: string | string[] }>;
}) {
  const query = await searchParams;
  if (typeof query.grant !== "string" || !/^[A-Za-z0-9_-]{1,191}$/u.test(query.grant)
    || (query.offer !== undefined && query.offer !== "upsell" && query.offer !== "downsell")) notFound();
  const grant = await resolveBuyerSupportGrant(getDb(), await cookies(), query.grant);
  if (!grant || grant.order.status !== "paid") notFound();
  const kind = query.offer === "downsell" ? "downsell" : "upsell";
  const resolved = await resolvePaidOrderPostPurchaseOffer(getDb(), { vendorId: grant.vendorId, orderId: grant.orderId, kind });
  if (!resolved) return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="text-2xl font-bold">目前沒有可用的加購方案</h1><Link className="mt-6 inline-block underline" href="/checkout/result">查看原訂單</Link></main>;
  return <UpsellOffer key={`${grant.id}:${kind}`} grantId={grant.id} vendorId={grant.vendorId}
    initialOffer={resolved.offer} csrfToken={await getCsrfToken()} />;
}
