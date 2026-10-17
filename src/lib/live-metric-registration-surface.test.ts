import {expect,it} from 'vitest';
import {createEmptyPageDocument,FunnelNodeSchema} from './funnel-page-document';
import {createFunnelFlow} from './funnel-flow';
import {createFunnelStepPages} from './funnel-step-pages';
import {hasMetricRegistrationForm,metricWebinarRegistrationScope} from './live-metric-registration-surface';
const node=(type:string,props:Record<string,unknown>={},children:unknown[]=[])=>FunnelNodeSchema.parse({schemaVersion:1,id:'synthetic-'+type,type,props,children});
it('recognizes a public lead form but excludes checkout and hidden ancestors',()=>{
 const document=createEmptyPageDocument();expect(hasMetricRegistrationForm(document)).toBe(false);
 document.root=[node('section',{},[node('form')])];expect(hasMetricRegistrationForm(document)).toBe(true);
 document.root[0].visible=false;expect(hasMetricRegistrationForm(document)).toBe(false);
 document.root=[node('form',{'variant':'checkout-contact'})];expect(hasMetricRegistrationForm(document)).toBe(false);
 document.root=[node('image',{},[node('form')])];expect(hasMetricRegistrationForm(document)).toBe(false);
});
it('does not infer an opened popup or a registration visit from a CTA-only document',()=>{
 const document=createEmptyPageDocument();document.root=[node('button')];expect(hasMetricRegistrationForm(document)).toBe(false);
});
it('respects configured viewport visibility and resolved checkout overrides without claiming exposure',()=>{
 const document=createEmptyPageDocument(),form=node('form');document.root=[form];
 form.visible=false;form.overrides.mobile={visible:true};expect(hasMetricRegistrationForm(document)).toBe(true);
 form.visible=true;form.overrides={desktop:{props:{variant:'checkout-contact'}},mobile:{props:{variant:'checkout-contact'}}};
 expect(hasMetricRegistrationForm(document)).toBe(false);
});
it('tracks only configured active webinar registration steps, never thankyou or broadcast',()=>{
 const state=createFunnelStepPages(createFunnelFlow({id:'webinar',name:'Synthetic',goal:'webinar',domain:'synthetic'})!)!;
 state.flow.webinar={timezone:'UTC',startsAt:'2026-10-01T00:00:00Z',endsAt:'2026-10-01T01:00:00Z',replayEndsAt:'2026-10-02T00:00:00Z'};
 const resource={form:{id:'form'},live:{id:'live'}},now=Date.parse('2026-10-01T00:30:00Z');
 const registration=state.flow.steps.find(step=>step.type==='webinar_registration_page')!;
 expect(metricWebinarRegistrationScope(state,registration.id,resource,now)).toEqual({formId:'form',liveId:'live'});
 for(const step of state.flow.steps.filter(value=>value.id!==registration.id))expect(metricWebinarRegistrationScope(state,step.id,resource,now)).toEqual({});
 expect(metricWebinarRegistrationScope(state,registration.id,{form:{id:'form'}} as never,now)).toEqual({});
 expect(metricWebinarRegistrationScope(state,registration.id,resource,Date.parse('2026-10-03T00:00:00Z'))).toEqual({});
});
