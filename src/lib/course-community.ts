import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorizedCourseAccess } from "@/lib/student-course-learning";
import type { StudentPortalScope } from "@/lib/student-portal";

const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/u);
const authorName = z.string().trim().min(1).max(60);
const requestKey = z.string().uuid();
const text = (limit: number) => z.string().transform((value) => value.normalize("NFKC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").trim()).pipe(z.string().min(1).max(limit));

export const CommunityMutation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("post"), requestKey, authorName, body: text(5000) }).strict(),
  z.object({ operation: z.literal("reply"), requestKey, postId: identifier, authorName, body: text(2000) }).strict(),
  z.object({ operation: z.literal("reaction"), postId: identifier, liked: z.boolean() }).strict(),
]);
export type CommunityMutationInput = z.infer<typeof CommunityMutation>;

type Database = Pick<PrismaClient, "$transaction">;
export class CommunityConflict extends Error {}

/** A serializable read of the same entitlement as the player precedes every
 * mutation. Retries are limited to transaction/unique races, never bad input. */
async function serializable<T>(db: Database, callback: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await db.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2034", "P2002"].includes(error.code) || attempt >= 2) throw error;
    }
  }
}

const publicReply = { id: true, authorName: true, body: true, createdAt: true } as const;

/** Bounded feed pagination never trusts an unqualified cursor from a client. */
export async function getCourseCommunity(db: Database, scope: StudentPortalScope, courseId: string, cursor?: string) {
  if (!identifier.safeParse(courseId).success || (cursor && !identifier.safeParse(cursor).success)) return null;
  return serializable(db, async (tx) => {
    const access = await authorizedCourseAccess(tx, scope, courseId);
    if (!access) return null;
    const where = { vendorId: scope.vendorId, productId: courseId, hiddenAt: null };
    const anchor = cursor ? await tx.courseCommunityPost.findFirst({ where: { ...where, id: cursor }, select: { id: true, createdAt: true, isPinned: true } }) : null;
    if (cursor && !anchor) return null;
    const posts = await tx.courseCommunityPost.findMany({
      where: { ...where, ...(anchor ? { OR: [...(anchor.isPinned ? [{ isPinned: false }] : []), { isPinned: anchor.isPinned, OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] }] } : {}) },
      orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 21,
      select: {
        ...publicReply, isPinned: true, isAnnouncement: true,
        replies: { where: { hiddenAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5, select: publicReply },
        reactions: { where: { customerKeyHash: scope.customerKeyHash }, take: 1, select: { createdAt: true } },
        _count: { select: { reactions: true, replies: { where: { hiddenAt: null } } } },
      },
    });
    return { course: { id: access.course.id, name: access.course.name }, posts: posts.slice(0, 20).map(({ reactions, _count, ...post }) => ({ ...post, liked: reactions.length > 0, likeCount: _count.reactions, replyCount: _count.replies })), nextCursor: posts.length > 20 ? posts[19]!.id : null };
  });
}

/** Full threads are independently paginated; the five-reply feed is a preview. */
export async function getCourseCommunityReplies(db: Database, scope: StudentPortalScope, courseId: string, postId: string, cursor?: string) {
  if (![courseId, postId, ...(cursor ? [cursor] : [])].every((value) => identifier.safeParse(value).success)) return null;
  return serializable(db, async (tx) => {
    if (!await authorizedCourseAccess(tx, scope, courseId)) return null;
    const post = await tx.courseCommunityPost.findFirst({ where: { vendorId: scope.vendorId, productId: courseId, id: postId, hiddenAt: null }, select: publicReply });
    if (!post) return null;
    const where = { vendorId: scope.vendorId, productId: courseId, postId, hiddenAt: null };
    const anchor = cursor ? await tx.courseCommunityReply.findFirst({ where: { ...where, id: cursor }, select: { id: true, createdAt: true } }) : null;
    if (cursor && !anchor) return null;
    const replies = await tx.courseCommunityReply.findMany({ where: { ...where, ...(anchor ? { OR: [{ createdAt: { gt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { gt: anchor.id } }] } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 21, select: publicReply });
    return { post, replies: replies.slice(0, 20), nextCursor: replies.length > 20 ? replies[19]!.id : null };
  });
}

export async function mutateCourseCommunity(db: Database, scope: StudentPortalScope, courseId: string, raw: unknown) {
  const input = CommunityMutation.parse(raw);
  if (!identifier.safeParse(courseId).success) return null;
  return serializable(db, async (tx) => {
    if (!await authorizedCourseAccess(tx, scope, courseId)) return null;
    const identity = { vendorId: scope.vendorId, productId: courseId };
    if (input.operation !== "post") {
      const post = await tx.courseCommunityPost.findFirst({ where: { ...identity, id: input.postId, hiddenAt: null }, select: { id: true } });
      if (!post) return null;
    }
    if (input.operation === "reaction") {
      const key = { ...identity, postId: input.postId, customerKeyHash: scope.customerKeyHash };
      if (input.liked) await tx.courseCommunityReaction.upsert({ where: { vendorId_productId_postId_customerKeyHash: key }, create: key, update: {} });
      else await tx.courseCommunityReaction.deleteMany({ where: key });
      return { liked: input.liked };
    }
    // Caller-supplied UUID is scoped to tenant/course/learner/operation. A retry
    // cannot create a second record or overwrite content from the first call.
    const id = `cm_${createHash("sha256").update(JSON.stringify([scope.vendorId, courseId, scope.customerKeyHash, input.operation, input.requestKey])).digest("hex")}`;
    const key = { ...identity, id };
    const data = { ...key, customerKeyHash: scope.customerKeyHash, authorName: input.authorName, body: input.body };
    if (input.operation === "post") {
      const post = await tx.courseCommunityPost.upsert({ where: { vendorId_productId_id: key }, create: data, update: {}, select: { ...publicReply, hiddenAt: true } });
      if (post.body !== input.body || post.authorName !== input.authorName || post.hiddenAt) throw new CommunityConflict("Request key already used");
      return { id: post.id };
    }
    const reply = await tx.courseCommunityReply.upsert({ where: { vendorId_productId_id: key }, create: { ...data, postId: input.postId }, update: {}, select: { ...publicReply, postId: true, hiddenAt: true } });
    if (reply.body !== input.body || reply.authorName !== input.authorName || reply.postId !== input.postId || reply.hiddenAt) throw new CommunityConflict("Request key already used");
    return { id: reply.id };
  });
}

export const CommunityModeration = z.object({ productId: identifier, postId: identifier, expectedRevision: z.number().int().min(0).max(2147483646), isPinned: z.boolean(), isAnnouncement: z.boolean(), hidden: z.boolean() }).strict();
/** Manager identity must be supplied by the server auth boundary, never form fields. */
export async function moderateCourseCommunity(db: Database, manager: { vendorId: string; role: string }, rawInput: unknown) {
  if (!["owner", "admin"].includes(manager.role)) return null;
  const input = CommunityModeration.parse(rawInput);
  return serializable(db, async (tx) => {
    const course = await tx.product.findFirst({ where: { id: input.productId, vendorId: manager.vendorId, fulfillmentType: "course" }, select: { id: true } });
    if (!course) return null;
    const result = await tx.courseCommunityPost.updateMany({ where: { vendorId: manager.vendorId, productId: course.id, id: input.postId, revision: input.expectedRevision }, data: { revision: { increment: 1 }, isPinned: input.isPinned, isAnnouncement: input.isAnnouncement, hiddenAt: input.hidden ? new Date() : null } });
    return result.count === 1 ? { updated: true as const } : null;
  });
}
