import { notFound } from "next/navigation";
import { LearnerNotificationSettings } from "@/components/learner-notification-settings";
import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

export const dynamic="force-dynamic";

/** Existing recipient-owned preferences remain discoverable after a refund.
 * Cursor pagination is bounded and never selects another tenant/customer. */
export default async function StudentNotificationsPage({params,searchParams}:{params:Promise<{vendorSlug:string}>;searchParams:Promise<{after?:string}>}) {
 const {vendorSlug}=await params;const {session}=await requireStudentPortalSession(vendorSlug);
 const {after}=await searchParams;if(after && !/^[A-Za-z0-9_-]{1,128}$/u.test(after))notFound();
 const rows=await getDb().learnerNotificationPreference.findMany({where:{vendorId:session.vendorId,customerKeyHash:session.customerKeyHash,...(after?{id:{gt:after}}:{})},orderBy:{id:"asc"},take:21,select:{id:true,productId:true,product:{select:{name:true}}}});
 const visible=rows.slice(0,20);const products=[...new Map(visible.map(row=>[row.productId,{id:row.productId,name:row.product.name}])).values()];
 const last=visible.at(-1);const next=rows.length>20 && last?`/portal/${encodeURIComponent(vendorSlug)}/notifications?after=${encodeURIComponent(last.id)}`:null;
 return <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 sm:py-10"><div className="mx-auto max-w-4xl">
  <a className="inline-flex min-h-11 items-center text-sm font-bold text-blue-700" href={`/portal/${encodeURIComponent(vendorSlug)}`}>← 回到學員中心</a>
  <h1 className="mt-4 text-2xl font-bold">通知設定</h1><p className="mt-2 text-sm text-slate-600">退款或權益到期後，仍可取消既有通知。開啟通知與收件驗證仍需要目前的購買權益。</p>
  {products.length?products.map(product=><article key={product.id} className="mt-6"><h2 className="text-lg font-bold">{product.name}</h2><LearnerNotificationSettings vendorSlug={vendorSlug} courseId={product.id} /></article>):<p className="mt-6">目前沒有已登記的通知設定。</p>}
  {next?<a className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4" href={next}>下一頁通知設定</a>:null}
 </div></main>;
}
