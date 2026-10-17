import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({security:vi.fn(),auth:vi.fn(),project:vi.fn(),account:vi.fn(),sending:vi.fn(),update:vi.fn(),audit:vi.fn(),transaction:vi.fn(),revalidate:vi.fn()}));
vi.mock("@/lib/csrf",()=>({assertServerActionSecurity:mocks.security}));
vi.mock("@/lib/auth",()=>({requireVendorManagerContext:mocks.auth}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`redirect:${url}`);}}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
vi.mock("@/lib/db",()=>({getDb:()=>({$transaction:mocks.transaction})}));
import { selectProjectLineAccountAction } from "./project-line-actions";
const form=()=>{const data=new FormData();data.set("projectId","project-a");data.set("accountId","account-b");data.set("vendorId","foreign");return data;};
beforeEach(()=>{
  vi.resetAllMocks();mocks.auth.mockResolvedValue({vendor:{id:"vendor-a"},auth:{user:{id:"owner-a"}}});
  mocks.project.mockResolvedValue({id:"project-a",vendorId:"vendor-a",lineOfficialAccountId:"account-a"});
  mocks.account.mockResolvedValue({id:"account-b"});mocks.sending.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async(callback)=>callback({salesProject:{findFirst:mocks.project,update:mocks.update},lineOfficialAccount:{findFirst:mocks.account},lineDelivery:{findFirst:mocks.sending},auditLog:{create:mocks.audit}}));
});
describe("Project account selection",()=>{
  it("saves a reusable same-tenant account after CSRF and manager authority",async()=>{
    await expect(selectProjectLineAccountAction(form())).rejects.toThrow("redirect:/projects/project-a?lineSaved=1");
    expect(mocks.project).toHaveBeenCalledWith({where:{id:"project-a",vendorId:"vendor-a"}});
    expect(mocks.account).toHaveBeenCalledWith({where:{id:"account-b",vendorId:"vendor-a",status:"active"},select:{id:true}});
    expect(mocks.update).toHaveBeenCalledWith({where:{vendorId_id:{vendorId:"vendor-a",id:"project-a"}},data:{lineOfficialAccountId:"account-b"}});
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({isolationLevel:"Serializable"});
    expect(mocks.security.mock.invocationCallOrder[0]).toBeLessThan(mocks.auth.mock.invocationCallOrder[0]!);
  });
  it.each(["project","account"] as const)("rejects a foreign or missing %s",async key=>{
    mocks[key].mockResolvedValueOnce(null);
    await expect(selectProjectLineAccountAction(form())).rejects.toThrow("lineError=unavailable");
    expect(mocks.update).not.toHaveBeenCalled();expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("does not switch while a delivery is in flight",async()=>{
    mocks.sending.mockResolvedValueOnce({id:"delivery-a"});
    await expect(selectProjectLineAccountAction(form())).rejects.toThrow("lineError=unavailable");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("allows explicitly disabling Project LINE without changing publication state",async()=>{
    const data=form();data.set("accountId","");
    await expect(selectProjectLineAccountAction(data)).rejects.toThrow("lineSaved=1");
    expect(mocks.account).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({data:{lineOfficialAccountId:null}}));
  });
  it.each(["security","auth"] as const)("stops before data access when %s fails",async key=>{
    mocks[key].mockRejectedValueOnce(new Error("forbidden"));
    await expect(selectProjectLineAccountAction(form())).rejects.toThrow("forbidden");expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
