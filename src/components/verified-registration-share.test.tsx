import {beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({cookie:vi.fn(), claim:vi.fn(), find:vi.fn(), form:vi.fn()}));
vi.mock('next/headers', () => ({cookies:async () => ({get:mocks.cookie})}));
vi.mock('@/lib/db', () => ({getDb:() => ({formSubmission:{findFirst:mocks.find}})}));
vi.mock('@/lib/app-url', () => ({getCanonicalAppUrl:() => 'https://example.test'}));
vi.mock('@/lib/form-submission-chat-session', () => ({FORM_SUBMISSION_CHAT_SESSION_COOKIE:'synthetic-session', verifyFormSubmissionChatSessionToken:mocks.claim}));
vi.mock('@/lib/public-registration-form', () => ({getPublicRegistrationForm:mocks.form}));
import {VerifiedRegistrationShare} from './verified-registration-share';

describe('verified registration sharing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookie.mockReturnValue({value:'synthetic-token'});
    mocks.claim.mockReturnValue({submissionId:'submission-a'});
    mocks.find.mockResolvedValue({formId:'form-a',form:{slug:'event-a'}});
    mocks.form.mockResolvedValue({id:'form-a',slug:'event-a',headline:'活動',fields:[],sessions:[{id:'live-a'}]});
  });
  it('requires a signed session before reading participant records', async () => {
    mocks.cookie.mockReturnValue(undefined);
    expect(await VerifiedRegistrationShare()).toBeNull();
    expect(mocks.find).not.toHaveBeenCalled();
    mocks.cookie.mockReturnValue({value:'invalid'});
    mocks.claim.mockReturnValue(null);
    expect(await VerifiedRegistrationShare()).toBeNull();
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it('requires a verified database record and exact public form identity', async () => {
    mocks.find.mockResolvedValue(null);
    expect(await VerifiedRegistrationShare()).toBeNull();
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({where:{id:'submission-a',verificationStatus:'VERIFIED',verifiedAt:{not:null}}}));
    mocks.find.mockResolvedValue({formId:'form-a',form:{slug:'event-a'}});
    mocks.form.mockResolvedValue({id:'other-tenant-form',fields:[],sessions:[{}]});
    expect(await VerifiedRegistrationShare()).toBeNull();
  });
  it('hides withdrawn activities', async () => {
    mocks.form.mockResolvedValue(null);
    expect(await VerifiedRegistrationShare()).toBeNull();
    mocks.form.mockResolvedValue({id:'form-a',fields:[],sessions:[]});
    expect(await VerifiedRegistrationShare()).toBeNull();
  });
  it('offers a canonical activity invitation without participant identifiers', async () => {
    const result = await VerifiedRegistrationShare();
    expect(result).not.toBeNull();
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('https://example.test/form/event-a?utm_source=referral_card');
    expect(serialized).not.toContain('submission-a');
    expect(serialized).not.toContain('synthetic-token');
  });
});
