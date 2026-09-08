import { describe, expect, it, vi } from "vitest";
import { createCommunityComment, createCommunityPost, moderateCommunityPost, normalizeCommunityText, toggleCommunityLike } from "@/lib/community";

function database(orderCount = 1) {
  return {
    commerceOrder: { count: vi.fn().mockResolvedValue(orderCount) },
    communityPost: { create: vi.fn().mockResolvedValue({ id: "post-1" }), findFirst: vi.fn().mockResolvedValue({ id: "post-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    communityComment: { create: vi.fn().mockResolvedValue({ id: "comment-1" }) },
    communityReaction: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) },
  };
}
const scope = { vendorId: "vendor-1", customerKeyHash: "customer_hash_1234567890" };

describe("paid student community", () => {
  it("stores normalized plain text within the content limit", async () => {
    const db = database();
    await createCommunityPost(db, { ...scope, authorName: " 小明 ", body: "  <script>alert(1)</script> 學習心得  " });
    expect(db.communityPost.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: "vendor-1", authorName: "小明", body: "<script>alert(1)</script> 學習心得" }) });
    expect(normalizeCommunityText("hello\u0000world", 20)).toBe("helloworld");
    expect(() => normalizeCommunityText("x".repeat(5_001), 5_000)).toThrow();
  });

  it("fails closed for visitors without a tenant-qualified paid order", async () => {
    const db = database(0);
    await expect(createCommunityPost(db, { ...scope, authorName: "小明", body: "心得" })).rejects.toThrow("Paid student");
    expect(db.communityPost.create).not.toHaveBeenCalled();
  });

  it("requires the comment target to belong to the same tenant", async () => {
    const db = database(); db.communityPost.findFirst.mockResolvedValueOnce(null);
    await expect(createCommunityComment(db, { ...scope, postId: "other-post", authorName: "小明", body: "回覆" })).rejects.toThrow("unavailable");
    expect(db.communityPost.findFirst).toHaveBeenCalledWith({ where: { id: "other-post", vendorId: "vendor-1" }, select: { id: true } });
  });

  it("toggles one tenant-and-student scoped reaction", async () => {
    const db = database();
    await expect(toggleCommunityLike(db, { ...scope, postId: "post-1" })).resolves.toEqual({ liked: true });
    db.communityReaction.findUnique.mockResolvedValueOnce({ id: "reaction-1" });
    await expect(toggleCommunityLike(db, { ...scope, postId: "post-1" })).resolves.toEqual({ liked: false });
  });

  it("allows only tenant admins to pin or announce a post", async () => {
    const db = database();
    await expect(moderateCommunityPost(db, { vendorId: "vendor-1", postId: "post-1", moderatorRole: "admin", isPinned: true, isAnnouncement: true })).resolves.toEqual({ updated: true });
    await expect(moderateCommunityPost(db, { vendorId: "vendor-1", postId: "post-1", moderatorRole: "student", isPinned: true, isAnnouncement: false })).rejects.toThrow("moderator");
    expect(db.communityPost.updateMany).toHaveBeenCalledWith({ where: { id: "post-1", vendorId: "vendor-1" }, data: { isPinned: true, isAnnouncement: true } });
  });
});
