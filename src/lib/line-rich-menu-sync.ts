import { createHash,randomUUID } from "node:crypto";
import { Prisma,type PrismaClient,type LineOfficialAccount } from "@prisma/client";
import { LineFetchRichMenuClient,type LineRichMenuClient } from "@/lib/line-rich-menu-client";
import { unprotectLineOfficialAccountCredentials } from "@/lib/line-credentials";
import { prepareLineRichMenuPublication,publishPreparedLineRichMenu,type RichMenuLinks } from "@/lib/line-rich-menu-publication";
import { RichMenuPublicationRecordSchema,parseRichMenuDraftContent,richMenuPublicationLocked,richMenuPublicationView,type RichMenuPublicationRecord } from "@/lib/line-rich-menu-draft-content";
import { findLineAccount } from "@/lib/line-account-routing";

type Db=Pick<PrismaClient,"$transaction"|"lineRichMenuDraft"|"lineOfficialAccount">;
type Reference={id:string;revision:number};
type Context={vendorId:string;actorId:string};
type Factory=(account:LineOfficialAccount)=>LineRichMenuClient;
const defaultFactory:Factory=account=>new LineFetchRichMenuClient(unprotectLineOfficialAccountCredentials(account.vendorId,account).messagingAccessToken);
export const richMenuAccountVersion=(account:Pick<LineOfficialAccount,"id"|"messagingChannelIdEncrypted"|"messagingChannelSecretEncrypted"|"messagingAccessTokenEncrypted">)=>createHash("sha256").update(JSON.stringify([account.id,account.messagingChannelIdEncrypted,account.messagingChannelSecretEncrypted,account.messagingAccessTokenEncrypted])).digest("hex");
const version=richMenuAccountVersion;
const json=(value:unknown)=>value as Prisma.InputJsonValue;
const auditRecord=(record:RichMenuPublicationRecord)=>json({attemptId:record.attemptId,status:record.status,fingerprint:record.fingerprint,accountId:record.accountId,sourceRevision:record.sourceRevision,stage:record.stage,remoteMenuId:record.remoteMenuId,previousMenuId:record.previousMenuId,previousDefaultKnown:record.previousDefaultKnown,confirmedAt:record.confirmedAt});
export type RichMenuSyncResult={status:"synced"|"uncertain"|"failed"|"conflict"|"not_configured"|"invalid_input"|"invalid_image"|"unresolved_links"|"image_too_large"|"image_size_mismatch"|"locked";reference:Reference;publication:ReturnType<typeof richMenuPublicationView>};

function output(status:RichMenuSyncResult["status"],reference:Reference,record:RichMenuPublicationRecord|null=null):RichMenuSyncResult {
  return {status,reference,publication:richMenuPublicationView(record)};
}

