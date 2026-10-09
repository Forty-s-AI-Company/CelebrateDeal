import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { automationCustomerKeyHash } from "@/lib/automation-workflow";
import { protectCommerceOrderPii } from "@/lib/commerce-order-pii";
import { grantCommerceEntitlement } from "@/lib/commerce-order-fulfillment";
import { reconcileCommerceOrderRefund } from "@/lib/commerce-orders";
import { saveCourseLesson } from "@/lib/course-curriculum";
import { CommunityConflict, getCourseCommunity, mutateCourseCommunity, moderateCourseCommunity } from "@/lib/course-community";
const db = getDb();
const vendors: string[] = [];
async function fixture() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic academy", slug: `course-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic course", slug: `course-${suffix}`, priceCents: 10000, commerceDomain: "course", fulfillmentType: "course", isActive: true } });
  const orderId = randomUUID();
  const email = "synthetic-learner@example.test";
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic student", email }, shipping: null }, { vendorId: vendor.id, orderId });
  const scope = { vendorId: vendor.id, customerKeyHash: automationCustomerKeyHash(vendor.id, email) };
  const order = await db.commerceOrder.create({ data: {
    id: orderId, vendorId: vendor.id, automationCustomerKeyHash: scope.customerKeyHash, orderNumber: orderId,
    checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 10000, totalAmountCents: 10000, paidAmountCents: 10000,
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked,
  } });
  const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId: product.id, lineIndex: 0, productName: product.name, productSlug: product.slug, commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 10000, quantity: 1, lineTotalCents: 10000, nonSensitiveSnapshot: {} } });
  const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id } });
  await db.$transaction((tx) => grantCommerceEntitlement(tx, { vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-course-fixture" } }));
  const draft = { productId: product.id, revision: product.revision, chapterTitle: "第一章", title: "第一單元", videoUrl: "https://media.example.test/course.mp4", durationSeconds: 100, published: true };
  const lessonId = await saveCourseLesson(db, vendor.id, draft);
  return { vendor, product, order, item, scope, lessonId, draft };
}
afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});


