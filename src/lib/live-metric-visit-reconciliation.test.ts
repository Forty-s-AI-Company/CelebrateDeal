import {expect,it,vi} from 'vitest';
import {reconcileMetricVisitSources,MAX_VISIT_RECONCILIATION_ROWS} from './live-metric-visit-reconciliation';
const eventId='10000000-0000-4000-8000-000000000001';
const scope={vendorId:'v',liveId:'l',versionId:'version',startAt:new Date(1000),endAt:new Date(3000)};
const context={isolation:'repeatable read',primary:true,asOf:new Date(5000),clockAt:new Date(5000),sourceRevision:BigInt(1),
 expiresAt:new Date(20000),collectionEnabled:true,collectionStartedAt:new Date(0)};
const page={eventId,issuedAt:new Date(1000),expiresAt:new Date(4000),lossAt:null,sourceKind:'registration',sourceFormId:'form',ingressFrameId:null};
const intent={eventId,visitorId:'visitor',preparedAt:new Date(1500)};
const fact={id:'20000000-0000-4000-8000-000000000001',eventId,visitorId:'visitor',visitedAt:new Date(2000)};
function database(pages:unknown[]=[],intents:unknown[]=[],facts:unknown[]=[],state:unknown=context,runs:unknown[]=[],frames:unknown[]=[],intakes:unknown[]=[]){
 return {$queryRaw:vi.fn().mockResolvedValueOnce([{rowSecurity:'on',statementTimeout:'1s',timeoutMs:1000,isolation:'repeatable read',primary:true,backendPid:123,transactionStartedAt:'synthetic transaction'}])
  .mockResolvedValueOnce([{rowSecurity:'on',statementTimeout:'1s',timeoutMs:1000,isolation:'repeatable read',primary:true,backendPid:123,transactionStartedAt:'synthetic transaction'}])
  .mockResolvedValueOnce([]).mockResolvedValueOnce([{rowSecurity:'off',timeoutMs:1000,backendPid:123,transactionStartedAt:'synthetic transaction'}]).mockResolvedValueOnce(state?[state]:[])
  .mockResolvedValueOnce(pages).mockResolvedValueOnce(intents).mockResolvedValueOnce(facts).mockResolvedValueOnce(runs)
  .mockResolvedValueOnce(frames).mockResolvedValueOnce(intakes).mockResolvedValue([])};
}
it('matched recorded sources and a genuinely empty recording never certify the public request universe',async()=>{
 for(const rows of [false,true]){
  const result=await reconcileMetricVisitSources(database(rows?[page]:[],rows?[intent]:[],rows?[fact]:[]),scope);
  expect(result).toMatchObject({status:'available',sourceUniverse:'whole_version_recorded_only',
   coverage:{status:'unavailable',reason:'unknown_history'},summary:{registrationFactsInWindow:rows?1:0}});
 }
});
it.each(['unknown','viewer','registration'])('retains permanent quota loss on %s rows even after old expiry and acknowledgement',async sourceKind=>{
 const old={...page,sourceKind,sourceFormId:sourceKind==='registration'?'form':null,issuedAt:new Date(0),expiresAt:new Date(500),lossAt:new Date(700)};
 const result=await reconcileMetricVisitSources(database([old],[{...intent,preparedAt:new Date(100)}],[{...fact,visitedAt:new Date(200)}]),scope);
 expect(result).toMatchObject({coverage:{reason:'evidence_gap'},summary:{versionLossMarkers:1,pendingRegistrationIntents:0}});
});
it('a loss exactly at the exclusive end does not invalidate the earlier window',async()=>{
 expect(await reconcileMetricVisitSources(database([{...page,sourceKind:'viewer',sourceFormId:null,lossAt:scope.endAt}]),scope))
  .toMatchObject({coverage:{reason:'unknown_history'},summary:{versionLossMarkers:0}});
});
it('distinguishes unacknowledged page and lost preparation without deleting either',async()=>{
 const noJs=await reconcileMetricVisitSources(database([page]),scope);
 expect(noJs).toMatchObject({coverage:{reason:'evidence_gap'},summary:{expiredUnacknowledgedRegistrationPages:1,pendingRegistrationIntents:0}});
 const lost=await reconcileMetricVisitSources(database([page],[intent]),scope);
 expect(lost).toMatchObject({coverage:{reason:'evidence_gap'},summary:{expiredUnacknowledgedRegistrationPages:0,pendingRegistrationIntents:1}});
});
it('does not erase a pending preparation using its shorter page expiry in a later report window',async()=>{
 const later={...scope,startAt:new Date(6000),endAt:new Date(8000)},state={...context,asOf:new Date(9000)};
 expect(await reconcileMetricVisitSources(database([page],[],[],state),later)).toMatchObject({coverage:{reason:'unknown_history'}});
 expect(await reconcileMetricVisitSources(database([page],[intent],[],state),later))
  .toMatchObject({coverage:{reason:'evidence_gap'},summary:{pendingRegistrationIntents:1}});
});
it('uses a later committed acknowledgement to close preparation but never moves its timestamp into the report',async()=>{
 expect(await reconcileMetricVisitSources(database([page],[intent],[{...fact,visitedAt:new Date(4500)}]),scope))
  .toMatchObject({coverage:{reason:'unknown_history'},summary:{pendingRegistrationIntents:0,registrationFactsInWindow:0}});
});
it('keeps orphan, unknown and viewer facts separate from proven registration facts',async()=>{
 for(const kind of ['orphan','unknown','viewer']){
  const result=await reconcileMetricVisitSources(database(kind==='orphan'?[]:[{...page,sourceKind:kind,sourceFormId:null}],[],[fact]),scope);
  expect(result).toMatchObject({coverage:{reason:'unknown_history'},summary:{registrationFactsInWindow:0,
   orphanFactsInWindow:kind==='orphan'?1:0,unknownFactsInWindow:kind==='unknown'?1:0,viewerFactsInWindow:kind==='viewer'?1:0}});
 }
});
it('rejects missing/mismatched preparation and impossible registration chronology as gaps',async()=>{
 for(const row of [null,{...intent,visitorId:'other'},{...intent,preparedAt:new Date(2500)}]){
  const result=await reconcileMetricVisitSources(database([page],row?[row]:[],[fact]),scope);
  expect(result).toMatchObject({coverage:{reason:'evidence_gap'},summary:{registrationFactsInWindow:0}});
 }
});
it('an impossible acknowledgement outside the window never closes an unresolved preparation',async()=>{
 for(const [preparedAt,visitedAt] of [[1500,500],[500,3500],[2500,2000]]){
  const result=await reconcileMetricVisitSources(database([page],[{...intent,preparedAt:new Date(preparedAt)}],[{...fact,visitedAt:new Date(visitedAt)}]),scope);
  expect(result).toMatchObject({coverage:{reason:'evidence_gap'},summary:{invalidRegistrationChronology:1,registrationFactsInWindow:0}});
 }
});
it('counts preparations on other sources without inferring registration coverage',async()=>{
 expect(await reconcileMetricVisitSources(database([{...page,sourceKind:'viewer',sourceFormId:null}],[intent],[fact]),scope))
  .toMatchObject({coverage:{reason:'unknown_history'},summary:{nonRegistrationIntents:1}});
});
it('preserves a stricter caller timeout and restores transaction settings on completion',async()=>{
 const tx=database();await reconcileMetricVisitSources(tx,scope);
 expect(tx.$queryRaw.mock.calls[2][0].values).toEqual(['1000ms']);
 expect(tx.$queryRaw.mock.calls.at(-1)![0].values).toEqual(['on','1s']);
});
it('distinguishes a window that has not ended from a missing version',async()=>{
 expect(await reconcileMetricVisitSources(database(),{...scope,endAt:new Date(6000)}))
  .toEqual({status:'unavailable',reason:'window_not_closed'});
});
it('does not call a window closed merely because wall clock advanced after the snapshot began',async()=>{
 expect(await reconcileMetricVisitSources(database([],[],[],{...context,asOf:new Date(2000),clockAt:new Date(5000)}),scope))
  .toEqual({status:'unavailable',reason:'window_not_closed'});
});
it('rejects duplicate fact identity under either UUID ordering and loss before page issuance',async()=>{
 const duplicate={...fact,id:'20000000-0000-4000-8000-000000000002',visitedAt:new Date(500)};
 for(const rows of [[fact,duplicate],[duplicate,fact]])await expect(reconcileMetricVisitSources(database([page],[intent],rows),scope)).rejects.toThrow('Visit fact keys');
 await expect(reconcileMetricVisitSources(database([{...page,lossAt:new Date(500)}]),scope)).rejects.toThrow('Invalid visit page source');
});
it('bounds every source set and discards oversized results instead of returning a prefix',async()=>{
 for(const table of ['pages','intents','facts']){
  const many=Array(MAX_VISIT_RECONCILIATION_ROWS+1).fill(table==='pages'?page:table==='intents'?intent:fact);
  expect(await reconcileMetricVisitSources(database(table==='pages'?many:[],table==='intents'?many:[],table==='facts'?many:[]),scope))
   .toEqual({status:'unavailable',reason:'limit_exceeded'});
 }
});
it('requires a primary RR snapshot and fails on inaccessible or malformed sources',async()=>{
 for(const state of [{...context,isolation:'read committed'},{...context,primary:false}]){
  await expect(reconcileMetricVisitSources(database([],[],[],state),scope)).rejects.toThrow('primary repeatable-read');
 }
 expect(await reconcileMetricVisitSources(database([],[],[],null),scope)).toEqual({status:'unavailable',reason:'lease_or_scope_unavailable'});
 const tx=database();tx.$queryRaw.mockReset().mockRejectedValue(new Error('synthetic RLS denied'));
 await expect(reconcileMetricVisitSources(tx,scope)).rejects.toThrow('synthetic RLS denied');
 await expect(reconcileMetricVisitSources(database([{...page,sourceFormId:null}]),scope)).rejects.toThrow('Invalid visit page source');
});
it('keeps source digest stable when only clock-based classification expires',async()=>{
 const pending=await reconcileMetricVisitSources(database([{...page,expiresAt:new Date(6000)}]),scope);
 const expired=await reconcileMetricVisitSources(database([{...page,expiresAt:new Date(6000)}],[],[],{...context,asOf:new Date(8000)}),scope);
 expect(pending.status).toBe('available');expect(expired.status).toBe('available');
 if(pending.status==='available'&&expired.status==='available'){
  expect(pending.sourceDigest).toBe(expired.sourceDigest);
  expect(pending.summary.unacknowledgedRegistrationPages).toBe(1);expect(expired.summary.expiredUnacknowledgedRegistrationPages).toBe(1);
 }
});
it('copies validated dates before awaiting and rejects invalid windows before DB access',async()=>{
 const request={...scope,startAt:new Date(1000),endAt:new Date(3000)},tx=database([page],[intent],[fact]);
 const pending=reconcileMetricVisitSources(tx,request);request.startAt.setTime(4000);request.endAt.setTime(0);
 expect(await pending).toMatchObject({summary:{registrationFactsInWindow:1}});
 const invalid=database();await expect(reconcileMetricVisitSources(invalid,request)).rejects.toThrow();expect(invalid.$queryRaw).not.toHaveBeenCalled();
});

