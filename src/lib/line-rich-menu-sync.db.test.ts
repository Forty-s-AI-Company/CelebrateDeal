import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll,afterEach,beforeAll,describe,expect,it,vi } from "vitest";
import { getDb } from "./db";
import { createRichMenuTemplate } from "./line-rich-menu";
import { protectLineOfficialAccountCredentials } from "./line-credentials";
import { parseRichMenuDraftContent,type RichMenuPublicationRecord } from "./line-rich-menu-draft-content";
import { reconcileLineRichMenuDraft,richMenuAccountVersion,syncLineRichMenuDraft } from "./line-rich-menu-sync";
const auth=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/auth",()=>({requireVendorOwner:auth}));
vi.mock("@/lib/csrf",()=>({assertServerActionSecurity:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/audit",()=>({writeAuditLog:vi.fn(),auditSnapshot:(value:unknown)=>value}));
import { updateRichMenuDraftAction } from "@/app/actions/line-rich-menu-actions";
import { saveLineOfficialAccountAction } from "@/app/actions/line-actions";

const db=getDb(),vendorIds:string[]=[];
let image:Uint8Array;let selectedAccountId="";
const links={live_url:"https://example.test/live/synthetic?private_marker=synthetic-config-only",consultation_url:"https://example.test/consult",portal_url:"https://example.test/portal",voucher_url:"https://example.test/voucher"};
const oldId=`richmenu-${"a".repeat(32)}`;
beforeAll(async()=>{
 const target=new URL(process.env.DATABASE_URL??"http://invalid");
 if(target.hostname!=="127.0.0.1"||target.pathname!=="/celebratedeal_test")throw new Error("Owned disposable database required.");
 image=await sharp({create:{width:2500,height:1686,channels:3,background:"#2563eb"}}).png().toBuffer();
});
afterEach(async()=>{
 const ids=vendorIds.splice(0);await db.auditLog.deleteMany({where:{vendorId:{in:ids}}});await db.vendor.deleteMany({where:{id:{in:ids}}});
});
afterAll(async()=>{await db.$disconnect();});

async function setup() {
 const suffix=randomUUID();
 const vendor=await db.vendor.create({data:{name:"Synthetic Rich Menu owner",slug:`menu-${suffix}`,email:`menu-${suffix}@example.test`,passwordHash:"synthetic-unused"}});vendorIds.push(vendor.id);
 const account=await db.lineOfficialAccount.create({data:{vendorId:vendor.id,status:"active",...protectLineOfficialAccountCredentials(vendor.id,{messagingChannelId:"synthetic-channel-a",messagingChannelSecret:"synthetic-channel-secret-only-value",messagingAccessToken:"synthetic-provider-value-with-no-real-access",loginChannelId:null,loginChannelSecret:null})}});
 selectedAccountId=account.id;
 const menu=createRichMenuTemplate("minimal-4"),draft=await db.lineRichMenuDraft.create({data:{vendorId:vendor.id,lineOfficialAccountId:account.id,menu}});
 const context={vendorId:vendor.id,actorId:"synthetic-owner"};
 auth.mockResolvedValue({vendor,user:{id:context.actorId},member:{role:"owner"}});
 return {vendor,account,menu,draft,context,reference:{id:draft.id,revision:draft.revision}};
}
function provider() {
 let selected:string|null=oldId;
 const created=`richmenu-${randomUUID().replaceAll("-","")}`;
 const client={getDefault:vi.fn(async()=>selected),create:vi.fn(async()=>created),uploadImage:vi.fn(async()=>{}),setDefault:vi.fn(async(id:string|null)=>{selected=id;}),delete:vi.fn(async()=>{})};
 return {client,created,select:(value:string|null)=>{selected=value;}};
}
function editForm(reference:{id:string;revision:number},menu:unknown,intent="save") {
 const form=new FormData();form.set("accountId",selectedAccountId);form.set("displayName","Synthetic account");for(const [key,value] of Object.entries({...reference,menu:JSON.stringify(menu),intent,_csrf:"synthetic"}))form.set(key,String(value));return form;
}
function credentialForm(channel="synthetic-channel-a") {
 const form=new FormData();form.set("accountId",selectedAccountId);form.set("displayName","Synthetic account");for(const [key,value] of Object.entries({messagingChannelId:channel,messagingChannelSecret:"synthetic-rotated-channel-secret-value",messagingAccessToken:"synthetic-rotated-provider-value-with-no-access"}))form.set(key,value);return form;
}
async function stored(vendorId:string) {
 const row=await db.lineRichMenuDraft.findFirstOrThrow({where:{vendorId}});const content=parseRichMenuDraftContent(row.menu);if(!content)throw new Error("Stored fixture content malformed.");return {row,content,reference:{id:row.id,revision:row.revision}};
}

describe("Rich Menu owned PostgreSQL publication boundary",()=>{
 it.each([{...links,unknown:"synthetic"},{...links,portal_url:"x".repeat(1001)}])("rejects malformed stored links before any claim or audit",async invalid=>{
  const s=await setup(),remote=provider();
  expect((await syncLineRichMenuDraft(db,s.context,s.reference,s.menu,image,invalid,()=>remote.client)).status).toBe("invalid_input");
  expect((await stored(s.vendor.id)).row.revision).toBe(1);
  expect(await db.auditLog.count({where:{vendorId:s.vendor.id}})).toBe(0);
  expect(remote.client.create).not.toHaveBeenCalled();
 });

 it("rejects a first-sync snapshot when credentials change before its Serializable claim",async()=>{
  const s=await setup(),remote=provider();
  const snapshotDb={lineRichMenuDraft:db.lineRichMenuDraft,$transaction:db.$transaction.bind(db),lineOfficialAccount:{...db.lineOfficialAccount,findFirst:vi.fn(async()=>{
   expect((await saveLineOfficialAccountAction({status:"idle",error:null},credentialForm())).status).toBe("saved");
   return s.account;
  })} as unknown as typeof db.lineOfficialAccount};
  expect((await syncLineRichMenuDraft(snapshotDb,s.context,s.reference,s.menu,image,links,()=>remote.client)).status).toBe("conflict");
  expect(remote.client.create).not.toHaveBeenCalled();expect((await stored(s.vendor.id)).content.publication).toBeNull();
 });

 it("persists a confirmed snapshot, omits configured URLs from audit and marks subsequent edits outdated",async()=>{
  const s=await setup(),remote=provider();
  const result=await syncLineRichMenuDraft(db,s.context,s.reference,s.menu,image,links,()=>remote.client);
  expect(result.status).toBe("synced");expect(result.reference.revision).toBe(3);
  const saved=await stored(s.vendor.id);expect(saved.content.publication?.status).toBe("synced");expect(saved.content.publication?.remoteMenuId).toBe(remote.created);
  const history=await db.auditLog.findMany({where:{vendorId:s.vendor.id}});expect(history).toHaveLength(2);expect(JSON.stringify(history)).not.toContain("private_marker");
  const edited={...s.menu,name:"Saved new version"};
  expect((await updateRichMenuDraftAction({status:"idle",error:null,reference:null},editForm(saved.reference,edited))).status).toBe("saved");
  expect((await stored(s.vendor.id)).content.publication?.status).toBe("outdated");
  expect(remote.client.delete).not.toHaveBeenCalled();
 });

 it("allows only one concurrent first publication and never reads a foreign draft as owned",async()=>{
  const s=await setup(),foreign=await setup(),remote=provider();
  const factory=vi.fn(()=>remote.client);
  expect((await syncLineRichMenuDraft(db,foreign.context,s.reference,s.menu,image,links,factory)).status).toBe("conflict");expect(factory).not.toHaveBeenCalled();
  expect((await syncLineRichMenuDraft(db,s.context,s.reference,{...s.menu,name:"Unsaved local change"},image,links,factory)).status).toBe("invalid_input");expect(factory).not.toHaveBeenCalled();
  const results=await Promise.all([syncLineRichMenuDraft(db,s.context,s.reference,s.menu,image,links,factory),syncLineRichMenuDraft(db,s.context,s.reference,s.menu,image,links,factory)]);
  expect(results.map(result=>result.status).sort()).toEqual(["conflict","synced"]);expect(remote.client.create).toHaveBeenCalledTimes(1);expect((await stored(s.vendor.id)).row.revision).toBe(3);
 });

 it("blocks fresh-tab edits, deletion, duplicate sync and credential switching while the remote operation is pending",async()=>{
  const s=await setup(),remote=provider();
  let release!:()=>void,entered!:()=>void;
  const inside=new Promise<void>(resolve=>{entered=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
  remote.client.uploadImage.mockImplementationOnce(async()=>{entered();await barrier;});
  const running=syncLineRichMenuDraft(db,s.context,s.reference,s.menu,image,links,()=>remote.client);
  await inside;
  try {
   const active=await stored(s.vendor.id);expect(active.content.publication?.status).toBe("syncing");expect(active.content.publication?.remoteMenuId).toBe(remote.created);
   for(const intent of ["save","delete"])expect((await updateRichMenuDraftAction({status:"idle",error:null,reference:null},editForm(active.reference,s.menu,intent))).error).toBe("locked");
   expect((await syncLineRichMenuDraft(db,s.context,active.reference,s.menu,image,links,()=>remote.client)).status).toBe("locked");
   expect((await saveLineOfficialAccountAction({status:"idle",error:null},credentialForm())).error).toBe("sync_pending");
   expect((await db.lineOfficialAccount.findFirstOrThrow({where:{vendorId:s.vendor.id}})).messagingAccessTokenEncrypted).toBe(s.account.messagingAccessTokenEncrypted);
  } finally {release();}
  expect((await running).status).toBe("synced");expect(remote.client.create).toHaveBeenCalledTimes(1);
 });

 it("reconciles an applied timeout using only a read, without repeating the default mutation",async()=>{
  const s=await setup(),remote=provider();
  remote.client.setDefault.mockImplementationOnce(async(id)=>{remote.select(id);throw new Error("synthetic ambiguous response");});
  const result=await syncLineRichMenuDraft(db,s.context,s.reference,s.menu,image,links,()=>remote.client);expect(result.status).toBe("uncertain");
  expect((await stored(s.vendor.id)).content.publication?.status).toBe("uncertain");
  const resolved=await reconcileLineRichMenuDraft(db,s.context,result.reference,()=>remote.client);expect(resolved.status).toBe("synced");expect(remote.client.setDefault).toHaveBeenCalledTimes(1);
 });

 it("unlocks through read-only reconciliation when the pre-switch lease check fails without sending a switch",async()=>{
  const s=await setup(),remote=provider(),expired=Date.now()+600000;let restoreClock=()=>{};
  // Advance only at the provider barrier, not by counting Prisma's own clock reads.
  remote.client.getDefault.mockImplementationOnce(async()=>oldId).mockImplementationOnce(async()=>{
   const clock=vi.spyOn(Date,"now").mockReturnValue(expired);restoreClock=()=>clock.mockRestore();return oldId;
  });
  let result;
  try {result=await syncLineRichMenuDraft(db,s.context,s.reference,s.menu,image,links,()=>remote.client);}
  finally {restoreClock();}
  expect(result.status).toBe("uncertain");expect(remote.client.setDefault).not.toHaveBeenCalled();
  expect((await stored(s.vendor.id)).content.publication?.stage).toBe("check_current");
  expect((await reconcileLineRichMenuDraft(db,s.context,result.reference,()=>remote.client)).status).toBe("failed");
  const fresh=await stored(s.vendor.id);
  expect((await updateRichMenuDraftAction({status:"idle",error:null,reference:null},editForm(fresh.reference,s.menu))).status).toBe("saved");
 });

 it("keeps unapplied ambiguous switches locked, allows same-channel repair, and rejects switching to a different channel",async()=>{
  const s=await setup(),remote=provider();remote.client.setDefault.mockRejectedValueOnce(new Error("synthetic unknown response"));
  const first=await syncLineRichMenuDraft(db,s.context,s.reference,s.menu,image,links,()=>remote.client);expect(first.status).toBe("uncertain");
  const unresolved=await reconcileLineRichMenuDraft(db,s.context,first.reference,()=>remote.client);expect(unresolved.status).toBe("uncertain");
  expect((await saveLineOfficialAccountAction({status:"idle",error:null},credentialForm("synthetic-other-channel"))).error).toBe("save_failed");
  expect((await saveLineOfficialAccountAction({status:"idle",error:null},credentialForm())).status).toBe("saved");
  const fresh=await stored(s.vendor.id),account=await db.lineOfficialAccount.findFirstOrThrow({where:{vendorId:s.vendor.id}});
  expect(fresh.content.publication?.status).toBe("uncertain");expect(fresh.content.publication?.accountVersion).toBe(richMenuAccountVersion(account));
  remote.select(remote.created);
  expect((await reconcileLineRichMenuDraft(db,s.context,fresh.reference,()=>remote.client)).status).toBe("synced");expect(remote.client.setDefault).toHaveBeenCalledTimes(1);
 });

 it("does not reconcile an active lease, but can recover the persisted remote ID after a simulated interrupted operation",async()=>{
  const s=await setup(),remote=provider(),now=new Date();
  const record:RichMenuPublicationRecord={attemptId:randomUUID(),status:"syncing",fingerprint:"a".repeat(64),accountId:s.account.id,accountVersion:richMenuAccountVersion(s.account),sourceRevision:1,startedAt:now.toISOString(),expiresAt:new Date(now.getTime()+120000).toISOString(),stage:"set_default",remoteMenuId:remote.created,previousMenuId:oldId,previousDefaultKnown:true,confirmedAt:null,links};
  await db.lineRichMenuDraft.update({where:{id:s.draft.id},data:{menu:{version:1,menu:s.menu,publication:record}}});
  expect((await reconcileLineRichMenuDraft(db,s.context,s.reference,()=>remote.client)).status).toBe("locked");expect(remote.client.getDefault).not.toHaveBeenCalled();
  await db.lineRichMenuDraft.update({where:{id:s.draft.id},data:{menu:{version:1,menu:s.menu,publication:{...record,expiresAt:new Date(now.getTime()-1000).toISOString()}}}});
  remote.select(remote.created);expect((await reconcileLineRichMenuDraft(db,s.context,s.reference,()=>remote.client)).status).toBe("synced");expect(remote.client.create).not.toHaveBeenCalled();
 });
});
