import {beforeEach,expect,it,vi} from 'vitest';
import {issueMetricRegistrationPage} from './live-metric-registration-page';
const mocks=vi.hoisted(()=>({issue:vi.fn()}));
vi.mock('./live-metric-visit-page',()=>({issueMetricVisitPage:mocks.issue}));
const scope={formId:'form',liveId:'live'};
function database(){return {registrationForm:{findFirst:vi.fn().mockResolvedValue({vendorId:'vendor'})},$transaction:vi.fn()};}
beforeEach(()=>{vi.resetAllMocks();mocks.issue.mockResolvedValue({eventId:'server-event',versionId:'version'});});
it('derives vendor server-side and requires transactional exact form binding',async()=>{
 const db=database();expect(await issueMetricRegistrationPage(db as never,scope)).toEqual({eventId:'server-event',versionId:'version',vendorId:'vendor',liveId:'live'});
 expect(mocks.issue).toHaveBeenCalledWith(db,{vendorId:'vendor',liveId:'live'},{formId:'form'});
});
it('never mints a nonce for missing or mismatched/inactive form binding',async()=>{
 const db=database();db.registrationForm.findFirst.mockResolvedValueOnce(null);
 expect(await issueMetricRegistrationPage(db as never,scope)).toBeNull();expect(mocks.issue).not.toHaveBeenCalled();
 mocks.issue.mockResolvedValueOnce(null);expect(await issueMetricRegistrationPage(db as never,scope)).toBeNull();
});
it('rejects injected vendor and sanitizes unexpected lookup failures',async()=>{
 const db=database();expect(await issueMetricRegistrationPage(db as never,{...scope,vendorId:'foreign'} as never)).toBeNull();
 expect(db.registrationForm.findFirst).not.toHaveBeenCalled();db.registrationForm.findFirst.mockRejectedValueOnce(new Error('synthetic private DB detail'));
 await expect(issueMetricRegistrationPage(db as never,scope)).rejects.toMatchObject({code:'PERSISTENCE_UNAVAILABLE'});
});
