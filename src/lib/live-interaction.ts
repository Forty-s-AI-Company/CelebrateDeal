import { createHash, randomBytes, randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { normalizeInteractionEventDraft, type AdvancedInteractionMetadata } from "@/lib/interaction-event";

export const FLASH_VOUCHER_COOKIE = "celebratedeal_flash_voucher";
export const FLASH_VOUCHER_TTL_MS = 24 * 60 * 60 * 1_000;

export function hashInteractionBearer(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createInteractionBearer() {
  return randomBytes(32).toString("base64url");
}

export function interactionEndsAt(startsAt: Date, metadata: AdvancedInteractionMetadata) {
  return new Date(startsAt.getTime() + metadata.durationSec * 1_000);
}

export function calculateVoucherDiscount(
  priceCents: number,
  metadata: AdvancedInteractionMetadata,
  currency?: string,
) {
  if (metadata.kind !== "flash_voucher" || !Number.isSafeInteger(priceCents) || priceCents <= 0) return 0;
  const raw = metadata.discountType === "percentage"
    ? Math.floor(priceCents * metadata.discountValue / 100)
    : metadata.discountValue;
  const bounded = Math.max(0, Math.min(priceCents - 1, raw));
  // PayUni accepts whole TWD amounts. Keep the final charge provider-safe
  // instead of producing a fractional-dollar amount from a percentage coupon.
  return currency === "TWD" ? Math.floor(bounded / 100) * 100 : bounded;
}

export function pickLuckyDrawWinner<T>(entries: readonly T[], randomIndex = randomInt) {
  if (entries.length === 0) return null;
  return entries[randomIndex(entries.length)] ?? null;
}

export function pollPercentages(options: Array<{ id: string; label: string }>, values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return pollPercentagesFromCounts(options, counts);
}

export function pollPercentagesFromCounts(options: Array<{ id: string; label: string }>, counts: ReadonlyMap<string, number>) {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return options.map((option) => {
    const votes = counts.get(option.id) ?? 0;
    return { ...option, votes, percentage: total === 0 ? 0 : Math.round(votes * 100 / total) };
  });
}

export async function resolveEligibleVoucherClaim(
  db: PrismaClient,
  bearer: string | null | undefined,
  input: { vendorId: string; productId: string; priceCents: number; currency?: string; now?: Date },
) {
  if (!bearer || !/^[A-Za-z0-9_-]{43}$/u.test(bearer)) return null;
  const now = input.now ?? new Date();
  const claim = await db.liveInteractionResponse.findUnique({
    where: { claimTokenHash: hashInteractionBearer(bearer) },
    include: { run: true },
  });
  if (
    !claim
    || claim.vendorId !== input.vendorId
    || claim.eventType !== "flash_voucher"
    || claim.usedOrderId
    || !claim.expiresAt
    || claim.expiresAt <= now
    || (claim.productId && claim.productId !== input.productId)
    || claim.run.eventType !== "flash_voucher"
  ) return null;
  const normalized = normalizeInteractionEventDraft({
    eventType: "flash_voucher",
    triggerSec: 0,
    title: claim.run.title,
    productId: claim.productId,
    metadata: claim.run.configuration,
  });
  if (!normalized.success || normalized.data.metadata?.kind !== "flash_voucher") return null;
  const discountAmountCents = calculateVoucherDiscount(input.priceCents, normalized.data.metadata, input.currency);
  return discountAmountCents > 0 ? { id: claim.id, discountAmountCents } : null;
}
