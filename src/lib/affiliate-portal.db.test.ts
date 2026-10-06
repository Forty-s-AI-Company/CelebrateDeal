import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { appendCommissionLedgerEntry } from "@/lib/affiliate-commission-accounting";
import { AffiliatePortalConflict, getAffiliatePortalStatement, setAffiliatePortalAccess, listAffiliatePortalAccess } from "@/lib/affiliate-portal";
const db=getDb();
async function fixture(){
 const suffix=randomUUID();const vendor=await db.vendor.create({data:{name:"Synthetic partner shop",slug:`partner-${suffix}`,email:`${suffix}@example.test`,passwordHash:"synthetic-only"}});
 const user=await db.user.create({data:{email:`partner-${suffix}@example.test`,name:"Synthetic partner",passwordHash:"synthetic-only",memberships:{create:{vendorId:vendor.id,role:"partner",status:"active"}}},include:{memberships:true}});
 const affiliate=await db.affiliate.create({data:{vendorId:vendor.id,name:"Synthetic affiliate",code:`PARTNER-${suffix}`}});
 return {vendor,user,affiliate,member:user.memberships[0],manager:{vendorId:vendor.id,role:"owner"},input:{affiliateId:affiliate.id,vendorMemberId:user.memberships[0].id,active:true,expectedRevision:0}};
}
// Immutable ledger fixtures remain intact until the owned disposable database
// is destroyed by the runner; never disable append-only triggers for cleanup.

