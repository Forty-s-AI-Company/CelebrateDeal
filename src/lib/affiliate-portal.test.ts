import {describe,expect,it,vi} from "vitest";
import {AffiliatePortalAccessInput,AffiliatePortalConflict,getAffiliatePortalStatement,setAffiliatePortalAccess} from "@/lib/affiliate-portal";
describe("affiliate portal input and fail-closed boundaries",()=>{
 it("rejects caller identity and unsafe or overflowing versions",()=>{
  const input={affiliateId:"affiliate",vendorMemberId:"member",active:true,expectedRevision:0};
  expect(AffiliatePortalAccessInput.safeParse({...input,vendorId:"foreign"}).success).toBe(false);
  expect(AffiliatePortalAccessInput.safeParse({...input,expectedRevision:2147483647}).success).toBe(false);
  expect(AffiliatePortalAccessInput.safeParse({...input,vendorMemberId:"../foreign"}).success).toBe(false);
 });
 it("does not touch the database for unauthorized grant roles or malformed statement identities",async()=>{
  const transaction=vi.fn();const db={$transaction:transaction};
  expect(await setAffiliatePortalAccess(db,{vendorId:"vendor",role:"accountant"},{})).toBeNull();
  expect(await getAffiliatePortalStatement(db,{userId:"user"},"../vendor","affiliate")).toBeNull();
  expect(transaction).not.toHaveBeenCalled();
 });
 it("rejects a stale version instead of silently replacing access",async()=>{
  const tx={affiliate:{findFirst:vi.fn().mockResolvedValue({id:"affiliate"})},vendorMember:{findFirst:vi.fn().mockResolvedValue({id:"member"})},affiliatePortalAccess:{findUnique:vi.fn().mockResolvedValue({revision:2}),updateMany:vi.fn().mockResolvedValue({count:0})}};
  const db={$transaction:vi.fn().mockImplementation(async callback=>callback(tx))};
  await expect(setAffiliatePortalAccess(db,{vendorId:"vendor",role:"owner"},{affiliateId:"affiliate",vendorMemberId:"member",active:true,expectedRevision:1})).rejects.toBeInstanceOf(AffiliatePortalConflict);
  expect(tx.affiliatePortalAccess.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{vendorId:"vendor",affiliateId:"affiliate",revision:1}}));
 });
 it("does not query financial data without the authenticated user's active grant",async()=>{
  const access=vi.fn().mockResolvedValue(null);
  const db={$transaction:vi.fn().mockImplementation(async callback=>callback({affiliatePortalAccess:{findFirst:access}}))};
  expect(await getAffiliatePortalStatement(db,{userId:"user"},"vendor","affiliate")).toBeNull();
  expect(access).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vendorId:"vendor",affiliateId:"affiliate",active:true,member:expect.objectContaining({userId:"user",status:"active"})})}));
 });
});
