import {randomUUID} from "node:crypto";
import {test,expect} from "@playwright/test";
import {PrismaClient} from "@prisma/client";
const db=new PrismaClient();
test.use({trace:"off",screenshot:"off",video:"off"});test.setTimeout(180_000);
test.afterAll(async()=>db.$disconnect());
for(const width of [1440,390])test(`registration and questionnaire round trip at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});const email=`onboarding-${randomUUID()}@example.test`;const password="  SyntheticBrowserPassword123!  ";
 try{
  await page.goto('/login');await page.getByRole('link',{name:'建立商家 Workspace'}).click();await expect(page).toHaveURL(/\/register$/u);
  await page.locator('input[name="name"]').fill('Synthetic owner');await page.locator('input[name="workspaceName"]').fill('Synthetic browser workspace');await page.locator('input[name="email"]').fill(email);await page.locator('input[name="password"]').fill(password);
  await page.locator('form').getByRole('button').click();await expect(page).toHaveURL(/\/welcome$/u);
  for(let step=0;step<4;step++){
   if(step===2)await page.getByRole('checkbox').first().click();else await page.getByRole('radio').first().click();
   const next=page.getByRole('button',{name:step===3?'產生我的工作空間':'下一題',exact:true});await expect(next).toBeEnabled();await next.click();
  }
  await expect(page).toHaveURL(/\/welcome\/preparing$/u);await page.getByRole('link',{name:'進入我的工作空間'}).click();await expect(page).toHaveURL(/\/dashboard$/u);
  const user=await db.user.findUniqueOrThrow({where:{email}});const vendor=await db.vendor.findUniqueOrThrow({where:{email}});const preference=await db.userOnboardingPreference.findUniqueOrThrow({where:{userId_vendorId:{userId:user.id,vendorId:vendor.id}}});expect(preference.questionnaireDoneAt).not.toBeNull();expect(preference.selectedProjectId).not.toBeNull();expect(await db.salesProject.count({where:{vendorId:vendor.id}})).toBe(1);
  const account=page.getByRole('button',{name:'開啟工作區與帳號選單'});if(await account.isVisible())await account.click();await page.getByRole('button',{name:'登出',exact:true}).filter({visible:true}).click();await expect(page).toHaveURL(/\/login$/u);
  await page.getByLabel('Email').fill(email);await page.getByLabel('密碼').fill(password);await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page).toHaveURL(/\/dashboard$/u);
  await page.goto('/welcome');await expect(page).toHaveURL(/\/dashboard$/u);expect(await db.salesProject.count({where:{vendorId:vendor.id}})).toBe(1);
 }finally{const users=await db.user.findMany({where:{email},select:{id:true}});const vendors=await db.vendor.findMany({where:{email},select:{id:true}});await db.auditLog.deleteMany({where:{OR:[{actorId:{in:users.map(u=>u.id)}},{vendorId:{in:vendors.map(v=>v.id)}}]}});await db.vendor.deleteMany({where:{email}});await db.user.deleteMany({where:{email}});}
});
