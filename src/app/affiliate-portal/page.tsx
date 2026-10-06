import Link from "next/link";
import {notFound} from "next/navigation";
import {requireAuth} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {listAffiliatePortalAccess} from "@/lib/affiliate-portal";
export default async function AffiliatePortalIndex({searchParams}:{searchParams:Promise<{cursor?:string}>}){
 const auth=await requireAuth({nextPath:"/affiliate-portal"});const query=await searchParams;
 const access=await listAffiliatePortalAccess(getDb(),{userId:auth.user.id},query.cursor);if(!access)notFound();
 return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-bold">夥伴入口</h1><p className="mt-3">查看已獲授權的推廣夥伴帳本與分享連結。</p>{access.entries.length===0?<p className="mt-6">尚未取得入口授權，請聯絡商家管理員。</p>:<ul className="mt-6 grid gap-3">{access.entries.map(item=><li key={`${item.vendorSlug}-${item.affiliateId}`}><Link className="block min-h-11 rounded-xl border bg-white p-4" href={`/affiliate-portal/${encodeURIComponent(item.vendorSlug)}/${encodeURIComponent(item.affiliateId)}`}>{item.vendorName} · {item.affiliateName}</Link></li>)}</ul>}{access.nextCursor?<Link className="mt-5 inline-block min-h-11 underline" href={`/affiliate-portal?cursor=${encodeURIComponent(access.nextCursor)}`}>下一頁夥伴</Link>:null}<Link className="mt-6 ml-5 inline-block min-h-11 underline" href="/dashboard">回到帳號</Link></main>;
}
