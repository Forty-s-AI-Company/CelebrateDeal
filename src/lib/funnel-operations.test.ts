import {describe,it,expect} from "vitest";
import {defaultFunnelOperations,parseFunnelOperations,FunnelExperimentSchema,validExperimentTransition,aggregateFunnelVisits} from "./funnel-operations";
const experiment = {id:"experiment-1",status:"running" as const,controlStepId:"control",variantStepId:"variant",controlWeight:50,variantWeight:50,winner:null};
describe("Funnel operations persistence contract",()=>{
 it("defaults absent legacy configuration and rejects corrupt persisted settings",()=>{
  expect(parseFunnelOperations(null)).toEqual(defaultFunnelOperations());
  expect(parseFunnelOperations({schemaVersion:2})).toBeNull();
  expect(parseFunnelOperations({...defaultFunnelOperations(),extra:true})).toBeNull();
 });
 it.each([[30,30],[50.5,49.5],[-1,101],[0,100]])("rejects invalid running weights %i/%i",(controlWeight,variantWeight)=>{
  expect(FunnelExperimentSchema.safeParse({...experiment,controlWeight,variantWeight}).success).toBe(false);
 });
 it("validates step identity and winner state",()=>{
  expect(FunnelExperimentSchema.safeParse({...experiment,variantStepId:"control"}).success).toBe(false);
  expect(FunnelExperimentSchema.safeParse({...experiment,status:"winner"}).success).toBe(false);
  expect(FunnelExperimentSchema.safeParse({...experiment,status:"winner",winner:"variant"}).success).toBe(true);
 });
 it("locks allocation and experiment identity until stopped; terminal winners cannot silently change",()=>{
  expect(validExperimentTransition(experiment,{...experiment,controlWeight:60,variantWeight:40})).toBe(false);
  expect(validExperimentTransition(experiment,{...experiment,id:"new"})).toBe(false);
  expect(validExperimentTransition(experiment,null)).toBe(false);
  const stopped={...experiment,status:"stopped" as const};
  expect(validExperimentTransition(experiment,stopped)).toBe(true);
  expect(validExperimentTransition(stopped,{...experiment,id:"new"})).toBe(true);
  expect(validExperimentTransition(stopped,experiment)).toBe(false);
  const winner={...experiment,status:"winner" as const,winner:"variant" as const};
  expect(validExperimentTransition(stopped,winner)).toBe(true);
  expect(validExperimentTransition(winner,{...winner,winner:"control"})).toBe(false);
 });
 it("requires explicit offset and valid timezone/redirect target",()=>{
  const config=defaultFunnelOperations();
  expect(parseFunnelOperations({...config,deadline:{...config.deadline,enabled:true}})).toBeNull();
  expect(parseFunnelOperations({...config,deadline:{...config.deadline,expiresAt:"2026-11-01T01:30:00"}})).toBeNull();
  expect(parseFunnelOperations({...config,deadline:{...config.deadline,timezone:"Mars/Olympus"}})).toBeNull();
  expect(parseFunnelOperations({...config,deadline:{...config.deadline,enabled:true,expiresAt:"2026-11-01T01:30:00-04:00",timezone:"America/New_York"}})).not.toBeNull();
  expect(parseFunnelOperations({...config,deadline:{...config.deadline,redirectPath:"//evil.example"}})).toBeNull();
 });
});
describe("trusted visit aggregation",()=>{
 const steps=[{id:"first",name:"First"},{id:"second",name:"Second"},{id:"third",name:"Third"}];
 const visit=(id:string,stepId:string,visitorId:string,time:number)=>({id,stepId,visitorId,createdAt:new Date(time)});
 it("counts deliveries and distinct visitors, requiring forward temporal progression",()=>{
  const visits=[visit("1","first","a",10),visit("2","first","a",20),visit("3","second","a",30),visit("4","second","b",5),visit("5","first","b",10),visit("6","third","a",40)];
  const rows=aggregateFunnelVisits(steps,visits,[{stepId:"first"}]);
  expect(rows[0]).toMatchObject({pageViews:3,visitors:2,submissions:1,conversions:1,conversionRate:0.5,dropOff:1});
  expect(rows[1]).toMatchObject({conversions:1,dropOff:1});
  expect(rows[2]).toMatchObject({conversions:null,conversionRate:null,dropOff:null});
 });
 it("recognizes a later next-step visit even if an earlier visit occurred out of order",()=>{
  expect(aggregateFunnelVisits(steps,[visit("1","second","a",1),visit("2","first","a",2),visit("3","second","a",3)],[])[0]?.conversions).toBe(1);
 });
 it("empty denominator is not a fictitious zero conversion percentage",()=>{
  expect(aggregateFunnelVisits(steps,[],[])[0]).toMatchObject({pageViews:0,visitors:0,conversionRate:null,dropOff:0});
 });
});
