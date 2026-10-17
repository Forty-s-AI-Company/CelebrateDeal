import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { hashPassword } from "../../src/lib/password";

const db=new PrismaClient();
test.afterAll(async()=>{await db.$disconnect();});
test("owner adds reusable LINE accounts and selects them independently for two courses",async({page},testInfo)=>{
  test.setTimeout(180000);
  const target=new URL(process.env.DATABASE_URL??"http://invalid");
  if(target.hostname!=="127.0.0.1"||target.pathname!=="/celebratedeal_test")throw new Error("Owned disposable PostgreSQL required");
  const suffix=randomUUID(),email=`line-${suffix}@example.test`,password="SyntheticPassword123!";
  const vendor=await db.vendor.create({data:{name:"Synthetic LINE courses",slug:`line-${suffix}`,email,passwordHash:hashPassword(password)}});
  const user=await db.user.create({data:{email,name:"Synthetic owner",passwordHash:hashPassword(password)}});
  await db.vendorMember.create({data:{vendorId:vendor.id,userId:user.id,role:"owner"}});
  const project=async(name:string)=>db.salesProject.create({data:{vendorId:vendor.id,name,slug:`${name}-${suffix}`,mode:"live_course",primaryFlow:"live"}});
  const one=await project("course-one"),two=await project("course-two");
  // No real LINE, delivery or external site is contacted by this browser test.
  await page.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
  await page.setExtraHTTPHeaders({"x-real-ip":"192.0.2.13","x-forwarded-for":"192.0.2.13","x-celebratedeal-live-chat-ingress":"wp17-owned-loopback-ingress-proof-20261016"});
  await page.goto("/login");await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("密碼",{exact:true}).fill(password);await page.getByRole("button",{name:"登入",exact:true}).click();await expect(page).toHaveURL(/\/dashboard/u);
  for(const [name,channel] of [["共用學員服務","200000001"],["獨立課程服務","200000002"]]){
    await page.goto("/settings/line?accountId=new");
    await page.getByLabel("帳號名稱",{exact:true}).fill(name!);
    await page.getByLabel("Messaging Channel ID",{exact:true}).fill(channel!);
    await page.getByLabel("Messaging Channel Secret",{exact:true}).fill("synthetic-channel-secret-not-a-real-secret");
    await page.getByLabel("Messaging Access Token",{exact:true}).fill("synthetic-access-value-with-no-real-provider-access");
    await page.getByRole("button",{name:"綁定 LINE",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"LINE"})).toContainText("LINE 綁定已安全儲存");
  }
  const accounts=await db.lineOfficialAccount.findMany({where:{vendorId:vendor.id},select:{id:true,displayName:true}});
  const shared=accounts.find(account=>account.displayName==="共用學員服務")!,independent=accounts.find(account=>account.displayName==="獨立課程服務")!;
  expect(accounts).toHaveLength(2);
  for(const course of [one,two]){
    await page.goto(`/projects/${course.id}`);await page.getByLabel("官方帳號",{exact:true}).selectOption(shared.id);await page.getByRole("button",{name:"儲存選擇",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"LINE"})).toContainText("LINE 帳號選擇已儲存");
  }
  expect(await db.salesProject.count({where:{vendorId:vendor.id,lineOfficialAccountId:shared.id}})).toBe(2);
  await page.goto(`/projects/${two.id}`);
  await page.getByLabel("官方帳號",{exact:true}).selectOption(independent.id);await page.getByRole("button",{name:"儲存選擇",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"LINE"})).toContainText("LINE 帳號選擇已儲存");
  expect((await db.salesProject.findUniqueOrThrow({where:{id:one.id}})).lineOfficialAccountId).toBe(shared.id);
  expect((await db.salesProject.findUniqueOrThrow({where:{id:two.id}})).lineOfficialAccountId).toBe(independent.id);
  await page.screenshot({path:testInfo.outputPath("project-line-account.png"),fullPage:true});
  await page.goto(`/settings/line?accountId=${shared.id}`);
  await expect(page.locator('select[name="accountId"]')).toHaveValue(shared.id);
  await expect(page.getByRole("link",{name:"登入 LINE 官方帳號後台"})).toHaveAttribute("href","https://manager.line.biz/");
  await expect(page.getByLabel("Messaging Access Token",{exact:true})).toHaveValue("");
  await expect(page.locator("code")).toContainText(`/api/webhooks/line/${vendor.id}/${shared.id}`);
  await page.screenshot({path:testInfo.outputPath("line-account-management.png"),fullPage:true});
  expect(await db.lineDelivery.count({where:{vendorId:vendor.id}})).toBe(0);
});
