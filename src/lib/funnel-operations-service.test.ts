import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
import { defaultFunnelOperations } from "./funnel-operations";
const mocks = vi.hoisted(()=>({find:vi.fn(),update:vi.fn(),products:vi.fn(),visits:vi.fn(),submissions:vi.fn(),orders:vi.fn(),assigned:vi.fn(),auth:vi.fn(),scope:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireVendorManagerContext:mocks.auth}));
vi.mock("@/lib/sales-project-scope",()=>({requireEditableSalesProjectScope:mocks.scope}));
vi.mock("@/lib/db",()=>({getDb:()=>({landingPage:{findFirst:mocks.find,updateMany:mocks.update},product:{count:mocks.products},funnelVisit:{findMany:mocks.visits,count:mocks.assigned},funnelSubmission:{findMany:mocks.submissions},commerceOrder:{findMany:mocks.orders}})}));
import {loadFunnelOperations,saveFunnelOperations,loadFunnelReports} from "./funnel-operations-service";
const content=createGoalFunnelStepPages({id:"funnel",name:"Example",domain:"example",goal:"audience",currency:"TWD"})!;
function page(){return {id:"page1",vendorId:"vendor1",projectId:"project1",name:"Example",slug:"example",revision:4,status:"draft",draftContent:content,operations:null,publishedVersion:{content}};}
function input(){return {pageId:"page1",revision:4,name:"Updated",slug:"updated",currency:"TWD",operations:defaultFunnelOperations()};}
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({auth:{user:{id:"user1"}},vendor:{id:"vendor1"}});mocks.scope.mockResolvedValue({projectId:"project1"});mocks.find.mockResolvedValue(page());mocks.update.mockResolvedValue({count:1});mocks.products.mockResolvedValue(0);mocks.assigned.mockResolvedValue(0);mocks.visits.mockResolvedValue([]);mocks.submissions.mockResolvedValue([]);mocks.orders.mockResolvedValue([]);});
describe("Funnel operations tenant/CAS boundary",()=>{
 it("derives tenant/project from server context",async()=>{
  await loadFunnelOperations("page1");
  expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({where:{id:"page1",vendorId:"vendor1",projectId:"project1"}}));
 });
 it("rejects inaccessible page and never writes",async()=>{
  mocks.find.mockResolvedValue(null);
  await expect(saveFunnelOperations(input())).rejects.toThrow("存取權限");expect(mocks.update).not.toHaveBeenCalled();
 });
 it("rejects aggregate workspace and invalid client scope",async()=>{
  mocks.scope.mockResolvedValue({projectId:null});await expect(loadFunnelOperations("page1")).rejects.toThrow("銷售專案");
  await expect(saveFunnelOperations({...input(),vendorId:"foreign"})).rejects.toThrow();
 });
 it("synchronizes flow metadata and shares atomic revision with page editor",async()=>{
  expect(await saveFunnelOperations(input())).toEqual({revision:5});
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:"page1",vendorId:"vendor1",projectId:"project1",revision:4},data:expect.objectContaining({revision:{increment:1},draftContent:expect.objectContaining({flow:expect.objectContaining({name:"Updated",domain:"updated",currency:"TWD"})})})}));
 });
 it("rejects stale read and atomic race without overwriting data",async()=>{
  await expect(saveFunnelOperations({...input(),revision:3})).rejects.toThrow("版本衝突");expect(mocks.update).not.toHaveBeenCalled();
  mocks.update.mockResolvedValue({count:0});await expect(saveFunnelOperations(input())).rejects.toThrow("版本衝突");
 });
 it("does not silently change a published slug",async()=>{
  mocks.find.mockResolvedValue({...page(),status:"published"});await expect(saveFunnelOperations(input())).rejects.toThrow("slug");
 });
 it("rejects unknown report/experiment step IDs",async()=>{
  const config=defaultFunnelOperations();config.reports.stats.stepId="foreign";
  await expect(saveFunnelOperations({...input(),operations:config})).rejects.toThrow("步驟不存在");
 });
 it("rejects reuse of an old experiment identity with persisted assignments",async()=>{
  mocks.assigned.mockResolvedValue(1);
  const operations={...defaultFunnelOperations(),experiment:{id:"old-exp",status:"draft",controlStepId:content.flow.steps[0]!.id,variantStepId:content.flow.steps[1]!.id,controlWeight:50,variantWeight:50,winner:null}};
  await expect(saveFunnelOperations({...input(),operations})).rejects.toThrow("已有分流紀錄");
  expect(mocks.update).not.toHaveBeenCalled();
 });
 it("requires published steps before activating experiment",async()=>{
  mocks.find.mockResolvedValue({...page(),publishedVersion:null});
  const operations={...defaultFunnelOperations(),experiment:{id:"exp1",status:"running",controlStepId:content.flow.steps[0]!.id,variantStepId:content.flow.steps[1]!.id,controlWeight:50,variantWeight:50,winner:null}};
  await expect(saveFunnelOperations({...input(),operations})).rejects.toThrow("先發布");
 });
 it("rejects redirect to home or unknown destination",async()=>{
  const operations=defaultFunnelOperations();operations.deadline={enabled:true,expiresAt:"2027-01-01T00:00:00Z",timezone:"Asia/Taipei",behavior:"redirect",redirectPath:content.flow.steps[0]!.path};
  await expect(saveFunnelOperations({...input(),operations})).rejects.toThrow("非首頁");
 });
 it("allows a stopped experiment step as the published deadline destination",async()=>{
  const experiment={id:"exp-stopped",status:"stopped" as const,controlStepId:content.flow.steps[0]!.id,variantStepId:content.flow.steps[1]!.id,controlWeight:50,variantWeight:50,winner:null};
  const previous={...defaultFunnelOperations(),experiment};
  mocks.find.mockResolvedValue({...page(),operations:previous});
  const operations={...previous,deadline:{enabled:true,expiresAt:"2027-01-01T00:00:00Z",timezone:"Asia/Taipei",behavior:"redirect" as const,redirectPath:content.flow.steps[1]!.path}};
  await expect(saveFunnelOperations({...input(),operations})).resolves.toEqual({revision:5});
 });
});
describe("trusted report queries",()=>{
 it("scopes every source to tenant/page and uses paid order projection only",async()=>{
  const result=await loadFunnelReports("page1",new Date("2026-09-17T00:00:00Z"));
  expect(result.sales).toEqual([]);
  expect(mocks.visits).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vendorId:"vendor1",pageId:"page1"})}));
  expect(mocks.submissions).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({submission:{form:{vendorId:"vendor1",projectId:"project1"}}})}));
  expect(mocks.orders).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({vendorId:"vendor1",projectId:"project1",isTestOrder:false,paidAmountCents:{gt:0},primaryPaymentTransaction:{is:{vendorId:"vendor1",metadata:{path:["funnel","pageId"],equals:"page1"}}}})}));
  const leadQuery=mocks.submissions.mock.calls[1]![0];expect(JSON.stringify(leadQuery.select)).not.toMatch(/email|phone|answers|name/);
 });
 it("does not expose payment metadata or buyer PII",async()=>{
  mocks.orders.mockResolvedValue([{id:"order",orderNumber:"number",status:"paid",currency:"TWD",paidAmountCents:1000,refundedAmountCents:200,paidAt:new Date("2026-09-16"),primaryPaymentTransaction:{id:"payment",status:"partially_refunded",metadata:{funnel:{stepId:"order_form"},private:"sensitive"}}}]);
  const result=await loadFunnelReports("page1");expect(result.sales[0]).toMatchObject({id:"order",paymentId:"payment",stepId:"order_form",refundedAmountCents:200});expect(JSON.stringify(result)).not.toContain("sensitive");
 });
});
