import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { appendCommissionLedgerEntry } from "@/lib/affiliate-commission-accounting";
import { AffiliatePortalConflict, getAffiliatePortalStatement, setAffiliatePortalAccess, listAffiliatePortalAccess } from "@/lib/affiliate-portal";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition } from "@/lib/commerce-orders";
import { accrueMerchantAffiliatePlan, freezeMerchantAffiliateCheckout, publishMerchantAffiliatePolicy } from "@/lib/merchant-affiliate-policy-service";
const db=getDb();
async function fixture(){
 const suffix=randomUUID();const vendor=await db.vendor.create({data:{name:"Synthetic partner shop",slug:`partner-${suffix}`,email:`${suffix}@example.test`,passwordHash:"synthetic-only"}});
 const user=await db.user.create({data:{email:`partner-${suffix}@example.test`,name:"Synthetic partner",passwordHash:"synthetic-only",memberships:{create:{vendorId:vendor.id,role:"partner",status:"active"}}},include:{memberships:true}});
 const affiliate=await db.affiliate.create({data:{vendorId:vendor.id,name:"Synthetic affiliate",code:`PARTNER-${suffix}`}});
 return {vendor,user,affiliate,member:user.memberships[0],manager:{vendorId:vendor.id,role:"owner"},input:{affiliateId:affiliate.id,vendorMemberId:user.memberships[0].id,active:true,expectedRevision:0}};
}
/** A team tenant whose downline's order pays both the downline (level 0) and
 * the bound upline (level 1), through the real checkout freeze and accrual. */
