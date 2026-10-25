import {randomUUID} from "node:crypto";
import {test,expect} from "@playwright/test";
import {PrismaClient} from "@prisma/client";
import {createMerchantRegistrationInvite} from "../../src/lib/merchant-registration-invite";
import {createMerchantEmailVerificationToken} from "../../src/lib/merchant-email-verification-token";
const db=new PrismaClient();
test.use({trace:"off",screenshot:"off",video:"off"});test.setTimeout(180_000);
test.afterAll(async()=>db.$disconnect());
for(const width of [1440,390])test(`registration and questionnaire round trip at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});const email=`onboarding-${randomUUID()}@example.test`;const password="  SyntheticBrowserPassword123!  ";
 try{
  // Closed beta (REGISTRATION_MODE unset = invite): the login entry leads to the invite-only notice, no form.
  await page.goto('/login');await page.getByRole('link',{name:'受邀商家註冊'}).click();await expect(page).toHaveURL(/\/register$/u);
  await expect(page.getByRole('heading',{name:'受邀商家註冊'})).toBeVisible();await expect(page.getByText('封測期間僅限受邀商家註冊。請使用平台寄給你的邀請連結。')).toBeVisible();await expect(page.locator('input[name="password"]')).toHaveCount(0);
  // The test process signs with the same synthetic CSRF_SECRET as the loopback server (playwright.config.ts).
  const {token}=createMerchantRegistrationInvite({email});
  await page.goto(`/register?invite=${encodeURIComponent(token)}`);
  await expect(page.locator('input[name="email"]')).toHaveValue(email);await expect(page.locator('input[name="email"]')).toHaveAttribute('readonly','');
  await page.locator('input[name="name"]').fill('Synthetic owner');await page.locator('input[name="workspaceName"]').fill('Synthetic browser workspace');await page.locator('input[name="password"]').fill(password);
  await expect(page.getByRole('heading',{name:'建立你的商家帳號'})).toBeVisible();
  // F-114: the native required checkbox blocks submission until consent is given.
  await page.locator('form').getByRole('button').click();await expect(page).toHaveURL(/\/register\?invite=/u);
  await expect(page.getByRole('link',{name:'使用條款'})).toHaveAttribute('href','/policies/terms');await expect(page.getByRole('link',{name:'隱私通知'})).toHaveAttribute('href','/policies/privacy');
  await page.getByRole('checkbox',{name:/我已閱讀並同意/u}).check();
  await page.locator('form').getByRole('button').click();await expect(page).toHaveURL(/\/welcome$/u);
  expect(await db.userPolicyConsent.count({where:{user:{email},context:'merchant_registration'}})).toBe(1);
  for(let step=0;step<4;step++){
   if(step===2)await page.getByRole('checkbox').first().click();else await page.getByRole('radio').first().click();
   const next=page.getByRole('button',{name:step===3?'產生我的工作空間':'下一題',exact:true});await expect(next).toBeEnabled();await next.click();
  }
  await expect(page).toHaveURL(/\/welcome\/preparing$/u);await page.getByRole('link',{name:'進入我的工作空間'}).click();await expect(page).toHaveURL(/\/dashboard$/u);
  // A new account is not locked out; the back office only asks for email verification.
  await expect(page.locator('[data-email-verification-banner]')).toBeVisible();expect((await db.user.findUniqueOrThrow({where:{email}})).emailVerifiedAt).toBeNull();
  // The e-mailed link opens a confirm page; only the POST behind its button verifies (the test process signs with the server's synthetic secret).
  const {token:verification}=createMerchantEmailVerificationToken({userId:(await db.user.findUniqueOrThrow({where:{email}})).id,email});
  await page.goto(`/verify-email?token=${encodeURIComponent(verification)}`);expect((await db.user.findUniqueOrThrow({where:{email}})).emailVerifiedAt).toBeNull();
  await page.getByRole('button',{name:'確認驗證 Email'}).click();await expect(page).toHaveURL(/\/verify-email\?status=verified$/u);await expect(page.getByRole('heading',{name:'Email 已完成驗證'})).toBeVisible();
  expect((await db.user.findUniqueOrThrow({where:{email}})).emailVerifiedAt).not.toBeNull();
  await page.getByRole('link',{name:'回到後台'}).click();await expect(page).toHaveURL(/\/dashboard$/u);await expect(page.locator('[data-email-verification-banner]')).toHaveCount(0);
  const user=await db.user.findUniqueOrThrow({where:{email}});const vendor=await db.vendor.findUniqueOrThrow({where:{email}});const preference=await db.userOnboardingPreference.findUniqueOrThrow({where:{userId_vendorId:{userId:user.id,vendorId:vendor.id}}});expect(preference.questionnaireDoneAt).not.toBeNull();expect(preference.selectedProjectId).not.toBeNull();expect(await db.salesProject.count({where:{vendorId:vendor.id}})).toBe(1);
  const account=page.getByRole('button',{name:'開啟工作區與帳號選單'});if(await account.isVisible())await account.click();await page.getByRole('button',{name:'登出',exact:true}).filter({visible:true}).click();await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('Email').fill(email);await page.getByLabel('密碼').fill(password);await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/u);
  await page.goto('/welcome');await expect(page).toHaveURL(/\/dashboard$/u);expect(await db.salesProject.count({where:{vendorId:vendor.id}})).toBe(1);
 }finally{const users=await db.user.findMany({where:{email},select:{id:true}});const vendors=await db.vendor.findMany({where:{email},select:{id:true}});await db.auditLog.deleteMany({where:{OR:[{actorId:{in:users.map(u=>u.id)}},{vendorId:{in:vendors.map(v=>v.id)}}]}});await db.vendor.deleteMany({where:{email}});await db.user.deleteMany({where:{email}});}
});
