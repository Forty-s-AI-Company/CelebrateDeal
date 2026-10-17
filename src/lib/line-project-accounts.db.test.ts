import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "./db";
import { applyVerifiedLineWebhookEvents } from "./line-webhook-events";
import { lineUserIdHash, protectLineOfficialAccountCredentials, protectLineProfileValue } from "./line-credentials";
import { resolveSubjectLineAccount } from "./line-account-routing";
import { enqueueLineNotification, processDueLineDeliveries } from "./line-notification";
import { MockLineMessagingClient } from "./line-client";

const db=getDb();
beforeAll(()=>{
  const target=new URL(process.env.DATABASE_URL??"http://invalid");
  if(target.hostname!=="127.0.0.1"||target.pathname!=="/celebratedeal_test")throw new Error("Owned disposable PostgreSQL required");
});
afterAll(async()=>{await db.$disconnect();});
async function setup(){
  const suffix=randomUUID();
  const vendor=await db.vendor.create({data:{name:"Synthetic LINE",slug:`line-${suffix}`,email:`${suffix}@example.test`,passwordHash:"synthetic-only"}});
  const account=async(label:string,isDefault=false)=>db.lineOfficialAccount.create({data:{vendorId:vendor.id,displayName:label,isDefault,...protectLineOfficialAccountCredentials(vendor.id,{messagingChannelId:label,messagingChannelSecret:"synthetic-channel-secret-only",messagingAccessToken:"synthetic-provider-value-with-no-real-access",loginChannelId:null,loginChannelSecret:null})}});
  const a=await account("Account A",true),b=await account("Account B");
  const project=async(name:string,accountId:string|null)=>db.salesProject.create({data:{vendorId:vendor.id,name,slug:`${name}-${suffix}`,mode:"live_course",primaryFlow:"live",lineOfficialAccountId:accountId}});
  return {vendor,a,b,project};
}
describe("multiple Project LINE accounts on PostgreSQL",()=>{
  it("allows the vendor cascade to remove its linked account records in one statement",async()=>{
    const s=await setup();await s.project("delete-course",s.a.id);
    const identity=await db.lineUserIdentity.create({data:{vendorId:s.vendor.id,lineOfficialAccountId:s.a.id,subjectType:"user",subjectId:"synthetic",lineUserIdHash:"synthetic-hash",lineUserIdEncrypted:"synthetic-encrypted"}});
    await db.lineDelivery.create({data:{vendorId:s.vendor.id,lineOfficialAccountId:s.a.id,lineUserIdentityId:identity.id,trigger:"automation",idempotencyKey:randomUUID(),payloadEncrypted:"synthetic"}});
    await db.lineLoginState.create({data:{vendorId:s.vendor.id,lineOfficialAccountId:s.a.id,stateHash:randomUUID(),nonceHash:"synthetic",codeVerifierEncrypted:"synthetic",subjectType:"user",subjectId:"synthetic",redirectPath:"/dashboard",expiresAt:new Date(Date.now()+600000)}});
    await db.lineRichMenuDraft.create({data:{vendorId:s.vendor.id,lineOfficialAccountId:s.a.id,menu:{}}});
    await db.vendor.delete({where:{id:s.vendor.id}});
    expect(await db.lineOfficialAccount.count({where:{vendorId:s.vendor.id}})).toBe(0);
    expect(await db.lineDelivery.count({where:{vendorId:s.vendor.id}})).toBe(0);
  });
  it("reuses one account across Projects, allows a distinct account and enforces tenant ownership",async()=>{
    const s=await setup(),foreign=await setup();
    const p1=await s.project("one",s.a.id),p2=await s.project("two",s.a.id),p3=await s.project("three",s.b.id);
    expect([p1.lineOfficialAccountId,p2.lineOfficialAccountId,p3.lineOfficialAccountId]).toEqual([s.a.id,s.a.id,s.b.id]);
    await expect(s.project("foreign",foreign.a.id)).rejects.toMatchObject({code:"P2003"});
    await expect(db.lineOfficialAccount.update({where:{id:s.b.id},data:{isDefault:true}})).rejects.toMatchObject({code:"P2002"});
  });

  it("keeps multiple course bindings for one LINE user and revokes only the signed account",async()=>{
    const s=await setup(),user=`U${"d".repeat(32)}`,now=new Date();
    const identity=(accountId:string,subjectId:string)=>db.lineUserIdentity.create({data:{vendorId:s.vendor.id,lineOfficialAccountId:accountId,subjectType:"buyer_registration",subjectId,lineUserIdHash:lineUserIdHash(s.vendor.id,user),lineUserIdEncrypted:protectLineProfileValue(s.vendor.id,"userId",user),linkedAt:new Date(now.getTime()-1000)}});
    const a1=await identity(s.a.id,"course-one"),a2=await identity(s.a.id,"course-two"),b=await identity(s.b.id,"course-one");
    await applyVerifiedLineWebhookEvents(db,s.vendor.id,JSON.stringify({events:[{type:"unfollow",timestamp:now.getTime(),source:{type:"user",userId:user}}]}),now,s.a.id);
    expect(await db.lineUserIdentity.count({where:{id:{in:[a1.id,a2.id]},revokedAt:{not:null}}})).toBe(2);
    expect((await db.lineUserIdentity.findUniqueOrThrow({where:{id:b.id}})).revokedAt).toBeNull();
    await expect(db.lineDelivery.create({data:{vendorId:s.vendor.id,lineOfficialAccountId:s.a.id,lineUserIdentityId:b.id,trigger:"automation",idempotencyKey:randomUUID(),payloadEncrypted:"synthetic"}})).rejects.toMatchObject({code:"P2003"});
  });

  it("suppresses queued work after a Project switch and requires a binding for the new account",async()=>{
    const s=await setup(),project=await s.project("course",s.a.id);
    const form=await db.registrationForm.create({data:{vendorId:s.vendor.id,projectId:project.id,name:"Synthetic",headline:"Synthetic",fields:[],slug:`form-${randomUUID()}`}});
    const submission=await db.formSubmission.create({data:{formId:form.id,name:"Synthetic",email:"synthetic@example.test",verificationStatus:"VERIFIED"}});
    await db.lineUserIdentity.create({data:{vendorId:s.vendor.id,lineOfficialAccountId:s.a.id,subjectType:"buyer_registration",subjectId:submission.id,lineUserIdHash:lineUserIdHash(s.vendor.id,"synthetic-user"),lineUserIdEncrypted:protectLineProfileValue(s.vendor.id,"userId","synthetic-user")}});
    const input={vendorId:s.vendor.id,subjectType:"buyer_registration" as const,subjectId:submission.id,trigger:"automation" as const,idempotencyKey:randomUUID(),messages:[{type:"text" as const,text:"Synthetic"}]};
    expect(await resolveSubjectLineAccount(db,s.vendor.id,input.subjectType,input.subjectId)).toMatchObject({id:s.a.id});
    const queued=await enqueueLineNotification(db,input);expect(queued.status).toBe("queued");
    await db.salesProject.update({where:{id:project.id},data:{lineOfficialAccountId:s.b.id}});
    expect(await enqueueLineNotification(db,{...input,idempotencyKey:randomUUID()})).toEqual({status:"not_linked"});
    const client=new MockLineMessagingClient();
    const result=await processDueLineDeliveries(db,()=>client,new Date(Date.now()+1000),{vendorId:s.vendor.id});
    expect(result).toEqual([{id:"deliveryId" in queued?queued.deliveryId:null,status:"suppressed"}]);expect(client.calls).toHaveLength(0);
    expect((await db.lineDelivery.findFirstOrThrow({where:{vendorId:s.vendor.id}})).lastErrorCode).toBe("line_project_account_changed");
    await db.lineUserIdentity.create({data:{vendorId:s.vendor.id,lineOfficialAccountId:s.b.id,subjectType:"buyer_registration",subjectId:submission.id,lineUserIdHash:lineUserIdHash(s.vendor.id,"synthetic-user"),lineUserIdEncrypted:protectLineProfileValue(s.vendor.id,"userId","synthetic-user")}});
    const requeued=await enqueueLineNotification(db,input);expect(requeued.status).toBe("queued");
    const sent=await processDueLineDeliveries(db,()=>client,new Date(Date.now()+2000),{vendorId:s.vendor.id});
    expect(sent).toEqual([{id:"deliveryId" in requeued?requeued.deliveryId:null,status:"sent"}]);expect(client.calls).toHaveLength(1);
  });

  it("backfills exact legacy rows and invalidates pending OAuth without decrypting credentials",async()=>{
    const namespace=`line_migration_${randomUUID().replaceAll("-","")}`;
    const oldSql=await readFile("prisma/migrations/20260905113000_line_official_account/migration.sql","utf8");
    const newSql=await readFile("prisma/migrations/20261016190000_project_line_accounts/migration.sql","utf8");
    await db.$transaction(async tx=>{
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${namespace}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${namespace}"`);
      for(const sql of [
        'CREATE TABLE "Vendor" (id TEXT PRIMARY KEY)',
        'CREATE TABLE "MessageTemplate" (id TEXT, "vendorId" TEXT, UNIQUE("vendorId", id))',
        'CREATE TABLE "SalesProject" (id TEXT PRIMARY KEY, "vendorId" TEXT)',
        'CREATE TABLE "LineRichMenuDraft" (id TEXT PRIMARY KEY, "vendorId" TEXT, menu JSONB)',
        'CREATE UNIQUE INDEX "LineRichMenuDraft_vendorId_key" ON "LineRichMenuDraft" ("vendorId")',
        ...oldSql.split(";").map(value=>value.trim()).filter(Boolean),
        `INSERT INTO "Vendor" VALUES ('legacy'), ('unconfigured')`,
        `INSERT INTO "LineOfficialAccount" (id,"vendorId","messagingChannelIdEncrypted","messagingChannelSecretEncrypted","messagingAccessTokenEncrypted","updatedAt") VALUES ('account','legacy','cipher-id','cipher-secret','cipher-access',now())`,
        `INSERT INTO "SalesProject" VALUES ('project','legacy'), ('unconfigured-project','unconfigured')`,
        `INSERT INTO "LineUserIdentity" (id,"vendorId","subjectType","subjectId","lineUserIdHash","lineUserIdEncrypted","updatedAt") VALUES ('identity','legacy','user','subject','hash','cipher-user',now()),('unbound','unconfigured','user','other','hash','cipher-other',now())`,
        `INSERT INTO "LineRichMenuDraft" VALUES ('draft','legacy','{}')`,
        `INSERT INTO "LineLoginState" (id,"vendorId","stateHash","nonceHash","codeVerifierEncrypted","subjectType","subjectId","redirectPath","expiresAt") VALUES ('state','legacy','hash','nonce','cipher-verifier','user','subject','/dashboard',now()+interval '10 minutes')`,
        `INSERT INTO "LineDelivery" (id,"vendorId","lineOfficialAccountId","lineUserIdentityId",trigger,"idempotencyKey","payloadEncrypted","updatedAt") VALUES ('delivery','legacy','account','identity','automation','key','cipher-payload',now())`,
        ...newSql.split(";").map(value=>value.trim()).filter(Boolean),
      ]) await tx.$executeRawUnsafe(sql);
      expect(await tx.$queryRawUnsafe('SELECT "lineOfficialAccountId" FROM "SalesProject" ORDER BY id')).toEqual([{lineOfficialAccountId:"account"},{lineOfficialAccountId:null}]);
      expect(await tx.$queryRawUnsafe('SELECT "lineOfficialAccountId","lineUserIdEncrypted" FROM "LineUserIdentity" WHERE id=\'identity\'')).toEqual([{lineOfficialAccountId:"account",lineUserIdEncrypted:"cipher-user"}]);
      expect(await tx.$queryRawUnsafe('SELECT "isDefault","messagingAccessTokenEncrypted" FROM "LineOfficialAccount"')).toEqual([{isDefault:true,messagingAccessTokenEncrypted:"cipher-access"}]);
      expect(await tx.$queryRawUnsafe('SELECT "lineOfficialAccountId" FROM "LineRichMenuDraft"')).toEqual([{lineOfficialAccountId:"account"}]);
      expect(await tx.$queryRawUnsafe('SELECT "consumedAt" IS NOT NULL AS consumed FROM "LineLoginState"')).toEqual([{consumed:true}]);
      expect(await tx.$queryRawUnsafe('SELECT "lineOfficialAccountId","payloadEncrypted" FROM "LineDelivery"')).toEqual([{lineOfficialAccountId:"account",payloadEncrypted:"cipher-payload"}]);
      expect(await tx.$queryRawUnsafe('SELECT "revokedAt" IS NOT NULL AS revoked FROM "LineUserIdentity" WHERE id=\'unbound\'')).toEqual([{revoked:true}]);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${namespace}" CASCADE`);
    },{timeout:30000});
  });
});