async function teamFixture(){
 const suffix=randomUUID();
 const vendor=await db.vendor.create({data:{name:"Synthetic team portal",slug:`team-portal-${suffix}`,email:`team-${suffix}@example.test`,passwordHash:"synthetic-only",enabledFeatureModules:["affiliate_program"]}});
 const owner=await db.user.create({data:{name:"Synthetic owner",email:`owner-${suffix}@example.test`,passwordHash:"synthetic-only",memberships:{create:{vendorId:vendor.id,role:"owner",status:"active"}}}});
 const team=await db.salesTeam.create({data:{vendorId:vendor.id,name:"Synthetic team",slug:suffix}});
 const product=await db.product.create({data:{vendorId:vendor.id,name:"Synthetic physical",slug:suffix,priceCents:1000,currency:"TWD",inventory:10,isActive:true,fulfillmentTypeConfirmed:true,commerceDomain:"merchant",fulfillmentType:"physical"}});
 const member=async(label:string)=>{
  const user=await db.user.create({data:{name:`Synthetic ${label}`,email:`${label}-${suffix}@example.test`,passwordHash:"synthetic-only",memberships:{create:{vendorId:vendor.id,role:"partner",status:"active"}}},include:{memberships:true}});
  const affiliate=await db.affiliate.create({data:{vendorId:vendor.id,name:`Synthetic ${label}`,code:`${label.toUpperCase()}-${suffix}`.slice(0,40),contactEmail:`${label}-${suffix}@example.test`}});
  const membership=await db.teamMembership.create({data:{vendorId:vendor.id,teamId:team.id,vendorMemberId:user.memberships[0]!.id,affiliateId:affiliate.id}});
  return {user,member:user.memberships[0]!,affiliate,membership};
 };
 const upline=await member("upline"),downline=await member("downline");
 await db.teamMembershipRelationship.create({data:{teamId:team.id,uplineMembershipId:upline.membership.id,downlineMembershipId:downline.membership.id,effectiveAt:new Date("2026-01-01T00:00:00Z")}});
 await publishMerchantAffiliatePolicy(db,{vendorId:vendor.id,userId:owner.id},{terms:{schemaVersion:1,currency:"TWD",maxTotalBps:10000,tiers:[{minQuantity:1,maxQuantity:null,rateBps:1000}],uplines:[{level:1,rateBps:300}],productOverrides:[]},expectedRevision:0});
 const order=async(affiliate:{id:string;code:string},occurredAt:Date)=>{
  const key=randomUUID();
  const payment=await createReservedPaymentTransaction({vendorId:vendor.id,productId:product.id,checkoutIdempotencyKey:key,
   transactionData:{vendorId:vendor.id,providerName:"demo",orderNumber:key,checkoutIdempotencyKey:key,grossAmountCents:1000,netAmountCents:1000,currency:"TWD",status:"pending",metadata:{productId:product.id,referralCode:affiliate.code}},
   createCommerceOrder:async(tx,created)=>{
    const commerceOrder=await createCommerceOrderForCheckout(tx,{vendorId:vendor.id,productId:product.id,orderNumber:key,checkoutIdempotencyKey:key,paymentTransactionId:created.id,totalAmountCents:1000,discountAmountCents:0,currency:"TWD",buyer:{name:"Synthetic buyer",email:"buyer@example.test",phone:"0912345678"},shipping:{recipientName:"Synthetic buyer",phone:"0912345678",countryCode:"TW",postalCode:"100",administrativeArea:"台北市",locality:"中正區",addressLine1:"合成測試路 1 號"}});
    await freezeMerchantAffiliateCheckout(tx,{vendorId:vendor.id,orderId:commerceOrder.id,transactionId:created.id,affiliateId:affiliate.id,referralCode:affiliate.code});
   }});
  const result=await db.$transaction(async tx=>{
   await tx.paymentTransaction.update({where:{id:payment.id},data:{status:"paid"}});
   await reconcileCommerceOrderPaymentTransition(tx,{vendorId:vendor.id,paymentTransactionId:payment.id,transition:"paid",eventIdentity:`paid:${payment.id}`,occurredAt});
   return accrueMerchantAffiliatePlan(tx,{vendorId:vendor.id,transactionId:payment.id,providerName:"demo",occurredAt});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  return result!.commissions;
 };
 return {vendor,upline,downline,order,manager:{vendorId:vendor.id,role:"owner"}};
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

 it("labels each statement row's source and never returns another affiliate's or tenant's commissions",async()=>{
  const t=await teamFixture(),other=await fixture();
  await setAffiliatePortalAccess(db,t.manager,{affiliateId:t.upline.affiliate.id,vendorMemberId:t.upline.member.id,active:true,expectedRevision:0});
  // The upline's own sale: a level-0 direct commission.
  const own=await t.order(t.upline.affiliate,new Date("2026-10-05T00:00:00Z"));
  expect(own.map(row=>[row.merchantLevel,row.affiliateId])).toEqual([[0,t.upline.affiliate.id]]);
  // The downline's sale: level 0 for the downline, level 1 for the upline.
  const team=await t.order(t.downline.affiliate,new Date("2026-10-06T00:00:00Z"));
  expect(team.map(row=>[row.merchantLevel,row.affiliateId,row.referralCode])).toEqual([[0,t.downline.affiliate.id,t.downline.affiliate.code],[1,t.upline.affiliate.id,t.downline.affiliate.code]]);
  // A legacy flat commission predates merchant levels and stays null.
  const legacy=await db.affiliateCommission.create({data:{vendorId:t.vendor.id,affiliateId:t.upline.affiliate.id,monthKey:"2026-09",deduplicationKey:randomUUID(),referralCode:t.upline.affiliate.code,attributedAt:new Date("2026-09-01T00:00:00Z")}});
  expect(legacy.merchantLevel).toBeNull();
  // Foreign-tenant and same-tenant other-affiliate rows must stay hidden.
  const foreign=await db.affiliateCommission.create({data:{vendorId:other.vendor.id,affiliateId:other.affiliate.id,monthKey:"2026-10",deduplicationKey:randomUUID(),referralCode:other.affiliate.code}});
  const downlineDirect=team.find(row=>row.merchantLevel===0)!;
  const uplineLevel1=team.find(row=>row.merchantLevel===1)!;

  const statement=await getAffiliatePortalStatement(db,{userId:t.upline.user.id},t.vendor.id,t.upline.affiliate.id);
  expect(statement).not.toBeNull();
  const sources=new Map(statement!.commissions.map(row=>[row.id,row.source]));
  expect(statement!.commissions).toHaveLength(3);
  expect(sources.get(own[0]!.id)).toEqual({kind:"direct"});
  expect(sources.get(uplineLevel1.id)).toEqual({kind:"upline",level:1,referralCode:t.downline.affiliate.code});
  expect(sources.get(legacy.id)).toEqual({kind:"direct"});
  expect(sources.has(downlineDirect.id)).toBe(false);
  expect(sources.has(foreign.id)).toBe(false);
  // Rows expose only the source summary, not raw snapshot or order fields.
  for(const row of statement!.commissions){
   expect(Object.keys(row).sort()).toEqual(["attributedAt","balanceCents","id","monthKey","source","status"]);
  }
  // The same-tenant downline and a foreign user still cannot read the upline's rows.
  expect(await getAffiliatePortalStatement(db,{userId:t.downline.user.id},t.vendor.id,t.upline.affiliate.id)).toBeNull();
  expect(await getAffiliatePortalStatement(db,{userId:other.user.id},t.vendor.id,t.upline.affiliate.id)).toBeNull();
  expect(await getAffiliatePortalStatement(db,{userId:t.upline.user.id},other.vendor.id,t.upline.affiliate.id)).toBeNull();
 });

});
