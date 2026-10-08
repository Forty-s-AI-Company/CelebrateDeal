import {randomUUID} from 'node:crypto';
import {expect, test} from '@playwright/test';
import {assertReferralCardDownload} from './referral-card-assertions';
import {PrismaClient} from '@prisma/client';
import {loadPublicRegistrationForm} from '../../src/lib/public-registration-form';
import {verifyFormSubmissionChatSessionToken} from '../../src/lib/form-submission-chat-session';
import {generateReferralShareCard} from '../../src/lib/referral-share-card';
import {FORM_SUBMISSION_CHAT_SESSION_COOKIE,createFormSubmissionChatSessionToken} from '../../src/lib/form-submission-chat-session';
import {createFormSubmissionVerificationToken} from '../../src/lib/form-submission-verification';

test.use({trace:'off', screenshot:'off', video:'off'});
test.setTimeout(120000);
test('verified registration grants private sharing; query spoof and withdrawn form do not', async ({page, baseURL}) => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  try {
    const vendor = await db.vendor.create({data:{name:'合成活動商家',slug:`share-${suffix}`,email:`vendor-${suffix}@example.test`,passwordHash:'synthetic-only'}});
    const form = await db.registrationForm.create({data:{vendorId:vendor.id,name:'合成分享活動',slug:`share-form-${suffix}`,headline:'合成分享活動',fields:[{key:'name',label:'姓名',type:'text',required:true},{key:'email',label:'Email',type:'email',required:true}]}});
    await db.live.create({data:{vendorId:vendor.id,formId:form.id,title:'合成分享場次',slug:`share-live-${suffix}`,status:'scheduled',scheduledAt:new Date('2030-01-01')}});
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const submission = await db.formSubmission.create({data:{formId:form.id,name:'合成學員',email:`learner-${suffix}@example.test`,verificationExpiresAt:expiresAt}});
    await page.goto('/verify-registration?status=verified');
    await expect(page.getByRole('region',{name:'分享已報名活動'})).toHaveCount(0);
    await page.context().addCookies([{name:FORM_SUBMISSION_CHAT_SESSION_COOKIE,value:'invalid',url:baseURL!}]);
    await page.reload();
    await expect(page.getByRole('region',{name:'分享已報名活動'})).toHaveCount(0);
    await page.context().addCookies([{name:FORM_SUBMISSION_CHAT_SESSION_COOKIE,value:createFormSubmissionChatSessionToken({submissionId:submission.id}),url:baseURL!}]);
    await page.reload();
    await expect(page.getByRole('region',{name:'分享已報名活動'})).toHaveCount(0);
    await page.context().clearCookies();
    const token = createFormSubmissionVerificationToken({submissionId:submission.id,expiresAt,version:submission.verificationVersion});
    // Exercise the actual same-origin POST that issues the signed session.
    await page.goto(`/verify-registration?token=${encodeURIComponent(token)}`);
    await page.getByRole('button',{name:'確認 Email 並完成報名',exact:true}).click();
    await expect(page).toHaveURL(/\/verify-registration\?status=verified$/u);
    expect(new URL(page.url()).origin).toBe(baseURL);
    const verifiedRecord=await db.formSubmission.findUniqueOrThrow({where:{id:submission.id}});
    expect(verifiedRecord.verificationStatus==='VERIFIED' && verifiedRecord.verifiedAt!==null).toBe(true);
    const sessionCookie=(await page.context().cookies()).find(cookie=>cookie.name===FORM_SUBMISSION_CHAT_SESSION_COOKIE);
    expect(Boolean(sessionCookie)).toBe(true);
    expect(Boolean(sessionCookie && verifyFormSubmissionChatSessionToken(sessionCookie.value)?.submissionId===submission.id)).toBe(true);
    const publicForm=await loadPublicRegistrationForm(form.slug);
    expect(Boolean(publicForm && publicForm.id===form.id && publicForm.fields && publicForm.sessions.length)).toBe(true);
    for(const title of ['界'.repeat(40),'W'.repeat(40),'活動W🎉'.repeat(10)]) {
      const svg=await generateReferralShareCard(title,`${baseURL}/form/${form.slug}`);
      const bounds=await page.evaluate(markup=>{
        const host=document.createElement('div');host.innerHTML=markup;document.body.append(host);
        const boxes=Array.from(host.querySelectorAll('tspan')).map(node=>{const b=node.getBBox();return {left:b.x,right:b.x+b.width};});host.remove();return boxes;
      },svg);
      expect(bounds.length).toBeGreaterThan(0);
      for(const box of bounds){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(1080);}
    }
    const region = page.getByRole('region',{name:'分享已報名活動'});
    await expect(region).toBeVisible();
    await expect(region.getByLabel('合成分享活動推廣連結')).toHaveValue(`${baseURL}/form/${form.slug}?utm_source=referral_card&utm_medium=share&utm_campaign=live_registration`);
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    const shareUrl=`${baseURL}/form/${form.slug}?utm_source=referral_card&utm_medium=share&utm_campaign=live_registration`;
    await region.getByRole('button',{name:'複製推廣連結',exact:true}).click();
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(shareUrl);
    const card=await assertReferralCardDownload(page,shareUrl,[submission.id,submission.email]);
    await page.goto(card.destination);
    await expect(page.getByRole('heading',{name:'合成分享活動',exact:true})).toBeVisible();
    await page.goto('/verify-registration?status=verified');
    const record = await db.formSubmission.findUniqueOrThrow({where:{id:submission.id}});
    expect(record.verificationStatus).toBe('VERIFIED');
    expect(record.verifiedAt).not.toBeNull();
    await db.registrationForm.update({where:{id:form.id},data:{isActive:false}});
    await page.reload();
    await expect(page.getByRole('region',{name:'分享已報名活動'})).toHaveCount(0);
  } finally {
    await db.$disconnect();
  }
  // Synthetic fixtures remain only until this runner drops its disposable DB.
});
