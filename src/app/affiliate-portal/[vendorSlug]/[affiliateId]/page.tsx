import {sellableLiveReadinessQuery,isSellableLiveReadinessCandidate} from "@/lib/sellable-live";
import {allowsLegacyAffiliateAttribution} from "@/lib/live-quota-policy";
import Link from "next/link";
import {getCanonicalAppUrl} from "@/lib/app-url";
import {ReferralShareControls} from "@/components/referral-share-controls";
import {notFound} from "next/navigation";
import {requireAuth} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {formatCurrency,formatDateTime} from "@/lib/format";
import {getAffiliatePortalStatement} from "@/lib/affiliate-portal";

export default async function AffiliateStatement({params,searchParams}:{params:Promise<{vendorSlug:string;affiliateId:string}>;searchParams:Promise<{cursor?:string;liveCursor?:string}>}){
 const {vendorSlug,affiliateId}=await params;const query=await searchParams;
 const path=`/affiliate-portal/${encodeURIComponent(vendorSlug)}/${encodeURIComponent(affiliateId)}`;
 const auth=await requireAuth({nextPath:path});
 const vendor=await getDb().vendor.findUnique({where:{slug:vendorSlug},select:{id:true}});if(!vendor)notFound();
 const statement=await getAffiliatePortalStatement(getDb(),{userId:auth.user.id},vendor.id,affiliateId,query.cursor);if(!statement)notFound();
 // Offer only this tenant's existing public playback destinations. Each
 // destination retains the established merchant ?ref attribution flow.
 const liveCursor=query.liveCursor;
 if(liveCursor&&!/^[A-Za-z0-9_-]{1,160}$/u.test(liveCursor))notFound();
 const readiness=sellableLiveReadinessQuery(vendor.id);
 // Public playback rejects a live when any bound product is unavailable.
 const publicWhere={...readiness.where,products:{
   some:{vendorId:vendor.id,product:{is:{vendorId:vendor.id,isActive:true,fulfillmentTypeConfirmed:true}}},
   every:{vendorId:vendor.id,product:{is:{vendorId:vendor.id,isActive:true,fulfillmentTypeConfirmed:true}}},
 }};
 if(liveCursor&&!await getDb().live.findFirst({where:{...publicWhere,id:liveCursor},select:{id:true}}))notFound();
 const candidates=await getDb().live.findMany({...readiness,where:{...publicWhere,...(liveCursor?{id:{gt:liveCursor}}:{})},orderBy:{id:"asc"},take:21,select:{...readiness.select,id:true,slug:true,title:true,quotaPolicy:true}});
 const destinations=candidates.slice(0,20).filter(live=>isSellableLiveReadinessCandidate(live)&&allowsLegacyAffiliateAttribution(live.quotaPolicy));
 const nextLive=candidates.length>20?candidates[19]!.id:null;
 return <main className="mx-auto max-w-4xl p-6"><h1 className="text-2xl font-bold">{statement.affiliate.name}：佣金帳本</h1><p className="mt-3">佣金淨額包含退款與爭議回沖；實際出款仍由商家財務流程處理。</p>
 {statement.requiresReconciliation?<p role="alert" className="mt-5">部分收入尚未完成帳本對帳，暫不顯示合計。</p>:<p className="mt-5 text-xl" aria-label="佣金帳本淨額">帳本淨額：{formatCurrency(statement.balanceCents??0)}</p>}
 <p className="mt-4">推廣碼：{statement.affiliate.code}</p><section aria-label="商家推廣連結">{destinations.length?destinations.map(live=><div key={live.id}><Link className="block min-h-11 underline" href={`/live/${encodeURIComponent(live.slug)}?ref=${encodeURIComponent(statement.affiliate.code)}`} prefetch={false}>推廣：{live.title}</Link><ReferralShareControls title={live.title} referralUrl={`${getCanonicalAppUrl()}/live/${encodeURIComponent(live.slug)}?ref=${encodeURIComponent(statement.affiliate.code)}`}/></div>):<p>此頁沒有可推廣的公開場次。</p>}{nextLive?<Link className="block min-h-11 underline" href={`${path}?${new URLSearchParams({...query.cursor?{cursor:query.cursor}:{},liveCursor:nextLive})}`}>下一頁場次</Link>:null}</section>
 <div className="mt-5 overflow-x-auto"><table className="w-full text-left"><caption className="text-left font-bold">佣金紀錄</caption><thead><tr><th>月份</th><th>狀態</th><th>帳本淨額</th><th>歸因時間</th></tr></thead><tbody>{statement.commissions.map(row=><tr key={row.id}><td>{row.monthKey}</td><td>{{pending:"待確認",approved:"已核准",locked:"結算中",paid:"已出款",void:"已作廢"}[row.status]}</td><td>{row.balanceCents===null?"待對帳":formatCurrency(row.balanceCents)}</td><td>{formatDateTime(row.attributedAt)}</td></tr>)}</tbody></table></div>
 {statement.nextCursor?<Link className="mt-5 inline-block min-h-11 underline" href={`${path}?cursor=${encodeURIComponent(statement.nextCursor)}`}>下一頁佣金</Link>:null}<Link className="ml-5 inline-block min-h-11 underline" href="/affiliate-portal">回到夥伴入口</Link></main>;
}