const frameId='30000000-0000-4000-8000-000000000001';
const runId='40000000-0000-4000-8000-000000000001';
const run={id:runId,manifestHash:'a'.repeat(64),openedAt:new Date(0),stoppedAt:new Date(4000),sealedAt:new Date(4500),frameCount:1,pageCount:1,playbackCount:0};
const frame={id:frameId,routeKind:'form',admittedAt:new Date(1000),outcome:'responded',settledAt:new Date(1800),httpStatus:200};
const boundPage={...page,ingressFrameId:frameId};
it('a sealed matched run still never certifies the public request universe and exposes no raw source identifiers',async()=>{
 const tx=database([boundPage],[intent],[fact],context,[run],[frame]);
 const result=await reconcileMetricVisitSources(tx,scope);
 expect(result).toMatchObject({rowCount:4,coverage:{reason:'unknown_history'},sourceIngress:{state:'sealed',frames:1,missingSources:0,wrongKindSources:0,sealCountMismatch:false}});
 const output=JSON.stringify(result);
 for(const raw of [frameId,runId,eventId,run.manifestHash])expect(output).not.toContain(raw);
 // All source queries share the supplied transaction, bounded timeout and restoration.
 expect(tx.$queryRaw.mock.calls.at(-1)![0].values).toEqual(['on','1s']);
});
it('a successful page response without its durable source is a gap even when there are no visit facts',async()=>{
 expect(await reconcileMetricVisitSources(database([],[],[],context,[{...run,pageCount:0}],[frame]),scope))
  .toMatchObject({coverage:{reason:'evidence_gap'},sourceIngress:{missingSources:1}});
});
it.each(['pending','interrupted','failed'])('retains %s in-window requests as gaps',async kind=>{
 const row={...frame,outcome:kind==='failed'?'responded':kind,settledAt:kind==='pending'?null:frame.settledAt,httpStatus:kind==='failed'?503:null};
 const open={...run,sealedAt:null,frameCount:null,pageCount:null,playbackCount:null};
 expect(await reconcileMetricVisitSources(database([],[],[],context,[open],[row]),scope)).toMatchObject({coverage:{reason:'evidence_gap'}});
});
it('does not invent a report-window loss from an interrupted request entirely after the window',async()=>{
 const row={...frame,admittedAt:new Date(3500),settledAt:new Date(3600),outcome:'interrupted',httpStatus:null};
 expect(await reconcileMetricVisitSources(database([],[],[],context,[{...run,pageCount:0}],[row]),scope))
  .toMatchObject({coverage:{reason:'unknown_history'},sourceIngress:{interrupted:1}});
});
it('matches playback by frame identity, so an unbound extra intake cannot hide a missing source',async()=>{
 const second='30000000-0000-4000-8000-000000000002';
 const intake={id:'50000000-0000-4000-8000-000000000001',ingressFrameId:frameId,issuedAt:new Date(1500),lossAt:null};
 const rows=[{...frame,routeKind:'playback'},{...frame,id:second,routeKind:'playback'}];
 const extra={...intake,id:'50000000-0000-4000-8000-000000000002',ingressFrameId:null};
 expect(await reconcileMetricVisitSources(database([],[],[],context,[{...run,frameCount:2,pageCount:0,playbackCount:1}],rows,[intake,extra]),scope))
  .toMatchObject({rowCount:4,coverage:{reason:'unknown_history'},sourceIngress:{missingSources:1,unboundSources:1,sealCountMismatch:false}});
});
it('rejects wrong source kinds, duplicate consumption and foreign/orphan frame references',async()=>{
 for(const pages of [[{...boundPage,sourceKind:'viewer',sourceFormId:null}],
  [boundPage,{...boundPage,eventId:'10000000-0000-4000-8000-000000000002'}],
  [{...boundPage,ingressFrameId:'30000000-0000-4000-8000-000000000099'}]]){
  expect(await reconcileMetricVisitSources(database(pages,[],[],context,[{...run,pageCount:pages.length}],[frame]),scope))
   .toMatchObject({coverage:{reason:'evidence_gap'}});
 }
});
it('never selects one ambiguous run and never classifies a truncated frame or intake set',async()=>{
 await expect(reconcileMetricVisitSources(database([],[],[],context,[run,run]),scope)).rejects.toThrow('Ambiguous');
 for(const kind of ['frame','intake']){
  const many=Array(MAX_VISIT_RECONCILIATION_ROWS+1).fill(kind==='frame'?frame:{});
  expect(await reconcileMetricVisitSources(database([],[],[],context,[run],kind==='frame'?many:[],kind==='intake'?many:[]),scope))
   .toEqual({status:'unavailable',reason:'limit_exceeded'});
 }
});
it('detects seal count mismatch and rejects a seal earlier than frame settlement',async()=>{
 expect(await reconcileMetricVisitSources(database([boundPage],[intent],[fact],context,[{...run,frameCount:0}],[frame]),scope))
  .toMatchObject({coverage:{reason:'evidence_gap'},sourceIngress:{sealCountMismatch:true}});
 await expect(reconcileMetricVisitSources(database([],[],[],context,[run],[{...frame,settledAt:new Date(4600)}]),scope)).rejects.toThrow('Invalid metric ingress frame time');
});
it('fails closed on unknown routes, impossible source chronology and malformed seal counters',async()=>{
 await expect(reconcileMetricVisitSources(database([],[],[],context,[run],[{...frame,routeKind:'new_route'}]),scope)).rejects.toThrow();
 await expect(reconcileMetricVisitSources(database([{...boundPage,issuedAt:new Date(500)}],[],[],context,[run],[frame]),scope)).rejects.toThrow('Invalid metric ingress source time');
 await expect(reconcileMetricVisitSources(database([],[],[],context,[{...run,pageCount:null}],[frame]),scope)).rejects.toThrow('Invalid metric ingress frontier');
});
it('binds ingress identities and frontier into the versioned digest, even when summary counters match',async()=>{
 const first=await reconcileMetricVisitSources(database([boundPage],[intent],[fact],context,[run],[frame]),scope);
 for(const updated of [{...run,manifestHash:'b'.repeat(64)},{...run,sealedAt:new Date(4600)}]){
  const result=await reconcileMetricVisitSources(database([boundPage],[intent],[fact],context,[updated],[frame]),scope);
  expect(result.status).toBe('available');
  if(first.status==='available'&&result.status==='available')expect(result.sourceDigest).not.toBe(first.sourceDigest);
 }
});

