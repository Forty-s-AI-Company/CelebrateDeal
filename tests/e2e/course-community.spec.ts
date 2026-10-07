import { hashPassword } from "../../src/lib/password";
import { saveCourseLesson } from "../../src/lib/course-curriculum";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { automationCustomerKeyHash } from "../../src/lib/automation-workflow";
import { protectCommerceOrderPii } from "../../src/lib/commerce-order-pii";
import { grantCommerceEntitlement } from "../../src/lib/commerce-order-fulfillment";
import { reconcileCommerceOrderRefund } from "../../src/lib/commerce-orders";
import { createStudentPortalAccessToken } from "../../src/lib/student-portal-auth";

test.use({trace: "off", screenshot: "off", video: "off"});
test.setTimeout(120000);
test("purchased learner posts, replies, likes and reloads a course-isolated community; refunds revoke access", async ({page, browser, baseURL}) => {
  const db = new PrismaClient(); const suffix = randomUUID();
  const vendor = await db.vendor.create({data: {name: "合成社群學院", slug: `community-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only"}});
  const manager = await db.user.create({data:{email:`manager-${suffix}@example.test`,name:"合成管理員",passwordHash:hashPassword("SyntheticCommunityManager!"),status:"active",memberships:{create:{vendorId:vendor.id,role:"admin",status:"active"}}}});
  const foreign = await db.vendor.create({data: {name: "合成其他學院", slug: `other-community-${suffix}`, email: `other-${suffix}@example.test`, passwordHash: "synthetic-only"}});
  const product = await db.product.create({data: {vendorId: vendor.id, name: "社群測試課程", slug: randomUUID(), priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true}});
  await saveCourseLesson(db, vendor.id, { productId: product.id, revision: product.revision, chapterTitle: "第一章", title: "第一單元", videoUrl: "https://media.example.test/course.mp4", durationSeconds: 100, published: true });
  const orderId = randomUUID(); const email = `learner-${suffix}@example.test`;
  const pii = protectCommerceOrderPii({ buyer: { name: "合成學員", email }, shipping: null }, { vendorId: vendor.id, orderId });
  await db.commerceOrder.create({ data: { id: orderId, vendorId: vendor.id, orderNumber: orderId, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash, automationCustomerKeyHash: automationCustomerKeyHash(vendor.id, email), status: "paid", subtotalAmountCents: 10000, totalAmountCents: 10000, paidAmountCents: 10000, buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked } });
  const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId: product.id, lineIndex: 0, productName: product.name, productSlug: product.slug, commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 10000, quantity: 1, lineTotalCents: 10000, nonSensitiveSnapshot: {} } });
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id } });
  await db.$transaction((tx) => grantCommerceEntitlement(tx, { vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-browser-fixture" } }));

  try {
    await page.context().route((url) => url.origin !== new URL(baseURL!).origin, (route) => route.abort());
    const token = await createStudentPortalAccessToken(db, {vendorId: vendor.id, email, purpose: "magic_link"});
    await page.goto(`${baseURL}/portal/${vendor.slug}/access?token=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(new RegExp(`/portal/${vendor.slug}$`));
    await page.getByRole("link", {name: "開始課程學習"}).click();
    await page.getByRole("link", {name: "學員討論", exact: true}).click();
    await expect(page.getByRole("heading", {name: "發布心得", exact: true})).toBeVisible();
    const endpoint = `/portal/${vendor.slug}/learn/${product.id}/community/data`;
    const rejected = await page.evaluate(async (url) => (await fetch(url, {method: "POST", headers: {"content-type":"application/json", "x-celebratedeal-client":"web", "x-csrf-token":"invalid"}, body: JSON.stringify({operation:"post", requestKey:crypto.randomUUID(), authorName:"學員", body:"Rejected"})})).status, endpoint);
    expect(rejected).toBe(403);
    expect(await db.courseCommunityPost.count({where:{vendorId:vendor.id}})).toBe(0);
    const post = page.getByRole("form", {name:"發布心得", exact:true});
    await post.getByLabel("顯示名稱").fill("合成學員");
    await post.getByLabel("分享學習心得").fill("<b>課程心得</b>");
    await post.getByRole("button", {name:"發布心得", exact:true}).click();
    await expect(page.getByRole("status")).toHaveText("已儲存。");
    await expect(page.getByText("<b>課程心得</b>", {exact:true})).toBeVisible();
    expect(await page.locator("article b").count()).toBe(0);
    await page.getByRole("button", {name:"讚（0）", exact:true}).click();
    await expect(page.getByRole("button", {name:"取消讚（1）", exact:true})).toBeVisible();
    await page.getByRole("button", {name:"查看討論（0）", exact:true}).click();
    const reply = page.getByRole("form", {name:"回覆討論", exact:true});
    await reply.getByLabel("顯示名稱").fill("合成回覆者");
    await reply.getByLabel("回覆內容").fill("一起練習下一課");
    await reply.getByRole("button", {name:"送出回覆", exact:true}).click();
    await expect.poll(() => db.courseCommunityReply.count({where:{vendorId:vendor.id}})).toBe(1);
    const savedPost = await db.courseCommunityPost.findFirstOrThrow({where:{vendorId:vendor.id}});
    // An actual manager session edits the same learner-visible post.
    const managerContext = await browser.newContext(); const managerPage = await managerContext.newPage();
    try {
      await managerContext.route((url) => url.origin !== new URL(baseURL!).origin, route => route.abort());
      await managerPage.goto(`${baseURL}/login`);
      await managerPage.getByLabel("Email").fill(manager.email);
      await managerPage.getByLabel("密碼").fill("SyntheticCommunityManager!");
      await managerPage.getByRole("button",{name:"登入",exact:true}).click();
      await expect(managerPage).toHaveURL(/\/dashboard$/);
      await managerPage.goto(`${baseURL}/products/${product.id}/lessons`);
      await managerPage.getByRole("link",{name:"學員討論管理",exact:true}).click();
      await managerPage.getByLabel("置頂",{exact:true}).check();
      await managerPage.getByLabel("公告",{exact:true}).check();
      await managerPage.getByRole("button",{name:"儲存討論設定",exact:true}).click();
      await expect(managerPage.getByRole("status")).toHaveText("討論設定已儲存。");
      expect(await db.courseCommunityPost.findUniqueOrThrow({where:{vendorId_productId_id:{vendorId:vendor.id,productId:product.id,id:savedPost.id}}})).toMatchObject({isPinned:true,isAnnouncement:true});
      await managerPage.goto(`${baseURL}/products/${randomUUID()}/community`);
      await expect(managerPage.getByText("討論設定已儲存。",{exact:true})).toHaveCount(0);
    } finally { await managerContext.close(); }
    await page.reload();
    await expect(page.getByRole("heading",{name:"合成學員 · 公告 · 置頂",exact:true})).toBeVisible();
    await expect(page.getByText("一起練習下一課", {exact:false})).toBeVisible();
    await expect(page.getByRole("button", {name:"取消讚（1）", exact:true})).toBeVisible();
    // Keep an expanded long thread after a new reply is acknowledged.
    await db.courseCommunityReply.createMany({data:Array.from({length:21},(_,index)=>({vendorId:vendor.id,productId:product.id,postId:savedPost.id,customerKeyHash:automationCustomerKeyHash(vendor.id,email),authorName:"合成分頁者",body:`分頁回覆 ${index}`,createdAt:new Date(Date.now()+index)}))});
    await page.reload();
    await page.getByRole("button",{name:"查看討論（22）",exact:true}).click();
    const full = page.getByRole("region",{name:"完整討論",exact:true});
    await full.getByRole("button",{name:"載入更多回覆",exact:true}).click();
    await expect(full.locator("article")).toHaveCount(22);
    const longReply = full.getByRole("form",{name:"回覆討論",exact:true});
    await longReply.getByLabel("顯示名稱").fill("合成新回覆");
    await longReply.getByLabel("回覆內容").fill("展開之後的新回覆");
    await longReply.getByRole("button",{name:"送出回覆",exact:true}).click();
    await expect(full.locator("article")).toHaveCount(23);
    await expect(full.getByText("展開之後的新回覆",{exact:true})).toBeVisible();
    await page.goto(`/portal/${foreign.slug}/learn/${product.id}/community`);
    await expect(page).toHaveURL(new RegExp(`/portal/${foreign.slug}/login`));
    await db.$transaction((tx) => reconcileCommerceOrderRefund(tx, {vendorId:vendor.id, orderId, providerName:"synthetic", eventIdentity:randomUUID(), amountCents:10000, occurredAt:new Date()}));
    await page.goto(`/portal/${vendor.slug}/learn/${product.id}/community`);
    await expect(page.getByRole("heading", {name:"發布心得", exact:true})).toHaveCount(0);
    expect(await db.courseCommunityPost.count({where:{vendorId:vendor.id}})).toBe(1);
  } finally {
    await db.vendor.deleteMany({where:{id:{in:[vendor.id,foreign.id]}}}); await db.user.delete({where:{id:manager.id}}); await db.$disconnect();
  }
});
