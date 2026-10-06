"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { AffiliatePortalConflict, setAffiliatePortalAccess } from "@/lib/affiliate-portal";

export async function setAffiliatePortalAccessAction(form: FormData) {
 await assertServerActionSecurity(form);
 const {vendor,auth}=await requireVendorManagerContext();
 const affiliateId=form.get("affiliateId");
 if(typeof affiliateId!=="string"||!/^[A-Za-z0-9_-]{1,160}$/u.test(affiliateId))throw new Error("Invalid affiliate");
 let error=false;
 try {
  const result=await setAffiliatePortalAccess(getDb(),{vendorId:vendor.id,role:auth.member!.role},{affiliateId,vendorMemberId:form.get("vendorMemberId"),expectedRevision:Number(form.get("expectedRevision")),active:form.get("active")==="on"});
  error=!result;
 } catch(failure) {
  if(failure instanceof AffiliatePortalConflict||failure instanceof ZodError||(failure instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2034"].includes(failure.code)))error=true;
  else throw failure;
 }
 const path=`/affiliates/${encodeURIComponent(affiliateId)}/access`;
 if(error)redirect(`${path}?error=conflict`);
 revalidatePath(path);revalidatePath("/affiliate-portal","layout");redirect(`${path}?saved=1`);
}