const postInput = () => ({ operation: "post", requestKey: randomUUID(), authorName: "Synthetic learner", body: "Synthetic discussion" });
describe("course community PostgreSQL boundaries", () => {
  it("joins only an entitled learner to the purchased course community", async () => {
    const f = await fixture(); const other = await fixture();
    expect(await getCourseCommunity(db, f.scope, f.product.id)).not.toBeNull();
    expect(await getCourseCommunity(db, {...f.scope, customerKeyHash: "another-learner"}, f.product.id)).toBeNull();
    expect(await getCourseCommunity(db, other.scope, f.product.id)).toBeNull();
    expect(await mutateCourseCommunity(db, other.scope, f.product.id, postInput())).toBeNull();
    expect(await db.courseCommunityPost.count()).toBe(0);
  });
  it("coalesces concurrent retries into one durable post", async () => {
    const f = await fixture(); const input = postInput();
    const results = await Promise.all(Array.from({length: 4}, () => mutateCourseCommunity(db, f.scope, f.product.id, input)));
    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
    expect(await db.courseCommunityPost.count({where: {vendorId: f.vendor.id}})).toBe(1);
    await expect(mutateCourseCommunity(db, f.scope, f.product.id, {...input, body: "Changed text"})).rejects.toBeInstanceOf(CommunityConflict);
  });
  it("enforces composite tenant/course parent keys below the service layer", async () => {
    const f = await fixture(); const other = await fixture();
    await mutateCourseCommunity(db, f.scope, f.product.id, postInput());
    const post = await db.courseCommunityPost.findFirstOrThrow({where: {vendorId: f.vendor.id}});
    await expect(db.courseCommunityReply.create({data: {vendorId: other.vendor.id, productId: other.product.id, postId: post.id, customerKeyHash: other.scope.customerKeyHash, authorName: "Synthetic learner", body: "Foreign reply"}})).rejects.toThrow();
    expect(await mutateCourseCommunity(db, other.scope, other.product.id, {...postInput(), operation: "reply", postId: post.id})).toBeNull();
    expect(await db.courseCommunityReply.count()).toBe(0);
  });
  it("sets concurrent likes idempotently and removes them idempotently", async () => {
    const f = await fixture(); await mutateCourseCommunity(db, f.scope, f.product.id, postInput());
    const post = await db.courseCommunityPost.findFirstOrThrow({where: {vendorId: f.vendor.id}});
    const like = {operation: "reaction", postId: post.id, liked: true};
    await Promise.all(Array.from({length: 4}, () => mutateCourseCommunity(db, f.scope, f.product.id, like)));
    expect(await db.courseCommunityReaction.count({where: {vendorId: f.vendor.id}})).toBe(1);
    await mutateCourseCommunity(db, f.scope, f.product.id, {...like, liked: false});
    await mutateCourseCommunity(db, f.scope, f.product.id, {...like, liked: false});
    expect(await db.courseCommunityReaction.count({where: {vendorId: f.vendor.id}})).toBe(0);
  });
  it("revokes every community read/mutation after a canonical full refund", async () => {
    const f = await fixture(); await mutateCourseCommunity(db, f.scope, f.product.id, postInput());
    await db.$transaction((tx) => reconcileCommerceOrderRefund(tx, {vendorId: f.vendor.id, orderId: f.order.id, providerName: "synthetic", eventIdentity: randomUUID(), amountCents: 10000, occurredAt: new Date()}));
    expect(await getCourseCommunity(db, f.scope, f.product.id)).toBeNull();
    expect(await mutateCourseCommunity(db, f.scope, f.product.id, postInput())).toBeNull();
    expect(await db.courseCommunityPost.count({where: {vendorId: f.vendor.id}})).toBe(1);
  });
  it("paginates without leaking hashes or accepting foreign cursors", async () => {
    const f = await fixture(); const other = await fixture();
    for (let index = 0; index < 22; index += 1) await mutateCourseCommunity(db, f.scope, f.product.id, postInput());
    const feed = await getCourseCommunity(db, f.scope, f.product.id);
    expect(feed?.posts).toHaveLength(20); expect(feed?.nextCursor).toBeTruthy();
    expect(JSON.stringify(feed)).not.toContain(f.scope.customerKeyHash);
    const next = await getCourseCommunity(db, f.scope, f.product.id, feed!.nextCursor!);
    expect(next?.posts).toHaveLength(2);
    expect(await getCourseCommunity(db, other.scope, other.product.id, feed!.nextCursor!)).toBeNull();
  });
  it("keeps all community tables behind RLS with no public policies", async () => {
    const tables = await db.$queryRaw<Array<{name: string; enabled: boolean; policies: bigint}>>`
      SELECT c.relname AS name, c.relrowsecurity AS enabled, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c WHERE c.oid IN ('"CourseCommunityPost"'::regclass, '"CourseCommunityReply"'::regclass, '"CourseCommunityReaction"'::regclass)`;
    expect(tables).toHaveLength(3); expect(tables.every((table) => table.enabled && table.policies === BigInt(0))).toBe(true);
  });
  it("restricts moderation to tenant managers and preserves pinned pagination and announcements", async () => {
    const f = await fixture(); const other = await fixture();
    for (let index = 0; index < 22; index += 1) await mutateCourseCommunity(db, f.scope, f.product.id, postInput());
    const oldest = await db.courseCommunityPost.findFirstOrThrow({where:{vendorId:f.vendor.id},orderBy:[{createdAt:"asc"},{id:"asc"}]});
    const input = {productId:f.product.id,postId:oldest.id,expectedRevision:0,isPinned:true,isAnnouncement:true,hidden:false};
    expect(await moderateCourseCommunity(db,{vendorId:f.vendor.id,role:"support"},input)).toBeNull();
    expect(await moderateCourseCommunity(db,{vendorId:other.vendor.id,role:"owner"},input)).toBeNull();
    expect(await moderateCourseCommunity(db,{vendorId:f.vendor.id,role:"admin"},input)).toEqual({updated:true});
    const first = await getCourseCommunity(db,f.scope,f.product.id);
    expect(first!.posts[0]).toMatchObject({id:oldest.id,isPinned:true,isAnnouncement:true});
    const next = await getCourseCommunity(db,f.scope,f.product.id,first!.nextCursor!);
    expect(new Set([...first!.posts,...next!.posts].map(post=>post.id)).size).toBe(22);
    await moderateCourseCommunity(db,{vendorId:f.vendor.id,role:"owner"},{...input,expectedRevision:1,hidden:true});
    expect((await getCourseCommunity(db,f.scope,f.product.id))!.posts.some(post=>post.id===oldest.id)).toBe(false);
    expect(await mutateCourseCommunity(db,f.scope,f.product.id,{operation:"reply",requestKey:randomUUID(),postId:oldest.id,authorName:"Learner",body:"Cannot bypass hidden"})).toBeNull();
  });

  it("rejects stale manager forms without undoing another manager's hide", async () => {
    const f = await fixture(); await mutateCourseCommunity(db,f.scope,f.product.id,postInput());
    const post = await db.courseCommunityPost.findFirstOrThrow({where:{vendorId:f.vendor.id}});
    const input = {productId:f.product.id,postId:post.id,expectedRevision:post.revision,isPinned:false,isAnnouncement:false,hidden:true};
    expect(await moderateCourseCommunity(db,{vendorId:f.vendor.id,role:"admin"},input)).toEqual({updated:true});
    expect(await moderateCourseCommunity(db,{vendorId:f.vendor.id,role:"owner"},{...input,hidden:false,isAnnouncement:true})).toBeNull();
    const saved = await db.courseCommunityPost.findFirstOrThrow({where:{vendorId:f.vendor.id,id:post.id}});
    expect(saved.hiddenAt).not.toBeNull(); expect(saved.revision).toBe(1); expect(saved.isAnnouncement).toBe(false);
  });

});
