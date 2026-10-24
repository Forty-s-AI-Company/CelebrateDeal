import { Prisma, type PrismaClient } from "@prisma/client";
import { verifiedVendorPaymentMethodWhere } from "@/lib/payment-method-reference";
import { parseFunnelStepPages } from "@/lib/funnel-step-pages";
import { independentlyPublishedPageCandidatesWhere, isIndependentlyPublishedFunnel } from "@/lib/public-landing-page-eligibility";

/**
 * Abuse guard for independent audience publication (owner decision
 * 2026-10-24, follow-up to #478). Publishing a lead-capture Funnel without its
 * sales project skips the project prerequisites (priced product, verified
 * payment method ...) that used to make throwaway accounts costly. A vendor
 * therefore keeps at most this many audience Funnels public *only* through
 * independent publication, unless it has an active paid plan or a verified
 * vendor payment method. Pages of a published project, unpublished pages and
 * archived pages never count. systeme.io limits free accounts to 3 funnels.
 *
 * Merchant accounts have no stored email-verification signal (registration
 * creates the User without one), so an "unverified email" rule cannot be
 * expressed without a migration; see docs/codex-goal/PRISMA_INVARIANTS.md.
 */
export const INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT = 3;

/** Merchant-facing copy of the limit, shared by the publish error and the publication status. */
export function independentPublishLimitMessage(used?: number) {
  const usage = used === undefined ? "目前已達上限" : `目前已有 ${used} 個`;
  return `免費帳號最多可同時有 ${INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT} 個不需發布專案就公開的名單型網站，${usage}，所以這個網站現在無法發布。發布所屬專案（專案內的網站不計入上限）、新增已驗證的付款方式或升級付費方案即可解除限制；也可以先取消發布其他名單型網站。`;
}

/** Keeps candidate loading bounded; a scan that hits it counts as full (fails closed). */
const CANDIDATE_SCAN_LIMIT = 50;

type LimitReader = Pick<PrismaClient, "landingPage" | "paymentMethodReference" | "vendorSubscription">;

export type IndependentPublishAllowance = {
  /** Active paid plan or verified vendor payment method: no limit applies. */
  uncapped: boolean;
  limit: number;
  /** Other pages of the vendor currently public through independent publication. */
  used: number;
  /** This page is already one of them, so republishing it adds nothing. */
  alreadyCounted: boolean;
  allowed: boolean;
};

/** An active subscription whose plan charges a monthly fee, as of `now`. */
function activePaidSubscriptionWhere(vendorId: string, now: Date): Prisma.VendorSubscriptionWhereInput {
  return {
    vendorId,
    status: "active",
    startedAt: { lte: now },
    OR: [{ endedAt: null }, { endedAt: { gt: now } }],
    plan: { is: { monthlyPriceCents: { gt: 0 } } },
  };
}

export async function isIndependentPublishUncapped(database: LimitReader, vendorId: string, now = new Date()) {
  const [paymentMethod, subscription] = await Promise.all([
    database.paymentMethodReference.findFirst({ where: verifiedVendorPaymentMethodWhere(vendorId, now), select: { id: true } }),
    database.vendorSubscription.findFirst({ where: activePaidSubscriptionWhere(vendorId, now), select: { id: true } }),
  ]);
  return Boolean(paymentMethod || subscription);
}

type CandidatePage = { id: string; publishedVersion: { content: unknown; liveId: string | null } | null };

/** The SQL gate cannot see per-page commerce; a bound live keeps the page closed until its project publishes. */
function publicThroughIndependentPublication(page: CandidatePage) {
  return !page.publishedVersion?.liveId && isIndependentlyPublishedFunnel(parseFunnelStepPages(page.publishedVersion?.content));
}

const candidateSelect = { id: true, publishedVersion: { select: { content: true, liveId: true } } } as const;

async function scanIndependentlyPublishedPages(database: Pick<PrismaClient, "landingPage">, vendorId: string, exceptPageId?: string) {
  const candidates = await database.landingPage.findMany({
    where: { ...independentlyPublishedPageCandidatesWhere(vendorId), ...(exceptPageId ? { id: { not: exceptPageId } } : {}) },
    select: candidateSelect,
    orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
    take: CANDIDATE_SCAN_LIMIT,
  });
  return { ids: candidates.filter(publicThroughIndependentPublication).map((page) => page.id), saturated: candidates.length >= CANDIDATE_SCAN_LIMIT };
}

/** Ids of the vendor's pages (other than `exceptPageId`) that are public right now only through independent audience publication. */
export async function independentlyPublishedPageIds(database: Pick<PrismaClient, "landingPage">, vendorId: string, exceptPageId?: string) {
  return (await scanIndependentlyPublishedPages(database, vendorId, exceptPageId)).ids;
}

/**
 * Whether `pageId` may become (or stay) independently published. All ids and
 * the vendor come from the caller's authenticated scope; nothing here reads
 * client input.
 */
export async function independentPublishAllowance(database: LimitReader, vendorId: string, pageId: string, now = new Date()): Promise<IndependentPublishAllowance> {
  const limit = INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT;
  if (await isIndependentPublishUncapped(database, vendorId, now)) return { uncapped: true, limit, used: 0, alreadyCounted: false, allowed: true };
  const [self, others] = await Promise.all([
    database.landingPage.findFirst({ where: { ...independentlyPublishedPageCandidatesWhere(vendorId), id: pageId }, select: candidateSelect }),
    scanIndependentlyPublishedPages(database, vendorId, pageId),
  ]);
  const alreadyCounted = Boolean(self && publicThroughIndependentPublication(self));
  // A saturated scan could hide further pages; it is treated as full rather than guessed.
  const used = others.saturated ? Math.max(others.ids.length, limit) : others.ids.length;
  return { uncapped: false, limit, used, alreadyCounted, allowed: alreadyCounted || used < limit };
}

/**
 * Serialises independent publishes of one vendor for the rest of the
 * transaction, so two concurrent publishes cannot both see a free slot.
 * Under READ COMMITTED the count that follows the lock sees every publish
 * that committed while this one waited.
 */
export async function lockIndependentPublishSlots(transaction: Prisma.TransactionClient, vendorId: string) {
  await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`landing-page-independent-publish:${vendorId}`}, 0))`);
}
