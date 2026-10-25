import { Prisma, type PrismaClient } from "@prisma/client";
import { verifiedVendorPaymentMethodWhere } from "@/lib/payment-method-reference";
import { parseFunnelStepPages } from "@/lib/funnel-step-pages";
import { independentlyPublishedPageCandidatesWhere, isIndependentlyPublishedFunnel } from "@/lib/public-landing-page-eligibility";
import { vendorOwnerEmailVerified } from "@/lib/merchant-email-verification";

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
 * A vendor whose owner has not verified the account email gets no new
 * independent publishes at all (owner decision 2026-10-25): throwaway accounts
 * would otherwise multiply the free limit. See `vendorOwnerEmailVerified`.
 */
export const INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT = 3;

/**
 * Platform-wide kill switch (interim mitigation until merchant email
 * verification exists). `INDEPENDENT_AUDIENCE_PUBLISH_DISABLED=1` (or `true`)
 * refuses every NEW independent publish for every vendor, paid or not;
 * pages that are already public this way keep working and can be
 * republished. Unset or any other value: enabled (the default). Read on the
 * server at call time, so an env change applies on the next deployment.
 */
export const INDEPENDENT_AUDIENCE_PUBLISH_DISABLED_ENV = "INDEPENDENT_AUDIENCE_PUBLISH_DISABLED";

