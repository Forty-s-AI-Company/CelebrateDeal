import { z } from "zod";

export const COMMUNITY_POST_MAX_LENGTH = 5_000;
export const COMMUNITY_COMMENT_MAX_LENGTH = 2_000;

const Scope = z.object({ vendorId: z.string().min(1).max(128), customerKeyHash: z.string().min(16).max(128) }).strict();
const Author = z.string().trim().min(1).max(60);

export type CommunityScope = z.infer<typeof Scope>;

export type CommunityDatabase = {
  commerceOrder: { count(args: unknown): Promise<number> };
  communityPost: {
    create(args: unknown): Promise<unknown>;
    findFirst(args: unknown): Promise<{ id: string } | null>;
    updateMany?(args: unknown): Promise<{ count: number }>;
  };
  communityComment: { create(args: unknown): Promise<unknown> };
  communityReaction: {
    findUnique(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
    delete(args: unknown): Promise<unknown>;
  };
};

/** Community is intentionally plain text: React escapes it and no HTML reaches storage. */
export function normalizeCommunityText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") throw new Error("Community content is required.");
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").trim();
  if (!normalized || normalized.length > maxLength) throw new Error("Community content length is invalid.");
  return normalized;
}

export async function moderateCommunityPost(
  db: Pick<CommunityDatabase, "communityPost">,
  input: { vendorId: string; postId: string; moderatorRole: string; isPinned: boolean; isAnnouncement: boolean },
) {
  if (!new Set(["owner", "admin"]).has(input.moderatorRole) || !db.communityPost.updateMany) throw new Error("Community moderator access is required.");
  const vendorId = z.string().min(1).max(128).parse(input.vendorId);
  const postId = z.string().min(1).max(128).parse(input.postId);
  const result = await db.communityPost.updateMany({ where: { id: postId, vendorId }, data: { isPinned: input.isPinned, isAnnouncement: input.isAnnouncement } });
  if (result.count !== 1) throw new Error("Community post is unavailable.");
  return { updated: true as const };
}

export async function requirePaidCommunityMember(db: Pick<CommunityDatabase, "commerceOrder">, rawScope: CommunityScope) {
  const scope = Scope.parse({ vendorId: rawScope.vendorId, customerKeyHash: rawScope.customerKeyHash });
  const count = await db.commerceOrder.count({ where: { vendorId: scope.vendorId, automationCustomerKeyHash: scope.customerKeyHash, status: { in: ["paid", "partially_refunded"] } } });
  if (count < 1) throw new Error("Paid student access is required.");
  return scope;
}

export async function createCommunityPost(db: CommunityDatabase, input: CommunityScope & { authorName: string; body: string }) {
  const scope = await requirePaidCommunityMember(db, input);
  return db.communityPost.create({ data: { ...scope, authorName: Author.parse(input.authorName), body: normalizeCommunityText(input.body, COMMUNITY_POST_MAX_LENGTH) } });
}

export async function createCommunityComment(db: CommunityDatabase, input: CommunityScope & { postId: string; authorName: string; body: string }) {
  const scope = await requirePaidCommunityMember(db, input);
  const postId = z.string().min(1).max(128).parse(input.postId);
  const post = await db.communityPost.findFirst({ where: { id: postId, vendorId: scope.vendorId }, select: { id: true } });
  if (!post) throw new Error("Community post is unavailable.");
  return db.communityComment.create({ data: { ...scope, postId, authorName: Author.parse(input.authorName), body: normalizeCommunityText(input.body, COMMUNITY_COMMENT_MAX_LENGTH) } });
}

export async function toggleCommunityLike(db: CommunityDatabase, input: CommunityScope & { postId: string }) {
  const scope = await requirePaidCommunityMember(db, input);
  const postId = z.string().min(1).max(128).parse(input.postId);
  const post = await db.communityPost.findFirst({ where: { id: postId, vendorId: scope.vendorId }, select: { id: true } });
  if (!post) throw new Error("Community post is unavailable.");
  const key = { vendorId_postId_customerKeyHash: { vendorId: scope.vendorId, postId, customerKeyHash: scope.customerKeyHash } };
  const existing = await db.communityReaction.findUnique({ where: key });
  if (existing) { await db.communityReaction.delete({ where: key }); return { liked: false }; }
  await db.communityReaction.create({ data: { ...scope, postId } });
  return { liked: true };
}
