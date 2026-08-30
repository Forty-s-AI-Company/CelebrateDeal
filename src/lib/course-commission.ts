import { z } from "zod";

export const COURSE_BPS_TOTAL = 10_000;
export const CourseCommerceDomain = z.enum(["merchant", "course"]);
export type CourseCommerceDomainValue = z.infer<typeof CourseCommerceDomain>;
export const CourseRecipientRole = z.enum(["content_owner", "promoter"]);
export type CourseRecipientRoleValue = z.infer<typeof CourseRecipientRole>;

const MembershipId = z.string().trim().min(1);
const PositiveBps = z.number().int().min(1).max(COURSE_BPS_TOTAL - 1);

export type CourseAllocationPlanItem = {
  recipientMembershipId: string;
  recipientRole: CourseRecipientRoleValue;
  shareBps: number;
  amountCents: number;
};

export type CourseAllocationPlan = {
  grossAmountCents: number;
  policyVersion: number;
  allocations: CourseAllocationPlanItem[];
};

export function calculateCourseAllocationPlan(input: {
  grossAmountCents: number;
  policyVersion: number;
  contentOwnerMembershipId: string;
  promoterMembershipId?: string | null;
  promoterShareBps?: number | null;
}) : CourseAllocationPlan {
  const grossAmountCents = z.number().int().positive().parse(input.grossAmountCents);
  const policyVersion = z.number().int().positive().parse(input.policyVersion);
  const contentOwnerMembershipId = MembershipId.parse(input.contentOwnerMembershipId);
  const promoterMembershipId = input.promoterMembershipId == null
    ? null
    : MembershipId.parse(input.promoterMembershipId);

  // A direct F sale is intentionally one recipient. It must not manufacture a
  // G row from the product policy or walk any upline relationship.
  if (!promoterMembershipId || promoterMembershipId === contentOwnerMembershipId) {
    return {
      grossAmountCents,
      policyVersion,
      allocations: [{
        recipientMembershipId: contentOwnerMembershipId,
        recipientRole: "content_owner",
        shareBps: COURSE_BPS_TOTAL,
        amountCents: grossAmountCents,
      }],
    };
  }

  const promoterShareBps = PositiveBps.parse(input.promoterShareBps);
  const contentOwnerShareBps = COURSE_BPS_TOTAL - promoterShareBps;
  const promoterAmountCents = Math.round((grossAmountCents * promoterShareBps) / COURSE_BPS_TOTAL);
  const contentOwnerAmountCents = grossAmountCents - promoterAmountCents;
  if (promoterAmountCents <= 0 || contentOwnerAmountCents <= 0) {
    throw new Error("課程 F/G 分潤比例在目前付款金額下無法產生正整數分配。 ");
  }

  return {
    grossAmountCents,
    policyVersion,
    allocations: [
      {
        recipientMembershipId: contentOwnerMembershipId,
        recipientRole: "content_owner",
        shareBps: contentOwnerShareBps,
        amountCents: contentOwnerAmountCents,
      },
      {
        recipientMembershipId: promoterMembershipId,
        recipientRole: "promoter",
        shareBps: promoterShareBps,
        amountCents: promoterAmountCents,
      },
    ],
  };
}

export type CourseRefundAllocation = {
  recipientRole: CourseRecipientRoleValue;
  shareBps: number;
  currentBalanceCents: number;
};

/**
 * Allocates one refund event against the original share snapshot. Flooring
 * first and distributing the remaining cents by largest remainder keeps the
 * event total exact without rewriting the opening allocation.
 */
export function calculateCourseRefundDistribution(
  refundAmountCents: number,
  allocations: readonly CourseRefundAllocation[],
) {
  const refund = z.number().int().positive().parse(refundAmountCents);
  if (allocations.length === 0) throw new Error("退款找不到課程分潤 snapshot。 ");

  const normalized = allocations.map((allocation) => ({
    ...allocation,
    shareBps: z.number().int().min(1).max(COURSE_BPS_TOTAL).parse(allocation.shareBps),
    currentBalanceCents: z.number().int().nonnegative().parse(allocation.currentBalanceCents),
  }));
  if (normalized.reduce((sum, allocation) => sum + allocation.shareBps, 0) !== COURSE_BPS_TOTAL) {
    throw new Error("課程退款分潤 snapshot 比例總和必須等於 10000。 ");
  }
  if (normalized.reduce((sum, allocation) => sum + allocation.currentBalanceCents, 0) < refund) {
    throw new Error("課程退款超過分潤 ledger 可回沖餘額。 ");
  }

  const result = normalized.map((allocation, index) => {
    const exact = (refund * allocation.shareBps) / COURSE_BPS_TOTAL;
    return {
      ...allocation,
      index,
      amountCents: Math.min(Math.floor(exact), allocation.currentBalanceCents),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = refund - result.reduce((sum, allocation) => sum + allocation.amountCents, 0);
  const priority = [...result].sort((left, right) => {
    if (right.remainder !== left.remainder) return right.remainder - left.remainder;
    if (left.recipientRole === "content_owner" && right.recipientRole !== "content_owner") return -1;
    if (right.recipientRole === "content_owner" && left.recipientRole !== "content_owner") return 1;
    return left.index - right.index;
  });
  while (remaining > 0) {
    const candidate = priority.find((allocation) => allocation.amountCents < allocation.currentBalanceCents);
    if (!candidate) throw new Error("課程退款無法在原 snapshot 餘額內完成精確分配。 ");
    candidate.amountCents += 1;
    remaining -= 1;
  }

  return result
    .sort((left, right) => left.index - right.index)
    .map((allocation) => {
      const { index, remainder, ...snapshot } = allocation;
      void index;
      void remainder;
      return snapshot;
    });
}
