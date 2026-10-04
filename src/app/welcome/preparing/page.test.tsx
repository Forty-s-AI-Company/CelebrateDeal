import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ preference:vi.fn(), count:vi.fn() }));
vi.mock("@/lib/auth",()=>({requireVendorManagerContext:async()=>({auth:{user:{id:"user-1"}},vendor:{id:"vendor-1"}})}));
vi.mock("@/lib/db",()=>({getDb:()=>({userOnboardingPreference:{findUnique:mocks.preference},onboardingTaskState:{count:mocks.count}})}));
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw new Error(`redirect:${path}`);}}));
vi.mock("@/components/workspace-preparing-progress",()=>({WorkspacePreparingProgress:()=>null}));
import PreparingWorkspacePage from "./page";
beforeEach(()=>{vi.clearAllMocks();mocks.count.mockResolvedValue(3);mocks.preference.mockResolvedValue({selectedMode:"live_course",questionnaireDoneAt:new Date()});});
describe("completed workspace preparation",()=>{
 it("accepts a completed aggregate workspace without requiring project selection",async()=>{const page=await PreparingWorkspacePage();expect(page.type).toBe("main");expect(mocks.preference).toHaveBeenCalledWith({where:{userId_vendorId:{userId:"user-1",vendorId:"vendor-1"}},select:{selectedMode:true,questionnaireDoneAt:true}});expect(mocks.count).toHaveBeenCalledWith({where:{vendorId:"vendor-1",scopeKey:"workspace"}});});
 it.each([null,{selectedMode:"live_course",questionnaireDoneAt:null},{selectedMode:null,questionnaireDoneAt:new Date()}])("returns incomplete state to the questionnaire",async(preference)=>{mocks.preference.mockResolvedValue(preference);await expect(PreparingWorkspacePage()).rejects.toThrow("redirect:/welcome");});
 it("does not use unrelated project tasks as workspace completion",async()=>{mocks.count.mockResolvedValue(0);await expect(PreparingWorkspacePage()).rejects.toThrow("redirect:/welcome");});
});