export function isIndependentAudiencePublishDisabled(env: NodeJS.ProcessEnv = process.env) {
  const value = env[INDEPENDENT_AUDIENCE_PUBLISH_DISABLED_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/** Merchant-facing copy of the limit, shared by the publish error and the publication status. `used` is shown only when exact. */
export function independentPublishLimitMessage(used?: number) {
  const usage = used === undefined ? "目前已達上限" : `目前已有 ${used} 個`;
  return `免費帳號最多可同時有 ${INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT} 個不需發布專案就公開的名單型網站，${usage}，所以這個網站現在無法發布。發布所屬專案（專案內的網站不計入上限）、新增已驗證的付款方式或升級付費方案即可解除限制；也可以先取消發布其他名單型網站。`;
}

export const INDEPENDENT_PUBLISH_EMAIL_UNVERIFIED_MESSAGE = "這個商家的註冊 Email 還沒有完成驗證，所以目前無法發布「不需發布專案就公開」的名單型網站；已經公開的網站不受影響。請用註冊商家時的帳號登入，到「驗證 Email」頁面收信完成驗證（可重新寄送），或先發布所屬專案。";

export const INDEPENDENT_PUBLISH_DISABLED_MESSAGE = "平台目前暫停「不需發布專案就公開」的名單型網站新發布，這個網站現在無法發布；已經公開的網站不受影響。請先發布所屬專案，專案發布後即可發布這個網站。";

/** Candidates parsed per batch; per-page commerce can only be checked on parsed content. */
const SCAN_BATCH_SIZE = 25;
/** Upper bound of candidates parsed per decision; reaching it without certainty fails closed. */
const SCAN_MAX_CANDIDATES = 500;

type LimitReader = Pick<PrismaClient, "landingPage" | "paymentMethodReference" | "vendorSubscription" | "vendor" | "user" | "vendorMember">;

export type IndependentPublishAllowance = {
  /** Active paid plan or verified vendor payment method: no limit applies. */
  uncapped: boolean;
  /** The platform kill switch refuses new independent publishes. */
  disabled: boolean;
  /** The vendor's owner has not verified the account email: no new independent publishes. */
  emailUnverified: boolean;
  limit: number;
  /** Other pages of the vendor currently public through independent publication, when known exactly; null when the scan stopped early. */
  used: number | null;
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

type CandidatePage = { id: string; publishedVersion: { content: unknown } | null };

/** SQL already excluded bound lives and sales/webinar steps; per-page commerce needs the parsed content. */
function publicThroughIndependentPublication(page: CandidatePage) {
  return isIndependentlyPublishedFunnel(parseFunnelStepPages(page.publishedVersion?.content));
}

const candidateSelect = { id: true, publishedVersion: { select: { content: true } } } as const;

type ScanResult = { ids: string[]; complete: boolean };

/**
 * Walks the vendor's SQL candidates in id order, in batches, parsing each
 * published version. Stops once `stopAt` qualifying pages are found (the
 * caller only needs to know the limit is reached) or after
 * {@link SCAN_MAX_CANDIDATES}. `complete` means every candidate was examined.
 */
async function scanIndependentlyPublishedPages(database: Pick<PrismaClient, "landingPage">, vendorId: string, options: { exceptPageId?: string; stopAt?: number } = {}): Promise<ScanResult> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let scanned = 0;
  while (scanned < SCAN_MAX_CANDIDATES) {
    const idFilter: Prisma.StringFilter = { ...(options.exceptPageId ? { not: options.exceptPageId } : {}), ...(cursor ? { gt: cursor } : {}) };
    const batch: CandidatePage[] = await database.landingPage.findMany({
      where: { ...independentlyPublishedPageCandidatesWhere(vendorId), ...(Object.keys(idFilter).length ? { id: idFilter } : {}) },
      select: candidateSelect,
      orderBy: { id: "asc" },
      take: Math.min(SCAN_BATCH_SIZE, SCAN_MAX_CANDIDATES - scanned),
    });
    scanned += batch.length;
    for (const page of batch) {
      if (publicThroughIndependentPublication(page)) ids.push(page.id);
    }
    if (batch.length < SCAN_BATCH_SIZE) return { ids, complete: true };
    if (options.stopAt !== undefined && ids.length >= options.stopAt) return { ids, complete: false };
    cursor = batch[batch.length - 1]!.id;
  }
  return { ids, complete: false };
}

/** Ids of the vendor's pages (other than `exceptPageId`) that are public right now only through independent audience publication. */
export async function independentlyPublishedPageIds(database: Pick<PrismaClient, "landingPage">, vendorId: string, exceptPageId?: string) {
  return (await scanIndependentlyPublishedPages(database, vendorId, { exceptPageId })).ids;
}

/**
 * Whether `pageId` may become (or stay) independently published. All ids and
 * the vendor come from the caller's authenticated scope; nothing here reads
 * client input.
 */
export async function independentPublishAllowance(database: LimitReader, vendorId: string, pageId: string, now = new Date()): Promise<IndependentPublishAllowance> {
  const limit = INDEPENDENT_AUDIENCE_PUBLISH_FREE_LIMIT;
  const disabled = isIndependentAudiencePublishDisabled();
  const self = await database.landingPage.findFirst({ where: { ...independentlyPublishedPageCandidatesWhere(vendorId), id: pageId }, select: candidateSelect });
  const alreadyCounted = Boolean(self && publicThroughIndependentPublication(self));
  if (disabled) return { uncapped: false, disabled, emailUnverified: false, limit, used: null, alreadyCounted, allowed: alreadyCounted };
  // Applies to paid vendors too; like the kill switch it never unpublishes
  // anything, and a page that is already public may be republished.
  if (!await vendorOwnerEmailVerified(database, vendorId)) return { uncapped: false, disabled, emailUnverified: true, limit, used: null, alreadyCounted, allowed: alreadyCounted };
  if (await isIndependentPublishUncapped(database, vendorId, now)) return { uncapped: true, disabled, emailUnverified: false, limit, used: null, alreadyCounted, allowed: true };
  const others = await scanIndependentlyPublishedPages(database, vendorId, { exceptPageId: pageId, stopAt: limit });
  // A complete scan gives the exact count. An early stop already found `limit`
  // pages; hitting the scan bound below the limit is uncertain and fails closed.
  const atLimit = others.ids.length >= limit || !others.complete;
  return { uncapped: false, disabled, emailUnverified: false, limit, used: others.complete ? others.ids.length : null, alreadyCounted, allowed: alreadyCounted || !atLimit };
}

/**
 * Serialises publishes of one vendor for the rest of the transaction, so two
 * concurrent publishes cannot both see a free slot. Callers take it as the
 * first statement of a READ COMMITTED transaction: each later statement then
 * reads a fresh snapshot that includes every publish committed while this one
 * waited. (Under REPEATABLE READ or SERIALIZABLE the snapshot could predate
 * the lock and the limit could be exceeded.)
 */
export async function lockIndependentPublishSlots(transaction: Prisma.TransactionClient, vendorId: string) {
  await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`landing-page-independent-publish:${vendorId}`}, 0))`);
}
