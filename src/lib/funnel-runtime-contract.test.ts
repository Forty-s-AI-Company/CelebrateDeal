import { describe,it,expect,vi } from "vitest";
import { assignFunnelExperiment,decidePublicFunnelRuntime,isFunnelDeadlineExpired,resolveTrustedFunnelSubmission } from "./funnel-runtime";
import { defaultFunnelOperations } from "./funnel-operations";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
const state=createGoalFunnelStepPages({id:"flow",name:"Test",domain:"test",goal:"audience",currency:"TWD"})!;
const steps=state.flow.steps;
const visitorId="00000000-0000-4000-8000-000000000001";
const experiment={id:"exp",status:"running" as const,controlStepId:steps[0]!.id,variantStepId:steps[1]!.id,controlWeight:70,variantWeight:30,winner:null};
describe("Funnel deterministic runtime contract",()=>{
 it("stable population assignment respects weights and never switches on repeated requests",()=>{
  let controls=0;
  for(let i=0;i<1000;i++){
   const visitor=`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`;
   const first=assignFunnelExperiment("page",experiment,visitor);
   expect(assignFunnelExperiment("page",experiment,visitor)).toEqual(first);
   if(first?.arm==="control")controls++;
  }
  expect(controls).toBeGreaterThan(650);expect(controls).toBeLessThan(750);
 });
 it("stopped serves control and winner forces the selected arm regardless of visitor hash",()=>{
  const operations={...defaultFunnelOperations(),experiment:{...experiment,status:"stopped" as const}};
  const stopped=decidePublicFunnelRuntime({pageId:"page",steps,requestedStepId:steps[0]!.id,operations,visitorId});
  expect(stopped).toMatchObject({status:"render",renderedStepId:steps[0]!.id});
  for(const winner of ["control","variant"] as const){
   expect(assignFunnelExperiment("page",{...experiment,status:"winner",winner},visitorId)?.arm).toBe(winner);
  }
 });
 it.each([
  ["Asia/Taipei","2026-09-17T10:00:00+08:00","2026-09-17T02:00:00Z"],
  ["America/New_York","2026-11-01T01:30:00-04:00","2026-11-01T05:30:00Z"],
  ["America/New_York","2026-11-01T01:30:00-05:00","2026-11-01T06:30:00Z"],
  ["Europe/Berlin","2026-03-29T03:00:00+02:00","2026-03-29T01:00:00Z"],
 ])("uses explicit instant for %s %s",(timezone,expiresAt,utc)=>{
  const operations=defaultFunnelOperations();operations.deadline={enabled:true,timezone,expiresAt,behavior:"closed",redirectPath:""};
  const instant=new Date(utc);
  expect(isFunnelDeadlineExpired(operations,new Date(instant.getTime()-1))).toBe(false);
  expect(isFunnelDeadlineExpired(operations,instant)).toBe(true);
  expect(decidePublicFunnelRuntime({pageId:"page",requestedStepId:steps[0]!.id,steps,operations,visitorId,now:instant}).status).toBe("closed");
 });
 it("rejects form writes after deadline even when the redirect destination can still render",async()=>{
  const operations=defaultFunnelOperations();operations.deadline={enabled:true,timezone:"UTC",expiresAt:"2000-01-01T00:00:00Z",behavior:"redirect",redirectPath:steps[1]!.path};
  const visit=vi.fn();
  const database={landingPage:{findFirst:vi.fn().mockResolvedValue({id:"page",vendorId:"vendor",operations,publishedVersion:{content:state,formId:"form",liveId:null}})},funnelVisit:{findFirst:visit}};
  expect(await resolveTrustedFunnelSubmission({pageId:"page",stepId:steps[1]!.id,formId:"form",liveId:null,visitorId,database:database as never})).toBeNull();expect(visit).not.toHaveBeenCalled();
 });
 it("lookups bind source visit to resolved vendor, page, rendered step and visitor",async()=>{
  const find=vi.fn().mockResolvedValue({id:"visit"});
  const database={landingPage:{findFirst:vi.fn().mockResolvedValue({id:"page",vendorId:"vendor",operations:null,publishedVersion:{content:state,formId:"form",liveId:null}})},funnelVisit:{findFirst:find}};
  await resolveTrustedFunnelSubmission({pageId:"page",stepId:steps[0]!.id,formId:"form",liveId:null,visitorId,database:database as never});
  expect(find).toHaveBeenCalledWith(expect.objectContaining({where:{vendorId:"vendor",pageId:"page",stepId:steps[0]!.id,visitorId}}));
 });
});
