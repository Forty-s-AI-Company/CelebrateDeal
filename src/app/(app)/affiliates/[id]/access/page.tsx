import Link from "next/link";
import {notFound} from "next/navigation";
import {requireVendorManager} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {CsrfField} from "@/components/csrf-field";
import {ButtonLink,PageHeader} from "@/components/ui";
import {setAffiliatePortalAccessAction} from "@/app/actions/affiliate-portal-actions";

export default async function AffiliateAccessPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;saved?:string;q?:string;cursor?:string}>}){
 const vendor=await requireVendorManager();const {id}=await params;const query=await searchParams;
 const affiliate=await getDb().affiliate.findFirst({
   where:{id,vendorId:vendor.id},
   select:{name:true,portalAccess:{select:{
     vendorMemberId:true,revision:true,active:true,
     member:{select:{id:true,status:true,user:{select:{name:true,status:true}}}},
   }}},
 });
 if(!affiliate)notFound();
 const search=(query.q??"").trim().slice(0,120);
 const memberWhere={vendorId:vendor.id,status:"active",user:{status:"active",...(search?{name:{contains:search,mode:"insensitive" as const}}:{})}};
 const cursor=query.cursor&&/^[A-Za-z0-9_-]{1,160}$/u.test(query.cursor)?query.cursor:null;
 if(query.cursor&&!cursor)notFound();
 if(cursor&&!await getDb().vendorMember.findFirst({where:{...memberWhere,id:cursor},select:{id:true}}))notFound();
 const rows=await getDb().vendorMember.findMany({where:{...memberWhere,...(cursor?{id:{gt:cursor}}:{})},take:26,orderBy:{id:"asc"},select:{id:true,status:true,user:{select:{name:true,status:true}}}});
 const members=rows.slice(0,25);
 const current=affiliate.portalAccess?.member;
 // Keep the current recipient visible even when inactive or on another page.
 if(current&&!members.some(member=>member.id===current.id))members.unshift(current);
 const next=rows.length>25?rows[24]!.id:null;
 return <><PageHeader title={`${affiliate.name}：夥伴入口授權`} description="指定現有商家成員查看這位夥伴的推廣碼與佣金帳本。此授權不提供商家財務或出款操作權限。" action={<ButtonLink href={`/affiliates/${encodeURIComponent(id)}`}>回到夥伴</ButtonLink>}/>
 {query.error?<p role="alert">授權已變更或無法存取，請重新整理後重試。</p>:null}{query.saved?<p role="status">夥伴入口授權已儲存。</p>:null}
 <form method="get" className="mb-4 flex gap-2"><label>搜尋成員<input name="q" maxLength={120} defaultValue={search} className="block rounded border p-2"/></label><button className="min-h-11 rounded border px-4">搜尋</button></form>
 <form action={setAffiliatePortalAccessAction} className="grid max-w-xl gap-4 rounded-xl border bg-white p-5">
 <CsrfField/><input type="hidden" name="affiliateId" value={id}/><input type="hidden" name="expectedRevision" value={affiliate.portalAccess?.revision??0}/>
 <div><label htmlFor="affiliate-portal-member">授權成員</label><select id="affiliate-portal-member" name="vendorMemberId" required defaultValue={affiliate.portalAccess?.vendorMemberId??""} className="block min-h-11 w-full rounded border p-2"><option value="" disabled>請選擇成員</option>{members.map(member=><option key={member.id} value={member.id}>{member.user.name}{member.status!=="active"||member.user.status!=="active"?"（已停用，可撤銷）":""}</option>)}</select></div>
 <label><input name="active" type="checkbox" defaultChecked={affiliate.portalAccess?.active??true}/>啟用夥伴入口</label>
 <button className="min-h-11 rounded bg-blue-700 px-4 py-2 text-white">儲存入口授權</button>
 </form>{next?<Link className="mt-4 block min-h-11 underline" href={`?q=${encodeURIComponent(search)}&cursor=${encodeURIComponent(next)}`}>下一頁成員</Link>:null}<p className="mt-4">若成員未列出，請先確認其商家成員與帳號皆為啟用狀態。</p><ButtonLink href="/affiliate-portal">開啟夥伴入口</ButtonLink></>;
}
