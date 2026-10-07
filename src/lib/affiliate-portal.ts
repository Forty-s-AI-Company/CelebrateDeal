import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u);
export const AffiliatePortalAccessInput = z.object({ affiliateId: id, vendorMemberId: id, active: z.boolean(), expectedRevision: z.number().int().min(0).max(2147483646) }).strict();
type Database = Pick<PrismaClient, "$transaction">;
export class AffiliatePortalConflict extends Error {}

/** Permission grants are explicit and versioned. Member email never grants
 * access implicitly, and reassignment cannot cross the tenant's composite FK. */
export async function setAffiliatePortalAccess(db: Database, manager: { vendorId: string; role: string }, rawInput: unknown) {
  if (!["owner", "admin"].includes(manager.role)) return null;
  const input = AffiliatePortalAccessInput.parse(rawInput);
  return db.$transaction(async tx => {
    const key = {vendorId:manager.vendorId,affiliateId:input.affiliateId};
    // Revocation remains possible after any subject is disabled. Preserve the
    // existing recipient and require its identity plus the current CAS version.
    if (!input.active) {
      const revoked = await tx.affiliatePortalAccess.updateMany({
        where:{...key,vendorMemberId:input.vendorMemberId,revision:input.expectedRevision},
        data:{active:false,revision:{increment:1}},
      });
      if (revoked.count !== 1) throw new AffiliatePortalConflict("Stale access grant");
      return {revision:input.expectedRevision+1};
    }
    const affiliate = await tx.affiliate.findFirst({where:{id:input.affiliateId,vendorId:manager.vendorId,isActive:true},select:{id:true}});
    const member = await tx.vendorMember.findFirst({where:{id:input.vendorMemberId,vendorId:manager.vendorId,status:"active",user:{status:"active"}},select:{id:true}});
    if (!affiliate || !member) return null;
    const existing = await tx.affiliatePortalAccess.findUnique({where:{vendorId_affiliateId:key},select:{revision:true}});
    if (!existing) {
      if (input.expectedRevision !== 0) throw new AffiliatePortalConflict("Stale access grant");
      return tx.affiliatePortalAccess.create({data:{...key,vendorMemberId:member.id,active:input.active,revision:1},select:{revision:true}});
    }
    const updated = await tx.affiliatePortalAccess.updateMany({where:{...key,revision:input.expectedRevision},data:{vendorMemberId:member.id,active:input.active,revision:{increment:1}}});
    if (updated.count !== 1) throw new AffiliatePortalConflict("Stale access grant");
    return {revision:input.expectedRevision+1};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}

const cents = (value: number | null) => z.number().int().safe().parse(value ?? 0);
/** The statement is a repeatable-read snapshot. Financial totals come from
 * immutable accounting entries, never the historical gross commission field. */
export async function getAffiliatePortalStatement(db: Database, actor: { userId: string }, vendorId: string, affiliateId: string, cursor?: string) {
  if (![actor.userId,vendorId,affiliateId,...(cursor?[cursor]:[])].every(value=>id.safeParse(value).success)) return null;
  return db.$transaction(async tx => {
    const access = await tx.affiliatePortalAccess.findFirst({where:{vendorId,affiliateId,active:true,affiliate:{isActive:true},member:{status:"active",userId:actor.userId,user:{status:"active"}}},select:{affiliate:{select:{id:true,name:true,code:true}},revision:true}});
    if (!access) return null;
    const where = {vendorId,affiliateId};
    const anchor = cursor ? await tx.affiliateCommission.findFirst({where:{...where,id:cursor},select:{id:true,attributedAt:true}}) : null;
    if (cursor && !anchor) return null;
    const missingLedger = await tx.affiliateCommission.count({where:{...where,ledgerEntries:{none:{}}}});
    const balance = missingLedger ? null : cents((await tx.affiliateCommissionLedgerEntry.aggregate({where:{vendorId,commission:{affiliateId}},_sum:{amountCents:true}}))._sum.amountCents);
    const rows = await tx.affiliateCommission.findMany({where:{...where,...(anchor?{OR:[{attributedAt:{lt:anchor.attributedAt}},{attributedAt:anchor.attributedAt,id:{lt:anchor.id}}]}:{})},orderBy:[{attributedAt:"desc"},{id:"desc"}],take:21,select:{id:true,monthKey:true,status:true,attributedAt:true}});
    const sums = await tx.affiliateCommissionLedgerEntry.groupBy({by:["affiliateCommissionId"],where:{vendorId,affiliateCommissionId:{in:rows.map(row=>row.id)},commission:{affiliateId}},_sum:{amountCents:true},_count:{_all:true}});
    const amounts = new Map(sums.map(row=>[row.affiliateCommissionId,cents(row._sum.amountCents)]));
    return {affiliate:access.affiliate,balanceCents:balance,requiresReconciliation:missingLedger>0,commissions:rows.slice(0,20).map(row=>({...row,balanceCents:amounts.get(row.id)??null})),nextCursor:rows.length>20?rows[19]!.id:null};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}

/** Cursor is tenant-qualified and must belong to this user before paging. */
export async function listAffiliatePortalAccess(db: Database, actor: {userId:string}, cursor?:string) {
 if(!id.safeParse(actor.userId).success)return null;
 const parts=cursor?.split(".");
 if(parts&&(parts.length!==2||!parts.every(part=>id.safeParse(part).success)))return null;
 return db.$transaction(async tx=>{
  const where={active:true,affiliate:{isActive:true},member:{userId:actor.userId,status:"active",user:{status:"active"}}};
  const anchor=parts?await tx.affiliatePortalAccess.findFirst({where:{...where,vendorId:parts[0]!,affiliateId:parts[1]!},select:{vendorId:true,affiliateId:true}}):null;
  if(parts&&!anchor)return null;
  const rows=await tx.affiliatePortalAccess.findMany({where:{...where,...(anchor?{OR:[{vendorId:{gt:anchor.vendorId}},{vendorId:anchor.vendorId,affiliateId:{gt:anchor.affiliateId}}]}:{})},orderBy:[{vendorId:"asc"},{affiliateId:"asc"}],take:21,select:{vendorId:true,affiliateId:true,affiliate:{select:{name:true}},member:{select:{vendor:{select:{slug:true,name:true}}}}}});
  return {entries:rows.slice(0,20).map(row=>({affiliateId:row.affiliateId,affiliateName:row.affiliate.name,vendorSlug:row.member.vendor.slug,vendorName:row.member.vendor.name})),nextCursor:rows.length>20?`${rows[19]!.vendorId}.${rows[19]!.affiliateId}`:null};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
}
