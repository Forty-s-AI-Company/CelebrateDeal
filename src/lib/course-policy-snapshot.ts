import { z } from "zod";

const CoursePolicySnapshotSchema = z.object({
  productId: z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/u),
  contentOwnerMembershipId: z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/u),
  promoterShareBps: z.number().int().min(1).max(9_999),
  policyVersion: z.number().int().positive().max(2_147_483_647),
}).strict();

export type CoursePolicySnapshot = z.infer<typeof CoursePolicySnapshotSchema>;

export function coursePolicySnapshotFromProduct(product: {
  id: string;
  commerceDomain: string;
  courseContentOwnerMembershipId: string | null;
  coursePromoterShareBps: number | null;
  coursePolicyVersion: number;
}): CoursePolicySnapshot | null {
  if (product.commerceDomain !== "course" || !product.courseContentOwnerMembershipId || product.coursePromoterShareBps === null) return null;
  return CoursePolicySnapshotSchema.parse({
    productId: product.id,
    contentOwnerMembershipId: product.courseContentOwnerMembershipId,
    promoterShareBps: product.coursePromoterShareBps,
    policyVersion: product.coursePolicyVersion,
  });
}

export function coursePolicySnapshotFromMetadata(metadata: unknown): CoursePolicySnapshot | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const parsed = CoursePolicySnapshotSchema.safeParse((metadata as Record<string, unknown>).coursePolicySnapshot);
  return parsed.success ? parsed.data : null;
}
