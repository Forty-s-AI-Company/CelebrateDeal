import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CommunityConflict, CommunityMutation, getCourseCommunity, getCourseCommunityReplies, mutateCourseCommunity } from "./course-community";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/student-course-learning", () => ({ authorizedCourseAccess: access }));
const scope = { vendorId: "vendor_a", customerKeyHash: "synthetic-learner-hash" };
const input = () => ({ operation: "post" as const, requestKey: randomUUID(), authorName: "學員", body: "學習心得" });
function fixture() {
  const tx = {
    courseCommunityPost: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockImplementation(async ({ create }) => ({ ...create, hiddenAt: null })) },
    courseCommunityReply: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockImplementation(async ({ create }) => ({ ...create, hiddenAt: null })) },
    courseCommunityReaction: { upsert: vi.fn(), deleteMany: vi.fn() },
  };
  const transaction = vi.fn(async (callback: (value: unknown) => unknown, options: unknown) => { expect(options).toEqual({ isolationLevel: "Serializable" }); return callback(tx); });
  return { tx, transaction, db: { $transaction: transaction } as unknown as Pick<PrismaClient, "$transaction"> };
}
beforeEach(() => access.mockReset().mockResolvedValue({ course: { id: "course_a", name: "合成課程" } }));

describe("course-qualified community", () => {
  it("normalizes bounded plain text and rejects caller identities/invalid operations", () => {
    const parsed = CommunityMutation.parse({ ...input(), body: "　心得\u0000　" });
    expect(parsed.operation).toBe("post");
    if (parsed.operation === "post") expect(parsed.body).toBe("心得");
    expect(CommunityMutation.safeParse({ ...input(), vendorId: "foreign" }).success).toBe(false);
    expect(CommunityMutation.safeParse({ ...input(), body: "x".repeat(5001) }).success).toBe(false);
    expect(CommunityMutation.safeParse({ operation: "reaction", postId: "../foreign", liked: true }).success).toBe(false);
  });
  it("denies reads and mutations when purchase rights are revoked", async () => {
    const { db, tx } = fixture(); access.mockResolvedValue(null);
    expect(await getCourseCommunity(db, scope, "course_a")).toBeNull();
    expect(await mutateCourseCommunity(db, scope, "course_a", input())).toBeNull();
    expect(tx.courseCommunityPost.upsert).not.toHaveBeenCalled();
    expect(tx.courseCommunityPost.findMany).not.toHaveBeenCalled();
  });
  it("scopes every post to authenticated tenant/course/learner and keeps retry identity stable", async () => {
    const { db, tx, transaction } = fixture(); const content = input();
    const first = await mutateCourseCommunity(db, scope, "course_a", content);
    expect(await mutateCourseCommunity(db, scope, "course_a", content)).toEqual(first);
    const data = tx.courseCommunityPost.upsert.mock.calls[0][0].create;
    expect(data).toMatchObject({ vendorId: scope.vendorId, productId: "course_a", customerKeyHash: scope.customerKeyHash });
    expect(transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });
  it("does not allow a retry key to overwrite previous text", async () => {
    const { db, tx } = fixture(); tx.courseCommunityPost.upsert.mockResolvedValue({ id: "post", body: "先前內容", authorName: "學員", hiddenAt: null });
    await expect(mutateCourseCommunity(db, scope, "course_a", input())).rejects.toBeInstanceOf(CommunityConflict);
  });
  it("rejects foreign/hidden posts before inserting a reply or reaction", async () => {
    const { db, tx } = fixture(); tx.courseCommunityPost.findFirst.mockResolvedValue(null);
    expect(await mutateCourseCommunity(db, scope, "course_a", { ...input(), operation: "reply", postId: "foreign_post" })).toBeNull();
    expect(tx.courseCommunityPost.findFirst).toHaveBeenCalledWith({ where: { vendorId: scope.vendorId, productId: "course_a", id: "foreign_post", hiddenAt: null }, select: { id: true } });
    expect(tx.courseCommunityReply.upsert).not.toHaveBeenCalled();
    expect(await mutateCourseCommunity(db, scope, "course_a", { operation: "reaction", postId: "foreign_post", liked: true })).toBeNull();
    expect(tx.courseCommunityReaction.upsert).not.toHaveBeenCalled();
  });
  it("sets reactions idempotently instead of toggling them on retries", async () => {
    const { db, tx } = fixture(); tx.courseCommunityPost.findFirst.mockResolvedValue({ id: "post" });
    const like = { operation: "reaction", postId: "post", liked: true };
    expect(await mutateCourseCommunity(db, scope, "course_a", like)).toEqual({ liked: true });
    expect(await mutateCourseCommunity(db, scope, "course_a", like)).toEqual({ liked: true });
    expect(tx.courseCommunityReaction.deleteMany).not.toHaveBeenCalled();
    expect(await mutateCourseCommunity(db, scope, "course_a", { ...like, liked: false })).toEqual({ liked: false });
    expect(tx.courseCommunityReaction.deleteMany).toHaveBeenCalledWith({ where: { vendorId: scope.vendorId, productId: "course_a", postId: "post", customerKeyHash: scope.customerKeyHash } });
  });
  it("never accepts a cursor from another course or hidden post", async () => {
    const { db, tx } = fixture(); tx.courseCommunityPost.findFirst.mockResolvedValue(null);
    expect(await getCourseCommunity(db, scope, "course_a", "foreign_cursor")).toBeNull();
    expect(tx.courseCommunityPost.findMany).not.toHaveBeenCalled();
    expect(await getCourseCommunityReplies(db, scope, "course_a", "foreign_post")).toBeNull();
    expect(tx.courseCommunityReply.findMany).not.toHaveBeenCalled();
  });
  it("caps the feed and exposes no learner hash in selected results", async () => {
    const { db, tx } = fixture();
    await getCourseCommunity(db, scope, "course_a");
    const query = tx.courseCommunityPost.findMany.mock.calls[0][0];
    expect(query.take).toBe(21);
    expect(query.select).not.toHaveProperty("customerKeyHash");
    expect(query.select.replies.take).toBe(5);
    expect(query.select.replies.select).not.toHaveProperty("customerKeyHash");
  });
});
