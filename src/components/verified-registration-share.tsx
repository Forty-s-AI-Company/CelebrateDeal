import {cookies} from 'next/headers';
import {getDb} from '@/lib/db';
import {getCanonicalAppUrl} from '@/lib/app-url';
import {getPublicRegistrationForm} from '@/lib/public-registration-form';
import {FORM_SUBMISSION_CHAT_SESSION_COOKIE, verifyFormSubmissionChatSessionToken} from '@/lib/form-submission-chat-session';
import {ReferralShareControls} from './referral-share-controls';

/** A query-string success message never grants access to a registrant's session. */
export async function VerifiedRegistrationShare() {
  const token = (await cookies()).get(FORM_SUBMISSION_CHAT_SESSION_COOKIE)?.value;
  if (!token) return null;
  const claim = verifyFormSubmissionChatSessionToken(token);
  if (!claim) return null;
  const submission = await getDb().formSubmission.findFirst({
    where:{id:claim.submissionId, verificationStatus:'VERIFIED', verifiedAt:{not:null}},
    select:{formId:true, form:{select:{slug:true}}},
  });
  if (!submission) return null;
  const form = await getPublicRegistrationForm(submission.form.slug);
  if (!form || form.id !== submission.formId || !form.fields || form.sessions.length === 0) return null;
  const url = new URL(`/form/${encodeURIComponent(form.slug)}`, getCanonicalAppUrl());
  // This is an activity invitation, not a grant of affiliate or purchase rights.
  url.searchParams.set('utm_source', 'referral_card');
  url.searchParams.set('utm_medium', 'share');
  url.searchParams.set('utm_campaign', 'live_registration');
  return <section aria-label="分享已報名活動" className="mt-5"><h2 className="mb-3 font-bold">邀請朋友參加活動</h2><ReferralShareControls title={form.headline} referralUrl={url.href}/></section>;
}
