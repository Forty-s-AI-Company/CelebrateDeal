import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), member: vi.fn(), posts: vi.fn(), cursor: vi.fn() }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/community", () => ({ requirePaidCommunityMember: mocks.member }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ communityPost: { findMany: mocks.posts }, communityComment: { findFirst: mocks.cursor } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/app/actions/community-actions", () => ({ createCommunityCommentAction: vi.fn(), createCommunityPostAction: vi.fn(), toggleCommunityLikeAction: vi.fn() }));

import CommunityPage from "./page";

const comments = Array.from({ length: 101 }, (_, index) => ({ id: `comment-${String(index + 1).padStart(3, "0")}`, vendorId: "vendor-1", postId: "post-1", authorName: "Student", body: `message-${String(index + 1).padStart(3, "0")}`, createdAt: new Date("2026-09-09T00:00:00Z") }));
const render = async (query: Record<string, string | string[] | undefined> = {}) => renderToStaticMarkup(await CommunityPage({ params: Promise.resolve({ vendorSlug: "academy" }), searchParams: Promise.resolve(query) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ session: { vendorId: "vendor-1", customerKeyHash: "customer-1" }, vendor: { name: "Academy" } });
  mocks.member.mockResolvedValue({});
  mocks.cursor.mockImplementation(async ({ where }) => comments.find((comment) => comment.id === where.id && comment.postId === where.postId && comment.vendorId === where.vendorId) ?? null);
  mocks.posts.mockImplementation(async ({ where, include }) => {
    if (where.vendorId !== "vendor-1" || (where.id && where.id !== "post-1")) return [];
    const olderThan = include.comments.where.OR?.[1].id.lt;
    const matching = comments.filter((comment) => comment.vendorId === include.comments.where.vendorId && (!olderThan || comment.id < olderThan)).sort((a, b) => b.id.localeCompare(a.id));
    return [{ id: "post-1", authorName: "Teacher", body: "Welcome", isPinned: false, isAnnouncement: false, reactions: [], comments: matching.slice(0, include.comments.take), _count: { comments: matching.length } }];
  });
});

describe("community comment pagination", () => {
  it("shows the newest 100 of 101 comments and retrieves the remaining comment with its scoped cursor", async () => {
    const first = await render();
    expect(first).toContain("message-101");
    expect(first).toContain("message-002");
    expect(first).not.toContain("message-001");
    expect(first).toContain("post=post-1&amp;before=comment-002");
    expect(first.indexOf("message-002")).toBeLessThan(first.indexOf("message-101"));
    const older = await render({ post: "post-1", before: "comment-002" });
    expect(older).toContain("message-001");
    expect(older).not.toContain("message-002");
    expect(older).not.toContain("較舊留言");
    expect(older).toContain("返回最新留言");
    expect(mocks.session).toHaveBeenCalledWith("academy");
    expect(mocks.member).toHaveBeenCalledWith(expect.anything(), { vendorId: "vendor-1", customerKeyHash: "customer-1" });
    expect(mocks.cursor).toHaveBeenCalledWith({ where: { id: "comment-002", postId: "post-1", vendorId: "vendor-1" }, select: { id: true, createdAt: true } });
    expect(mocks.posts).toHaveBeenLastCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", id: "post-1" }, take: 50, include: expect.objectContaining({ comments: expect.objectContaining({ take: 100, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }) }) }));
  });

  it.each([{ before: "comment-002" }, { post: ["post-1", "post-2"] }, { post: "post-1", before: ["comment-002"] }, { post: "../other" }, { post: "" }, { post: "x".repeat(129) }])("rejects malformed pagination %j", async (query) => {
    await expect(render(query)).rejects.toThrow("NOT_FOUND");
    expect(mocks.cursor).not.toHaveBeenCalled();
    expect(mocks.posts).not.toHaveBeenCalled();
  });

  it("rejects cursors from another post or tenant before querying the feed", async () => {
    await expect(render({ post: "other-post", before: "comment-002" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.posts).not.toHaveBeenCalled();
    await expect(render({ post: "post-1", before: "other-tenant-comment" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.posts).not.toHaveBeenCalled();
  });

  it("does not query comments or posts for a nonmember", async () => {
    mocks.member.mockRejectedValue(new Error("not a member"));
    await expect(render({ post: "post-1", before: "comment-002" })).rejects.toThrow("NOT_FOUND");
    expect(mocks.cursor).not.toHaveBeenCalled();
    expect(mocks.posts).not.toHaveBeenCalled();
  });
});
