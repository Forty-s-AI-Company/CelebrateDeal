import { describe, expect, it, vi } from "vitest";
import { findLineAccount, resolveSubjectLineAccount } from "./line-account-routing";

function database() {
  return {
    lineOfficialAccount:{findFirst:vi.fn(async({where})=>({id:where.id??"default",vendorId:where.vendorId,status:"active"}))},
    salesProject:{findFirst:vi.fn().mockResolvedValue({lineOfficialAccountId:"course-account"})},
    formSubmission:{findFirst:vi.fn().mockResolvedValue({form:{projectId:"course-a"},live:null})},
    commerceOrder:{findFirst:vi.fn().mockResolvedValue({projectId:"course-a"})},
  };
}
describe("Project LINE account routing",()=>{
  it("pins explicit accounts to the vendor and never retries another account",async()=>{
    const db=database();db.lineOfficialAccount.findFirst.mockResolvedValueOnce(null as never);
    expect(await findLineAccount(db as never,"vendor-a","foreign-account")).toBeNull();
    expect(db.lineOfficialAccount.findFirst).toHaveBeenCalledExactlyOnceWith({where:{vendorId:"vendor-a",id:"foreign-account"}});
  });
  it.each(["buyer_registration","buyer_order"])("routes %s through its Project rather than the default account",async type=>{
    const db=database();expect(await resolveSubjectLineAccount(db as never,"vendor-a",type,"subject-a")).toMatchObject({id:"course-account"});
    expect(db.salesProject.findFirst).toHaveBeenCalledWith({where:{id:"course-a",vendorId:"vendor-a"},select:{lineOfficialAccountId:true}});
    expect(db.lineOfficialAccount.findFirst).toHaveBeenCalledExactlyOnceWith({where:{vendorId:"vendor-a",id:"course-account"}});
  });
  it("does not fall back for an unconfigured Project or a missing subject",async()=>{
    const db=database();db.salesProject.findFirst.mockResolvedValueOnce({lineOfficialAccountId:null} as never);
    expect(await resolveSubjectLineAccount(db as never,"vendor-a","buyer_registration","subject-a")).toBeNull();
    db.formSubmission.findFirst.mockResolvedValueOnce(null);
    expect(await resolveSubjectLineAccount(db as never,"vendor-a","buyer_registration","missing")).toBeNull();
    expect(db.lineOfficialAccount.findFirst).not.toHaveBeenCalled();
  });
  it("retains default routing only for legacy records without a Project",async()=>{
    const db=database();db.commerceOrder.findFirst.mockResolvedValueOnce({projectId:null});
    expect(await resolveSubjectLineAccount(db as never,"vendor-a","buyer_order","legacy")).toMatchObject({id:"default"});
    expect(db.lineOfficialAccount.findFirst).toHaveBeenCalledExactlyOnceWith({where:{vendorId:"vendor-a",isDefault:true}});
  });
  it("rejects a registration whose form and live belong to different Projects or vendors",async()=>{
    const db=database();db.formSubmission.findFirst.mockResolvedValueOnce({form:{projectId:"a"},live:{vendorId:"vendor-a",projectId:"b"}} as never);
    expect(await resolveSubjectLineAccount(db as never,"vendor-a","buyer_registration","subject-a")).toBeNull();
    db.formSubmission.findFirst.mockResolvedValueOnce({form:{projectId:null},live:{vendorId:"foreign",projectId:"b"}} as never);
    expect(await resolveSubjectLineAccount(db as never,"vendor-a","buyer_registration","subject-a")).toBeNull();
    expect(db.lineOfficialAccount.findFirst).not.toHaveBeenCalled();
  });
});