/** Caller proves owner+CSRF. All identifiers below are bound to that vendor. */
export async function syncLineRichMenuDraft(db:Db,context:Context,reference:Reference,postedMenu:unknown,image:Uint8Array,links:RichMenuLinks,factory:Factory=defaultFactory):Promise<RichMenuSyncResult> {
  const row=await db.lineRichMenuDraft.findFirst({where:{...reference,vendorId:context.vendorId}});
  const content=row&&parseRichMenuDraftContent(row.menu);
  if(!row||!content||reference.revision>2_147_483_644)return output("conflict",reference);
  if(richMenuPublicationLocked(content.publication))return output("locked",reference,content.publication);
  // A sync always publishes the saved snapshot, never silently omits local edits.
  const posted=parseRichMenuDraftContent(postedMenu);
  if(!posted||JSON.stringify(posted.menu)!==JSON.stringify(content.menu))return output("invalid_input",reference,content.publication);
  const checkedLinks=RichMenuPublicationRecordSchema.shape.links.safeParse(links);
  if(!checkedLinks.success)return output("invalid_input",reference,content.publication);
  const prepared=await prepareLineRichMenuPublication(content.menu,image,checkedLinks.data);
  if(prepared.status!=="ready")return output(prepared.status==="invalid_menu"?"invalid_input":prepared.status,reference,content.publication);
  if (!row.lineOfficialAccountId) return output("not_configured",reference,content.publication);
  const account=await findLineAccount(db,context.vendorId,row.lineOfficialAccountId);
  if(!account||account.status!=="active")return output("not_configured",reference,content.publication);
  const started=new Date();let publication:RichMenuPublicationRecord=RichMenuPublicationRecordSchema.parse({attemptId:randomUUID(),status:"syncing",fingerprint:prepared.publication.fingerprint,accountId:account.id,accountVersion:version(account),sourceRevision:reference.revision,startedAt:started.toISOString(),expiresAt:new Date(started.getTime()+120_000).toISOString(),stage:"check_current",remoteMenuId:null,previousMenuId:null,previousDefaultKnown:false,confirmedAt:null,links:checkedLinks.data});
  const active={id:reference.id,revision:reference.revision+1};
  try {
    const claimed=await db.$transaction(async tx=>{
      const currentAccount=await findLineAccount(tx,context.vendorId,account.id);
      if(!currentAccount||currentAccount.status!=="active"||version(currentAccount)!==publication.accountVersion)return false;
      const changed=await tx.lineRichMenuDraft.updateMany({where:{...reference,vendorId:context.vendorId,menu:{equals:json(row.menu)}},data:{revision:{increment:1},menu:json({...content,publication})}});
      if(changed.count!==1)return false;
      await tx.auditLog.create({data:{vendorId:context.vendorId,actorId:context.actorId,action:"line_rich_menu_sync_started",targetType:"LineRichMenuDraft",targetId:row.id,after:json({attemptId:publication.attemptId,fingerprint:publication.fingerprint,previous:content.publication?auditRecord(content.publication):null})}});
      return true;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    if(!claimed)return output("conflict",reference);
  } catch {return output("conflict",reference);}

  async function current() {
    const fresh=await db.lineRichMenuDraft.findFirst({where:{...active,vendorId:context.vendorId}});
    const stored=fresh&&parseRichMenuDraftContent(fresh.menu);
    return fresh&&stored?.publication?.attemptId===publication.attemptId&&stored.publication.status==="syncing"?{row:fresh,content:stored}:null;
  }
  async function isCurrent() {
    if(Date.now()>=Date.parse(publication.expiresAt)||!await current())return false;
    const latest=await findLineAccount(db,context.vendorId,publication.accountId);
    return Boolean(latest&&latest.status==="active"&&version(latest)===publication.accountVersion);
  }
  let result;
  try {
    result=await publishPreparedLineRichMenu(factory(account),prepared.publication,isCurrent,async progress=>{
      if(!await isCurrent())throw new Error("Rich menu snapshot changed.");
      const fresh=await current();if(!fresh)throw new Error("Rich menu snapshot changed.");
      publication=RichMenuPublicationRecordSchema.parse({...publication,...progress,status:"syncing"});
      const changed=await db.lineRichMenuDraft.updateMany({where:{...active,vendorId:context.vendorId,menu:{equals:json(fresh.row.menu)}},data:{menu:json({...content,publication})}});
      if(changed.count!==1)throw new Error("Rich menu progress could not be persisted.");
    });
  } catch {result={...publication,status:publication.remoteMenuId||publication.stage!=="check_current"?"uncertain" as const:"failed" as const};}
  publication=RichMenuPublicationRecordSchema.parse({...publication,...result,confirmedAt:result.status==="synced"?new Date().toISOString():null});
  async function lostOwnership() {
    const latest=await db.lineRichMenuDraft.findFirst({where:{id:active.id,vendorId:context.vendorId}});
    const stored=latest&&parseRichMenuDraftContent(latest.menu);
    return output("uncertain",latest?{id:latest.id,revision:latest.revision}:active,stored?.publication??{...publication,status:"uncertain"});
  }
  try {
    const fresh=await current();if(!fresh)return await lostOwnership();
    const changed=await db.$transaction(async tx=>{
      const count=await tx.lineRichMenuDraft.updateMany({where:{...active,vendorId:context.vendorId,menu:{equals:json(fresh.row.menu)}},data:{revision:{increment:1},menu:json({...content,publication})}});
      if(count.count!==1)return false;
      await tx.auditLog.create({data:{vendorId:context.vendorId,actorId:context.actorId,action:"line_rich_menu_sync_result",targetType:"LineRichMenuDraft",targetId:row.id,after:auditRecord(publication)}});
      return true;
    });
    return changed?output(result.status, {id:active.id,revision:active.revision+1},publication):await lostOwnership();
  } catch {return output("uncertain",active,{...publication,status:"uncertain"});}
}

/** Read-only provider reconciliation never retries a default mutation. */
export async function reconcileLineRichMenuDraft(db:Db,context:Context,reference:Reference,factory:Factory=defaultFactory):Promise<RichMenuSyncResult> {
  const row=await db.lineRichMenuDraft.findFirst({where:{...reference,vendorId:context.vendorId}});
  const content=row&&parseRichMenuDraftContent(row.menu),record=content?.publication;
  if(!row||!content||!record||reference.revision>2_147_483_644)return output("conflict",reference);
  if(record.status!=="uncertain"&&!(record.status==="syncing"&&Date.now()>Date.parse(record.expiresAt)))return output("locked",reference,record);
  if (!row.lineOfficialAccountId) return output("not_configured",reference,record);
  const account=await findLineAccount(db,context.vendorId,row.lineOfficialAccountId);
  if(!account||account.status!=="active"||account.id!==record.accountId||version(account)!==record.accountVersion)return output("not_configured",reference,record);
  const active={id:row.id,revision:row.revision+1};
  const reserved={...record,status:"syncing" as const,expiresAt:new Date(Date.now()+120_000).toISOString()};
  const claimed=await db.lineRichMenuDraft.updateMany({where:{...reference,vendorId:context.vendorId,menu:{equals:json(row.menu)}},data:{revision:{increment:1},menu:json({...content,publication:reserved})}});
  if(claimed.count!==1)return output("conflict",reference);
  let publication:RichMenuPublicationRecord={...reserved,status:"uncertain"};
  try {
    const actual=await factory(account).getDefault();
    if(record.remoteMenuId&&actual===record.remoteMenuId)publication={...reserved,status:"synced",confirmedAt:new Date().toISOString()};
    else if(!record.previousDefaultKnown||!["set_default","confirm"].includes(record.stage))publication={...reserved,status:record.previousDefaultKnown&&actual!==record.previousMenuId?"conflict":"failed",confirmedAt:null};
  } catch { /* Keep unknown remote outcomes locked; no provider diagnostic is persisted. */ }
  try {
    const changed=await db.$transaction(async tx=>{
      const latest=await findLineAccount(tx,context.vendorId,account.id);
      if(!latest||version(latest)!==record.accountVersion)return false;
      const updated=await tx.lineRichMenuDraft.updateMany({where:{...active,vendorId:context.vendorId,menu:{equals:json({...content,publication:reserved})}},data:{revision:{increment:1},menu:json({...content,publication})}});
      if(updated.count!==1)return false;
      await tx.auditLog.create({data:{vendorId:context.vendorId,actorId:context.actorId,action:"line_rich_menu_reconciled",targetType:"LineRichMenuDraft",targetId:row.id,after:auditRecord(publication)}});return true;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    const status=publication.status as "synced"|"uncertain"|"conflict"|"failed";
    return changed?output(status,{id:active.id,revision:active.revision+1},publication):output("uncertain",active,{...publication,status:"uncertain"});
  } catch {return output("uncertain",active,{...publication,status:"uncertain"});}
}
