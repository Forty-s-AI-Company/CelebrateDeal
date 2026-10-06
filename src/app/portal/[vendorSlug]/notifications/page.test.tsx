import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({session:vi.fn(),find:vi.fn(),getDb:vi.fn()}));
vi.mock("@/lib/student-portal-auth",()=>({requireStudentPortalSession:mocks.session}));
vi.mock("@/lib/db",()=>({getDb:mocks.getDb}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
vi.mock("@/components/learner-notification-settings",()=>({LearnerNotificationSettings:({vendorSlug,courseId}:{vendorSlug:string;courseId:string})=><div data-settings-tenant={vendorSlug} data-settings-product={courseId}>設定</div>}));
import Page from "./page";
const session={vendorId:"vendor-1",customerKeyHash:"a".repeat(43)};
const context=(after?:string)=>({params:Promise.resolve({vendorSlug:"academy"}),searchParams:Promise.resolve({after})});
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({session});mocks.getDb.mockReturnValue({learnerNotificationPreference:{findMany:mocks.find}});mocks.find.mockResolvedValue([{id:"pref-1",productId:"product-1",product:{name:"已退款課程"}},{id:"pref-2",productId:"product-1",product:{name:"已退款課程"}}]);});
it("lists only server-scoped existing preferences and deduplicates product cards",async()=>{
 const html=renderToStaticMarkup(await Page(context()));expect(mocks.session).toHaveBeenCalledWith("academy");expect(mocks.find).toHaveBeenCalledWith({where:session,orderBy:{id:"asc"},take:21,select:{id:true,productId:true,product:{select:{name:true}}}});
 expect(html.match(/data-settings-product="product-1"/gu)).toHaveLength(1);expect(html).toContain("已退款課程");expect(html).not.toContain(session.customerKeyHash);expect(html).not.toContain("pref-1");
});
it("cursor preserves tenant/customer and exposes a bounded next-page link",async()=>{
 mocks.find.mockResolvedValue(Array.from({length:21},(_,i)=>({id:`pref-${String(i).padStart(2,"0")}`,productId:`product-${i}`,product:{name:`Course ${i}`}})));
 const html=renderToStaticMarkup(await Page(context("pref-before")));expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({where:{...session,id:{gt:"pref-before"}},take:21}));expect(html).toContain("after=pref-19");expect(html).not.toContain('data-settings-product="product-20"');
});
it("invalid cursor cannot reach the database",async()=>{await expect(Page(context("foreign/id"))).rejects.toThrow("NOT_FOUND");expect(mocks.find).not.toHaveBeenCalled();});
it("no registered preference has an explicit empty state",async()=>{mocks.find.mockResolvedValue([]);const html=renderToStaticMarkup(await Page(context()));expect(html).toContain("目前沒有已登記的通知設定");expect(html).not.toContain("下一頁通知設定");});
it("unauthenticated visitor cannot enumerate registered products",async()=>{mocks.session.mockRejectedValue(new Error("AUTH_REQUIRED"));await expect(Page(context())).rejects.toThrow("AUTH_REQUIRED");expect(mocks.find).not.toHaveBeenCalled();});
