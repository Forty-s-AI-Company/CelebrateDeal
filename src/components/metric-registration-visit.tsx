import type {ReactNode} from 'react';
import {optionalMetricPage} from '@/lib/optional-metric-page';
import {connection} from 'next/server';
import {headers} from 'next/headers';
import {getDb} from '@/lib/db';
import {issueMetricRegistrationPage,parseMetricRegistrationPageScope} from '@/lib/live-metric-registration-page';
import {LiveMetricVisit} from '@/components/live-metric-visit';
import {metricIngressConfigured,metricIngressFromRequest,MetricIngressBindingError} from '@/lib/live-metric-ingress-proof';

/** Server-only composition at actual registration surfaces. Never adds a
 * counted event during SSR; the existing browser protocol owns acknowledgement.
 * Ambiguous/no-live resources and absent collection config remain untracked,
 * not an audited zero. The child keeps its existing form and retry behaviour.
 */
export async function withMetricRegistrationVisit(child:ReactNode,scope:{formId?:string;liveId?:string},entry?:{kind:'form'|'landing'|'landing_step';target:string}){
 const resolved=parseMetricRegistrationPageScope(scope);
 if(!resolved||!process.env.LIVE_METRIC_VISITOR_KEYRING)return compose(child,null);
 await connection();
 if(metricIngressConfigured()&&!entry)throw new MetricIngressBindingError();
 const binding=metricIngressConfigured()?metricIngressFromRequest(await headers(),{...entry!,method:'GET'}):undefined;
 const page=await optionalMetricPage(()=>binding?issueMetricRegistrationPage(getDb(),resolved,binding):issueMetricRegistrationPage(getDb(),resolved));
 return compose(child,page);
}
function compose(child:ReactNode,page:Awaited<ReturnType<typeof issueMetricRegistrationPage>>){
 // Keep the form at the same sibling slot when tracking availability changes.
 return <>{page?<LiveMetricVisit key={`${page.liveId}:${page.eventId}`} vendorId={page.vendorId} liveId={page.liveId} eventId={page.eventId}/>:null}{child}</>;
}
