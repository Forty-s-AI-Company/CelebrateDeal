"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { LineRichMenuSchema } from "@/lib/line-rich-menu";
import { parseRichMenuDraftContent,richMenuPublicationLocked,richMenuPublicationView,saveRichMenuDraftContent,type RichMenuPublicationView } from "@/lib/line-rich-menu-draft-content";
import { reconcileLineRichMenuDraft,syncLineRichMenuDraft } from "@/lib/line-rich-menu-sync";
import { LINE_RICH_MENU_IMAGE_LIMIT,LINE_RICH_MENU_PLACEHOLDERS,type RichMenuLinks } from "@/lib/line-rich-menu-publication";
import { findLineAccount } from "@/lib/line-account-routing";

const ReferenceSchema = z.object({
  id: z.string().min(1).max(128),
  revision: z.number().int().min(1).max(2_147_483_646),
});
type DraftReference = z.infer<typeof ReferenceSchema>;
export type RichMenuActionState = {
  status: "idle" | "saved" | "deleted" | "error" | "synced" | "uncertain";
  error: "invalid_input" | "conflict" | "save_failed" | "locked" | "not_configured" | "invalid_image" | "image_too_large" | "image_size_mismatch" | "unresolved_links" | "sync_failed" | null;
  reference: DraftReference | null;
  publication?:RichMenuPublicationView|null;
};

function readMenu(formData:FormData) {
  const raw=formData.get("menu");if(typeof raw!=="string"||raw.length>40_000)return null;
  try {const parsed=LineRichMenuSchema.safeParse(JSON.parse(raw));return parsed.success?parsed.data:null;}catch{return null;}
}
async function publishIntent(formData:FormData,intent:"sync"|"reconcile",reference:DraftReference,context:{vendorId:string;actorId:string}):Promise<RichMenuActionState> {
  const db=getDb();let result;
  if(intent==="reconcile")result=await reconcileLineRichMenuDraft(db,context,reference);
  else {
    const menu=readMenu(formData);if(!menu)return {status:"error",error:"invalid_input",reference};
    const image=formData.get("image");
    if(!(image instanceof Blob)||image.size===0)return {status:"error",error:"invalid_image",reference};
    if(image.size>LINE_RICH_MENU_IMAGE_LIMIT)return {status:"error",error:"image_too_large",reference};
    const links:RichMenuLinks={};
    for(const key of LINE_RICH_MENU_PLACEHOLDERS) {const value=formData.get(key);if(typeof value==="string"&&value.length<=1000)links[key]=value.trim();}
    result=await syncLineRichMenuDraft(db,context,reference,menu,new Uint8Array(await image.arrayBuffer()),links);
  }
  revalidatePath("/settings/line");
  if(result.status==="synced"||result.status==="uncertain")return {status:result.status,error:null,reference:result.reference,publication:result.publication};
  return {status:"error",error:result.status==="failed"?"sync_failed":result.status,reference:result.reference,publication:result.publication};
}


async function editDraft(reference:DraftReference|null,vendorId:string,intent:"save"|"delete",formData:FormData,accountId:string):Promise<RichMenuActionState> {
  const fail=(error:RichMenuActionState["error"]):RichMenuActionState=>({status:"error",error,reference});
  const invalid=()=>fail("invalid_input");
  let result:RichMenuActionState;
    const db = getDb();
    const current=reference?await db.lineRichMenuDraft.findFirst({where:{vendorId:vendorId,lineOfficialAccountId:accountId,...reference}}):null;
    const content=current&&parseRichMenuDraftContent(current.menu);
    if(reference&&(!current||!content))return fail("conflict");
    if(content&&richMenuPublicationLocked(content.publication))return {...fail("locked"),publication:richMenuPublicationView(content.publication)};
    if (intent === "delete") {
      if (!reference) return invalid();
      const deleted = await db.lineRichMenuDraft.deleteMany({ where: { vendorId: vendorId, ...reference } });
      if (deleted.count !== 1) return fail("conflict");
      result = { status: "deleted", error: null, reference: null,publication:null };
    } else {
      const menu=readMenu(formData);if(!menu)return invalid();
      const saved=saveRichMenuDraftContent(menu,content?.publication??null);
      if (reference) {
        const updated = await db.lineRichMenuDraft.updateMany({
          where: { vendorId: vendorId, ...reference },
          data: { menu: saved, revision: { increment: 1 } },
        });
        if (updated.count !== 1) return fail("conflict");
        result = { status: "saved", error: null, reference: { id: reference.id, revision: reference.revision + 1 },publication:content?.publication?{...richMenuPublicationView(content.publication)!,status:"outdated"}:null };
      } else {
        // Each account has one draft; simultaneous first saves must conflict.
        const created = await db.lineRichMenuDraft.create({
          data: { vendorId: vendorId, lineOfficialAccountId:accountId, menu }, select: { id: true, revision: true },
        });
        result = { status: "saved", error: null, reference: created };
      }
    }
  return result;
}

/** Every write is owner-scoped and compares both identity and revision to reject stale tabs. */
export async function updateRichMenuDraftAction(
  previous: RichMenuActionState,
  formData: FormData,
): Promise<RichMenuActionState> {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();const vendor=auth.vendor;
  // Prior action state is client-controlled; only echo a bounded reference, never use it for writes.
  const previousReference = ReferenceSchema.safeParse(previous?.reference);
  const fallbackReference = previousReference.success ? previousReference.data : null;
  const invalid = (): RichMenuActionState => ({ status: "error", error: "invalid_input", reference: fallbackReference });
  const id = formData.get("id");
  const rawRevision = formData.get("revision");
  if (typeof id !== "string" || typeof rawRevision !== "string" || !/^\d+$/.test(rawRevision)) return invalid();
  const parsed = ReferenceSchema.safeParse({ id, revision: Number(rawRevision) });
  if (!parsed.success && !(id === "" && rawRevision === "0")) return invalid();
  const reference = parsed.success ? parsed.data : null;
  const fail = (error: RichMenuActionState["error"]): RichMenuActionState => ({ status: "error", error, reference });
  const intent = formData.get("intent");
  if (intent !== "save" && intent !== "delete" && intent!=="sync" && intent!=="reconcile") return invalid();

  let result: RichMenuActionState;
  try {
    const accountId = formData.get("accountId");
    if (typeof accountId !== "string" || !accountId || accountId.length > 128 || !await findLineAccount(getDb(),vendor.id,accountId)) return fail("not_configured");
    if (reference && !await getDb().lineRichMenuDraft.findFirst({where:{vendorId:vendor.id,lineOfficialAccountId:accountId,...reference},select:{id:true}})) return fail("conflict");
    if(intent==="sync"||intent==="reconcile")return reference?await publishIntent(formData,intent,reference,{vendorId:vendor.id,actorId:auth.user.id}):invalid();
    result=await editDraft(reference,vendor.id,intent,formData,accountId);
    if(result.status==="error")return result;
  } catch (error) {
    if(intent==="sync"||intent==="reconcile") {
      revalidatePath("/settings/line");
      return fail("sync_failed");
    }
    return fail(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "conflict" : "save_failed");
  }
  revalidatePath("/settings/line");
  return result;
}
