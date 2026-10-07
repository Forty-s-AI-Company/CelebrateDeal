import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { CommerceCheckoutEntry } from "@/components/commerce-checkout-entry";
import { getDb } from "@/lib/db";
import { PostPurchaseUnavailableError } from "@/lib/post-purchase-credit";
import { resolvePostPurchaseRecoveryEntry } from "@/lib/post-purchase-recovery-entry";

export const dynamic = "force-dynamic";

export default async function PostPurchaseRecoveryPage({ params }: { params: Promise<{ grantId: string }> }) {
  let recoveryRecord;
  try { recoveryRecord = await resolvePostPurchaseRecoveryEntry(getDb(), await cookies(), (await params).grantId); }
  catch (error) {
    if (error instanceof PostPurchaseUnavailableError) notFound();
    throw error;
  }
  return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="mb-5 text-2xl font-black text-slate-950">恢復原加購訂單</h1>
    <CommerceCheckoutEntry recoveryRecord={recoveryRecord} /></main>;
}
