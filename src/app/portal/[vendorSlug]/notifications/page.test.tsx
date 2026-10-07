import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({session:vi.fn(),find:vi.fn(),products:vi.fn(),getDb:vi.fn(),locale:vi.fn()}));
vi.mock("@/lib/student-portal-locale",()=>({resolveStudentPortalLocale:mocks.locale}));
vi.mock("@/lib/student-portal-auth",()=>({requireStudentPortalSession:mocks.session}));
vi.mock("@/lib/db",()=>({getDb:mocks.getDb}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
vi.mock("@/components/learner-notification-settings",()=>({LearnerNotificationSettings:({vendorSlug,courseId,locale}:{vendorSlug:string;courseId:string;locale:string})=><div data-settings-tenant={vendorSlug} data-settings-product={courseId} data-settings-locale={locale}>設定</div>}));
import Page from "./page";
const session={vendorId:"vendor-1",customerKeyHash:"a".repeat(43)};
const context=(after?:string,productsAfter?:string)=>({params:Promise.resolve({vendorSlug:"academy"}),searchParams:Promise.resolve({after,productsAfter})});
beforeEach(()=>{vi.clearAllMocks();mocks.locale.mockResolvedValue("zh-TW");mocks.session.mockResolvedValue({session});mocks.getDb.mockReturnValue({learnerNotificationPreference:{findMany:mocks.find},product:{findMany:mocks.products}});mocks.products.mockResolvedValue([]);mocks.find.mockResolvedValue([{id:"pref-1",productId:"product-1",product:{name:"已退款課程"}},{id:"pref-2",productId:"product-1",product:{name:"已退款課程"}}]);});
it("lists only server-scoped existing preferences and deduplicates product cards",async()=>{
 const html=renderToStaticMarkup(await Page(context()));expect(mocks.session).toHaveBeenCalledWith("academy");expect(mocks.find).toHaveBeenCalledWith({where:session,orderBy:{id:"asc"},take:21,select:{id:true,productId:true,product:{select:{name:true}}}});
 expect(html.match(/data-settings-product="product-1"/gu)).toHaveLength(1);expect(html).toContain("已退款課程");expect(html).not.toContain(session.customerKeyHash);expect(html).not.toContain("pref-1");
});
it("cursor preserves tenant/customer and exposes a bounded next-page link",async()=>{
 mocks.find.mockResolvedValue(Array.from({length:21},(_,i)=>({id:`pref-${String(i).padStart(2,"0")}`,productId:`product-${i}`,product:{name:`Course ${i}`}})));
 const html=renderToStaticMarkup(await Page(context("pref-before")));expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({where:{...session,id:{gt:"pref-before"}},take:21}));expect(html).toContain("after=pref-19");expect(html).not.toContain('data-settings-product="product-20"');
});
it("invalid cursor cannot reach the database",async()=>{await expect(Page(context("foreign/id"))).rejects.toThrow("NOT_FOUND");expect(mocks.find).not.toHaveBeenCalled();expect(mocks.products).not.toHaveBeenCalled();});
it("no registered preference has an explicit empty state",async()=>{mocks.find.mockResolvedValue([]);const html=renderToStaticMarkup(await Page(context()));expect(html).toContain("目前沒有已登記的通知設定");expect(html).not.toContain("下一頁通知設定");});
it("unauthenticated visitor cannot enumerate registered products",async()=>{mocks.session.mockRejectedValue(new Error("AUTH_REQUIRED"));await expect(Page(context())).rejects.toThrow("AUTH_REQUIRED");expect(mocks.find).not.toHaveBeenCalled();expect(mocks.products).not.toHaveBeenCalled();});

it("English notification management passes locale without translating merchant titles or changing identity",async()=>{
 mocks.locale.mockResolvedValue("en");mocks.find.mockResolvedValue([{id:"pref-1",productId:"product-1",product:{name:"通知設定"}}]);
 const html=renderToStaticMarkup(await Page(context()));
 expect(html).toContain("Notification settings");expect(html).toContain("通知設定");expect(html).toContain('data-settings-locale="en"');
 expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({where:session,take:21}));
 expect(html).not.toContain(session.customerKeyHash);
});

it("purchased digital resources are discoverable before any registered preference",async()=>{
 mocks.find.mockResolvedValue([]);mocks.products.mockResolvedValue([{id:"digital-1",name:"數位商品原文"}]);
 const html=renderToStaticMarkup(await Page(context()));expect(html).toContain('data-settings-product="digital-1"');expect(html).toContain("數位商品原文");expect(html).not.toContain("目前沒有已登記的通知設定");
 expect(mocks.products).toHaveBeenCalledWith(expect.objectContaining({where:{vendorId:session.vendorId,commerceOrderItems:{some:expect.objectContaining({vendorId:session.vendorId,order:{is:{vendorId:session.vendorId,automationCustomerKeyHash:session.customerKeyHash,status:{in:["paid","partially_refunded"]}}},entitlement:{is:expect.objectContaining({vendorId:session.vendorId,status:"granted",revokedAt:null})}})}},take:21,orderBy:{id:"asc"}}));
});
it("purchase cursor is bounded and invalid purchase cursor never queries either store",async()=>{
 await expect(Page(context(undefined,"foreign/id"))).rejects.toThrow("NOT_FOUND");expect(mocks.products).not.toHaveBeenCalled();expect(mocks.find).not.toHaveBeenCalled();
 mocks.find.mockResolvedValue([]);mocks.products.mockResolvedValue(Array.from({length:21},(_,i)=>({id:`digital-${String(i).padStart(2,"0")}`,name:`Digital ${i}`})));
 const html=renderToStaticMarkup(await Page(context(undefined,"digital-before")));expect(mocks.products).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vendorId:session.vendorId,id:{gt:"digital-before"}}),take:21}));expect(html).toContain("productsAfter=digital-19");expect(html).not.toContain('data-settings-product="digital-20"');
});
