import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({security:vi.fn(),set:vi.fn(),redirect:vi.fn()}));
vi.mock("next/headers",()=>({cookies:async()=>({set:mocks.set})}));vi.mock("next/navigation",()=>({redirect:mocks.redirect}));vi.mock("@/lib/csrf",()=>({assertServerActionSecurity:mocks.security}));vi.mock("@/lib/app-url",()=>({getCanonicalAppUrl:()=>"https://app.example.test"}));
import {setStudentPortalLocaleAction} from "./student-portal-locale-actions";
beforeEach(()=>{vi.clearAllMocks();mocks.security.mockResolvedValue(undefined);});
describe("portal locale action",()=>{
 it("writes a scoped secure preference and redirects to an allowed page",async()=>{const form=new FormData();form.set("locale","en");form.set("returnPath","/portal/teacher/learn/course_a");await setStudentPortalLocaleAction(form);expect(mocks.security).toHaveBeenCalledWith(form);expect(mocks.set).toHaveBeenCalledWith("celebratedeal_portal_locale","en",{httpOnly:true,sameSite:"lax",secure:true,path:"/portal",maxAge:31536000});expect(mocks.redirect).toHaveBeenCalledWith("/portal/teacher/learn/course_a");});
 it("rejects CSRF before a preference mutation",async()=>{mocks.security.mockRejectedValue(new Error("synthetic denied"));await expect(setStudentPortalLocaleAction(new FormData())).rejects.toThrow("synthetic denied");expect(mocks.set).not.toHaveBeenCalled();});
 it("normalizes unsupported locale and rejects external redirects",async()=>{const form=new FormData();form.set("locale","foreign");form.set("returnPath","https://foreign.example.test");await setStudentPortalLocaleAction(form);expect(mocks.redirect).toHaveBeenCalledWith("/portal/");expect(mocks.set).toHaveBeenCalledWith("celebratedeal_portal_locale","zh-TW",expect.anything());});
});
