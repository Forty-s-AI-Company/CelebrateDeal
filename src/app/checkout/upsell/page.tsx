import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { resolveBuyerSupportGrant } from "@/lib/buyer-support-access";
import { resolvePaidOrderPostPurchaseOffer } from "@/lib/post-purchase-upsell-access";
import { UpsellOffer } from "./upsell-offer";

export const dynamic = "force-dynamic";

export default async function CheckoutUpsellPage({ searchParams }: {
  searchParams: Promise<{ grant?: string | string[]; offer?: string | string[] }>;
}) {
  const query = await searchParams;
  const grantId = typeof query.grant === "string" ? query.grant : null;
  const kind = query.offer === "downsell" ? "downsell" : "upsell";
  if (!grantId || !/^[A-Za-z0-9_-]{1,191}$/u.test(grantId)) notFound();
  const db = getDb();
  const grant = await resolveBuyerSupportGrant(db, await cookies(), grantId);
  if (!grant || grant.order.status !== "paid") redirect("/checkout/result");
  const resolved = await resolvePaidOrderPostPurchaseOffer(db, {
    vendorId: grant.vendorId, orderId: grant.orderId, kind,
  });
  if (!resolved) redirect("/checkout/result");
  return <UpsellOffer grantId={grant.id} initialOffer={resolved.offer} />;
}