describe("affiliate portal disposable boundaries",()=>{
 it("denies foreign users, tenants, members and non-manager permission grants",async()=>{
  const f=await fixture(),other=await fixture();
  expect(await setAffiliatePortalAccess(db,{...f.manager,role:"partner"},f.input)).toBeNull();
  expect(await setAffiliatePortalAccess(db,f.manager,{...f.input,vendorMemberId:other.member.id})).toBeNull();
  expect(await setAffiliatePortalAccess(db,other.manager,f.input)).toBeNull();
  expect(await setAffiliatePortalAccess(db,f.manager,f.input)).toEqual({revision:1});
  expect(await getAffiliatePortalStatement(db,{userId:other.user.id},f.vendor.id,f.affiliate.id)).toBeNull();
  expect(await getAffiliatePortalStatement(db,{userId:f.user.id},other.vendor.id,f.affiliate.id)).toBeNull();
  expect(await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id)).toMatchObject({balanceCents:0,requiresReconciliation:false});
 });
 it("enforces composite access foreign keys even for direct inserts",async()=>{
  const f=await fixture(),other=await fixture();
  await expect(db.affiliatePortalAccess.create({data:{vendorId:f.vendor.id,affiliateId:f.affiliate.id,vendorMemberId:other.member.id}})).rejects.toMatchObject({code:"P2003"});
 });
 it("allows one concurrent initial grant and rejects stale reactivation after revoke",async()=>{
  const f=await fixture();const results=await Promise.allSettled(Array.from({length:4},()=>setAffiliatePortalAccess(db,f.manager,f.input)));
  expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
  for(const result of results) if(result.status==="rejected") expect(result.reason instanceof AffiliatePortalConflict || (result.reason instanceof Prisma.PrismaClientKnownRequestError && ["P2002","P2034"].includes(result.reason.code))).toBe(true);
  expect(await db.affiliatePortalAccess.count({where:{vendorId:f.vendor.id}})).toBe(1);
  await setAffiliatePortalAccess(db,f.manager,{...f.input,expectedRevision:1,active:false});
  await expect(setAffiliatePortalAccess(db,f.manager,{...f.input,expectedRevision:1})).rejects.toBeInstanceOf(AffiliatePortalConflict);
  expect(await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id)).toBeNull();
 });
 it("uses ledger net after idempotent refund instead of historical gross amount",async()=>{
  const f=await fixture();await setAffiliatePortalAccess(db,f.manager,f.input);
  const commission=await db.affiliateCommission.create({data:{vendorId:f.vendor.id,affiliateId:f.affiliate.id,monthKey:"2026-10",deduplicationKey:randomUUID(),orderAmountCents:10000,commissionBaseAmountCents:10000,commissionRateBps:1000,netReferenceAmountCents:9000,commissionAmountCents:1000}});
  expect(await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id)).toMatchObject({balanceCents:null,requiresReconciliation:true});
  const base={vendorId:f.vendor.id,affiliateCommissionId:commission.id,providerName:"synthetic",eventIdentity:randomUUID(),occurredAt:new Date()};
  await db.$transaction(tx=>appendCommissionLedgerEntry(tx,{...base,entryType:"opening_balance",amountCents:1000}));
  const refund={...base,eventIdentity:randomUUID(),entryType:"refund" as const,amountCents:-400};
  await db.$transaction(tx=>appendCommissionLedgerEntry(tx,refund));await db.$transaction(tx=>appendCommissionLedgerEntry(tx,refund));
  const statement=await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id);
  expect(statement).toMatchObject({balanceCents:600,requiresReconciliation:false});expect(statement!.commissions[0].balanceCents).toBe(600);
  expect((await db.affiliateCommission.findUniqueOrThrow({where:{id:commission.id}})).commissionAmountCents).toBe(1000);
 });
 it("revokes portal reads when membership, affiliate or user becomes inactive",async()=>{
  const f=await fixture();await setAffiliatePortalAccess(db,f.manager,f.input);
  await db.vendorMember.update({where:{id:f.member.id},data:{status:"inactive"}});
  expect(await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id)).toBeNull();
  await db.vendorMember.update({where:{id:f.member.id},data:{status:"active"}});await db.affiliate.update({where:{id:f.affiliate.id},data:{isActive:false}});
  expect(await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id)).toBeNull();
  await db.affiliate.update({where:{id:f.affiliate.id},data:{isActive:true}});await db.user.update({where:{id:f.user.id},data:{status:"inactive"}});
  expect(await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id)).toBeNull();
  await db.vendorMember.update({where:{id:f.member.id},data:{status:"inactive"}});
  await db.affiliate.update({where:{id:f.affiliate.id},data:{isActive:false}});
  await setAffiliatePortalAccess(db,f.manager,{...f.input,active:false,expectedRevision:1});
  await db.vendorMember.update({where:{id:f.member.id},data:{status:"active"}});
  await db.affiliate.update({where:{id:f.affiliate.id},data:{isActive:true}});
  await db.user.update({where:{id:f.user.id},data:{status:"active"}});
  expect(await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id)).toBeNull();
  expect(await listAffiliatePortalAccess(db,{userId:f.user.id})).toMatchObject({entries:[]});
 });
 it("paginates grants and statements without accepting foreign cursors",async()=>{
  const f=await fixture(),other=await fixture();await setAffiliatePortalAccess(db,f.manager,f.input);await setAffiliatePortalAccess(db,other.manager,other.input);
  for(let index=0;index<21;index++){
   const affiliate=await db.affiliate.create({data:{vendorId:f.vendor.id,name:`Synthetic paged ${index}`,code:randomUUID()}});
   await setAffiliatePortalAccess(db,f.manager,{...f.input,affiliateId:affiliate.id});
  }
  const first=await listAffiliatePortalAccess(db,{userId:f.user.id});expect(first!.entries).toHaveLength(20);
  const next=await listAffiliatePortalAccess(db,{userId:f.user.id},first!.nextCursor!);expect(next!.entries).toHaveLength(2);
  expect(new Set([...first!.entries,...next!.entries].map(item=>item.affiliateId)).size).toBe(22);
  expect(await listAffiliatePortalAccess(db,{userId:other.user.id},first!.nextCursor!)).toBeNull();
  for(let index=0;index<22;index++)await db.affiliateCommission.create({data:{vendorId:f.vendor.id,affiliateId:f.affiliate.id,monthKey:"2026-10",deduplicationKey:randomUUID()}});
  const statement=await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id);expect(statement!.commissions).toHaveLength(20);
  const second=await getAffiliatePortalStatement(db,{userId:f.user.id},f.vendor.id,f.affiliate.id,statement!.nextCursor!);expect(second!.commissions).toHaveLength(2);
  expect(await getAffiliatePortalStatement(db,{userId:other.user.id},other.vendor.id,other.affiliate.id,statement!.nextCursor!)).toBeNull();
 });

});
