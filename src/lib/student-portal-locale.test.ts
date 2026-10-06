import {describe,expect,it,vi} from "vitest";
import {normalizeStudentPortalLocale,safeStudentPortalReturnPath,resolveStudentPortalLocale} from "./student-portal-locale";
import {portalText,PORTAL_ENGLISH_COPY} from "./student-portal-translations";
const cookie=vi.hoisted(()=>vi.fn());vi.mock("next/headers",()=>({cookies:async()=>({get:cookie})}));
describe("learner UI locale preference",()=>{
 it("accepts only the two supported locales without influencing an identity",async()=>{for(const value of [undefined,null,"en-US","../en",["en"],{vendorId:"foreign"}])expect(normalizeStudentPortalLocale(value)).toBe("zh-TW");expect(normalizeStudentPortalLocale("en")).toBe("en");cookie.mockReturnValue({value:"en"});expect(await resolveStudentPortalLocale()).toBe("en");});
 it("allows only portal pages and rejects capability/query/open-redirect destinations",()=>{for(const path of ["https://foreign.example.test","//foreign.example.test","/portal/teacher/access?token=synthetic","/portal/teacher?customer=other","/portal/../admin","/dashboard",["/portal/teacher"]])expect(safeStudentPortalReturnPath(path)).toBe("/portal/");for(const path of ["/portal/teacher","/portal/teacher/login","/portal/teacher/learn/course_a/community"])expect(safeStudentPortalReturnPath(path)).toBe(path);});
 it("translates product copy while preserving unknown merchant/learner strings and prototype keys",()=>{expect(portalText("en","我的課程")).toBe("My courses");expect(portalText("zh-TW","我的課程")).toBe("我的課程");for(const text of ["合成講師名稱","constructor","__proto__"])expect(portalText("en",text)).toBe(text);expect(Object.values(PORTAL_ENGLISH_COPY).every(text=>text.length>0)).toBe(true);});
});

it("keeps the current discussion/withdrawal page without accepting data or capability routes",()=>{
 for(const path of ["/portal/teacher/learn/course_a/community/post_a","/portal/teacher/notifications"])expect(safeStudentPortalReturnPath(path)).toBe(path);
 for(const path of ["/portal/teacher/learn/course_a/community/data","/portal/teacher/learn/course_a/community/data/","/portal/teacher/learn/course_a/community/post_a?token=synthetic","/portal/teacher/learn/course_a/notifications/enroll","/portal/teacher/notifications/data","/portal/teacher/../admin"])expect(safeStudentPortalReturnPath(path)).toBe("/portal/");
});
