import { z } from "zod";

// This public DTO deliberately excludes canonical order/payment identifiers,
// contact fields and encrypted snapshots. Keep it safe to import in the client.
export const LivePurchaseBroadcastPayload = z.object({ broadcasts: z.array(z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  buyerMaskedName: z.string().min(1).max(160),
  productName: z.string().min(1).max(200),
  secondsAgo: z.number().int().min(0).max(1800),
}).strict()).max(8) }).strict();
export type LivePurchaseBroadcastCard = z.infer<typeof LivePurchaseBroadcastPayload>["broadcasts"][number];

export function purchaseBroadcastAge(seconds: number) {
  return seconds < 60 ? "剛剛" : `${Math.floor(seconds / 60)} 分鐘前`;
}