it('retains frame-bound orphan pages as structural gaps even with no run',async()=>{
 expect(await reconcileMetricVisitSources(database([boundPage],[intent],[fact]),scope))
  .toMatchObject({coverage:{reason:'evidence_gap'},sourceIngress:{state:'no_run',orphanSources:1}});
});
it('detects an isolated orphan reference without a missing-source or seal-count gap',async()=>{
 const outside={...frame,admittedAt:new Date(3500),settledAt:new Date(3600),outcome:'interrupted',httpStatus:null};
 const orphan={...boundPage,ingressFrameId:'30000000-0000-4000-8000-000000000099'};
 expect(await reconcileMetricVisitSources(database([orphan],[intent],[fact],context,[{...run,pageCount:0}],[outside]),scope))
  .toMatchObject({coverage:{reason:'evidence_gap'},sourceIngress:{orphanSources:1,missingSources:0,sealCountMismatch:false}});
});
it('accounts for registration requests admitted before the report that can still lose an in-window source',async()=>{
 const open={...run,sealedAt:null,frameCount:null,pageCount:null,playbackCount:null};
 for(const row of [{...frame,admittedAt:new Date(500),outcome:'pending',settledAt:null,httpStatus:null},
  {...frame,admittedAt:new Date(500),outcome:'interrupted',settledAt:new Date(1500),httpStatus:null}]){
  expect(await reconcileMetricVisitSources(database([],[],[],context,[open],[row]),scope))
   .toMatchObject({coverage:{reason:'evidence_gap'}});
 }
 const ended={...frame,admittedAt:new Date(100),settledAt:new Date(500),outcome:'interrupted',httpStatus:null};
 expect(await reconcileMetricVisitSources(database([],[],[],context,[open],[ended]),scope))
  .toMatchObject({coverage:{reason:'unknown_history'}});
});
it.each(['viewer','playback'])('does not make %s transport failure a missing registration visit',async routeKind=>{
 const open={...run,sealedAt:null,frameCount:null,pageCount:null,playbackCount:null};
 const interrupted={...frame,routeKind,outcome:'interrupted',httpStatus:null};
 expect(await reconcileMetricVisitSources(database([],[],[],context,[open],[interrupted]),scope))
  .toMatchObject({coverage:{reason:'unknown_history'},sourceIngress:{interrupted:1}});
});
it('reports wrong-kind bindings as structural contradictions outside the report window',async()=>{
 const outside={...frame,admittedAt:new Date(3500),settledAt:new Date(3600)};
 const wrong={...boundPage,sourceKind:'viewer',sourceFormId:null,issuedAt:new Date(3500)};
 expect(await reconcileMetricVisitSources(database([wrong],[],[],context,[run],[outside]),scope))
  .toMatchObject({coverage:{reason:'evidence_gap'},sourceIngress:{wrongKindSources:1,sealCountMismatch:false,orphanSources:0,missingSources:0}});
});
