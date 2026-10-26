import Link from "next/link";
import { FormSubmitButton } from "@/components/form-submit-button";
import {notFound} from "next/navigation";
import {requireVendorManager} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {CsrfField} from "@/components/csrf-field";
import {ButtonLink,PageHeader} from "@/components/ui";
import {setAffiliatePortalAccessAction} from "@/app/actions/affiliate-portal-actions";
import {VENDOR_PARTNER_ROLE,vendorMemberRoleLabel} from "@/lib/vendor-roles";

const PAGE_SIZE=25;
/** Partners are listed first, then every other role; each group pages by id.
 * The cursor names its group ("p." partner, "o." other) and the last id. */
const MEMBER_CURSOR=/^([po])\.([A-Za-z0-9_-]{1,160})$/u;

/** A same-page redirect after saving keeps the mounted form, and React ignores a changed
 * defaultValue on an existing <select>; remount the form whenever the stored access changes. */
function accessFormKey(access:{revision:number;vendorMemberId:string;active:boolean}|null){
 return access?`${access.revision}:${access.vendorMemberId}:${access.active}`:"none";
}

export default async function AffiliateAccessPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;saved?:string;q?:string;cursor?:string}>}){
 const vendor=await requireVendorManager();const {id}=await params;const query=await searchParams;
 const affiliate=await getDb().affiliate.findFirst({
   where:{id,vendorId:vendor.id},
   select:{name:true,portalAccess:{select:{
     vendorMemberId:true,revision:true,active:true,
     member:{select:{id:true,role:true,status:true,user:{select:{name:true,status:true}}}},
   }}},
 });
 if(!affiliate)notFound();
 const search=(query.q??"").trim().slice(0,120);
 const memberWhere={vendorId:vendor.id,status:"active",user:{status:"active",...(search?{name:{contains:search,mode:"insensitive" as const}}:{})}};
 const parsedCursor=query.cursor?MEMBER_CURSOR.exec(query.cursor):null;
 if(query.cursor&&!parsedCursor)notFound();
 const cursor=parsedCursor?{group:parsedCursor[1] as "p"|"o",id:parsedCursor[2]!}:null;
 const groupWhere={p:{...memberWhere,role:VENDOR_PARTNER_ROLE},o:{...memberWhere,role:{not:VENDOR_PARTNER_ROLE}}};
 // The cursor must be a listable member of this vendor in the named group.
 if(cursor&&!await getDb().vendorMember.findFirst({where:{...groupWhere[cursor.group],id:cursor.id},select:{id:true}}))notFound();
 const select={id:true,role:true,status:true,user:{select:{name:true,status:true}}} as const;
 const rows:Array<{group:"p"|"o";member:{id:string;role:string;status:string;user:{name:string;status:string}}}>=[];
 if(!cursor||cursor.group==="p"){
   const partners=await getDb().vendorMember.findMany({where:{...groupWhere.p,...(cursor?{id:{gt:cursor.id}}:{})},take:PAGE_SIZE+1,orderBy:{id:"asc"},select});
   rows.push(...partners.map(member=>({group:"p" as const,member})));
 }
 if(rows.length<=PAGE_SIZE){
   const others=await getDb().vendorMember.findMany({where:{...groupWhere.o,...(cursor?.group==="o"?{id:{gt:cursor.id}}:{})},take:PAGE_SIZE+1-rows.length,orderBy:{id:"asc"},select});
   rows.push(...others.map(member=>({group:"o" as const,member})));
 }
 const members:Array<{id:string;role?:string;status:string;user:{name:string;status:string}}>=rows.slice(0,PAGE_SIZE).map(row=>row.member);
 const current=affiliate.portalAccess?.member;
 // Keep the current recipient visible even when inactive or on another page.
 if(current&&!members.some(member=>member.id===current.id))members.unshift(current);
 const last=rows.length>PAGE_SIZE?rows[PAGE_SIZE-1]!:null;
 const next=last?`${last.group}.${last.member.id}`:null;
 return <><PageHeader title={`${affiliate.name}：夥伴入口授權`} description="指定現有商家成員查看這位夥伴的推廣碼與佣金帳本，角色為「夥伴」的成員排在最前面。此授權不提供商家財務或出款操作權限。" action={<ButtonLink href={`/affiliates/${encodeURIComponent(id)}`}>回到夥伴</ButtonLink>}/>
 {query.error?<p role="alert">授權已變更或無法存取，請重新整理後重試。</p>:null}{query.saved?<p role="status">夥伴入口授權已儲存。</p>:null}
 <form method="get" className="mb-4 flex gap-2"><label>搜尋成員<input name="q" maxLength={120} defaultValue={search} className="block rounded border p-2"/></label><button className="min-h-11 rounded border px-4">搜尋</button></form>
 <form key={accessFormKey(affiliate.portalAccess)} action={setAffiliatePortalAccessAction} className="grid max-w-xl gap-4 rounded-xl border bg-white p-5">
 <CsrfField/><input type="hidden" name="affiliateId" value={id}/><input type="hidden" name="expectedRevision" value={affiliate.portalAccess?.revision??0}/>
 <div><label htmlFor="affiliate-portal-member">授權成員</label><select id="affiliate-portal-member" name="vendorMemberId" required defaultValue={affiliate.portalAccess?.vendorMemberId??""} className="block min-h-11 w-full rounded border p-2"><option value="" disabled>請選擇成員</option>{members.map(member=><option key={member.id} value={member.id}>{member.user.name}{member.role?`（${vendorMemberRoleLabel(member.role)}）`:""}{member.status!=="active"||member.user.status!=="active"?"（已停用，可撤銷）":""}</option>)}</select></div>
 <label><input name="active" type="checkbox" defaultChecked={affiliate.portalAccess?.active??true}/>啟用夥伴入口</label>
 <FormSubmitButton pendingChildren="儲存中…" pendingMessage="正在儲存，請勿重複送出。" className="min-h-11 rounded bg-blue-700 px-4 py-2 text-white">儲存入口授權</FormSubmitButton>
 </form>{next?<Link className="mt-4 block min-h-11 underline" href={`?q=${encodeURIComponent(search)}&cursor=${encodeURIComponent(next)}`}>下一頁成員</Link>:null}<p className="mt-4">若成員未列出，請先確認其商家成員與帳號皆為啟用狀態。</p><ButtonLink href="/affiliate-portal">開啟夥伴入口</ButtonLink></>;
}
