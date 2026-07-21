import { z } from "zod";

export const PayoutItemTargetStatus = z.enum(["paid", "failed", "retrying"]);
export type PayoutItemTargetStatusValue = z.infer<typeof PayoutItemTargetStatus>;

const allowedTransitions: Record<string, ReadonlySet<PayoutItemTargetStatusValue>> = {
  pending: new Set(["paid", "failed"]),
  failed: new Set(["retrying"]),
  retrying: new Set(["paid", "failed"]),
  paid: new Set(),
};

export function canTransitionPayoutItem(currentStatus: string, targetStatus: PayoutItemTargetStatusValue) {
  return allowedTransitions[currentStatus]?.has(targetStatus) ?? false;
}

export function canMarkPayoutBatchExported(currentStatus: string) {
  return currentStatus === "draft";
}

export function derivePayoutBatchStatus(
  itemStatuses: string[],
  fallbackStatus: string,
) {
  if (itemStatuses.length > 0 && itemStatuses.every((status) => status === "paid")) return "completed";
  if (itemStatuses.includes("retrying")) return "retrying";
  if (itemStatuses.includes("failed")) return "failed";
  return fallbackStatus;
}
