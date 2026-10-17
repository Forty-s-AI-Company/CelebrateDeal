import type {PrismaClient} from '@prisma/client';
import {z} from 'zod';
import {issueMetricVisitPage} from './live-metric-visit-page';
import {MetricVisitorError} from './live-metric-visitor';
import type {MetricIngressBinding} from './live-metric-ingress-proof';
const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope=z.object({formId:id,liveId:id}).strict();
export function parseMetricRegistrationPageScope(value:unknown){
 const checked=Scope.safeParse(value);return checked.success?checked.data:null;
}

/** Server-selected registration surface only, not an HTTP authorization API.
 * The initial owner lookup is a hint; issuance rechecks the exact current
 * form/live/vendor and public form gate under row locks in its transaction.
 * No fan-out, arbitrary first session or client-supplied vendor is accepted.
 */
export async function issueMetricRegistrationPage(db:Pick<PrismaClient,'registrationForm'|'$transaction'>,value:z.infer<typeof Scope>,binding?:MetricIngressBinding){
 const scope=parseMetricRegistrationPageScope(value);if(!scope)return null;
 try{
  const form=await db.registrationForm.findFirst({where:{id:scope.formId,isActive:true},select:{vendorId:true}});
  if(!form)return null;
  const page=binding?await issueMetricVisitPage(db,{vendorId:form.vendorId,liveId:scope.liveId},{formId:scope.formId},binding):await issueMetricVisitPage(db,{vendorId:form.vendorId,liveId:scope.liveId},{formId:scope.formId});
  return page?{...page,vendorId:form.vendorId,liveId:scope.liveId}:null;
 }catch(error){
  if(error instanceof MetricVisitorError)throw error;
  throw new MetricVisitorError('PERSISTENCE_UNAVAILABLE');
 }
}
