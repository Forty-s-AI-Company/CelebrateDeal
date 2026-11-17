import type { Prisma, PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { FIRST_SUCCESS_OWNER_EMAIL, firstSuccessOwnerEmail } from "@/lib/staging-first-success";
import { revokeAllStudentPortalSessionsForVendor } from "@/lib/student-portal-auth";
import { isWp4BoundNonProductionRuntime } from "@/lib/wp4-runtime-boundary";

/**
 * R-10: staging-only cleanup of what the O-13 first-success runner
 * (scripts/staging-first-success.mjs) leaves behind on every run: one
 * synthetic merchant (owner user + vendor), its product, form, video, template,
 * a live scheduled three days ahead, a published project and one buyer
 * registration with its queued reminder mail.
 *
 * Only the runner's own data is ever touched. A vendor qualifies only when all
 * of these hold, re-checked under a row lock in the transaction that changes it:
 * - its login Email is exactly `firstSuccessOwnerEmail(runId)` (the anchored
 *   FIRST_SUCCESS_OWNER_EMAIL pattern, a Resend test mailbox);
 * - its slug starts with the workspace slug the runner derives from the same
 *   run id (`synthetic-workspace-<first 10 hex>-<uuid>`, see registerAction);
 * - it has exactly one member: the active owner whose User has that same
 *   Email and no other membership;
 * - it has no order, payment, refund, invoice, subscription, settlement,
 *   payout or commission record (the runner never pays; such a vendor is
 *   skipped and reported, never changed).
 * Names, titles and other free text are never used to find anything.
 *
 * Two modes, never combined in one call:
 * - `deactivate` (run automatically after every runner job): suspends the vendor
 *   through the existing F-036 switch (`Vendor.suspendedAt`). The email and LINE
 *   jobs then skip it (rows stay queued), its public live, form and project
 *   pages answer 404 and its learner portal tokens are revoked, exactly like a
 *   platform suspension. The fixed `suspendedReason` marks it as ours.
 * - `delete` (manual only): vendors this cleanup suspended at least
 *   FIRST_SUCCESS_CLEANUP_RETENTION_MS ago are deleted one by one, each in its
 *   own transaction (vendor row cascade, then the owner User). Any FK that
 *   refuses (for example a restrictive finance table) rolls that vendor back
 *   and it is reported as failed.
 *
 * The caller (the JOB_SECRET ops route) already enforces the bound staging
 * runtime; this module checks it again before any query, so it can never run
 * in Production even if wired elsewhere. The receipt holds counts, mode,
 * status and 8-hex run id prefixes only: no Email, name, slug or row id.
 */

export type FirstSuccessCleanupMode = "deactivate" | "delete";
export const FIRST_SUCCESS_CLEANUP_MODE_HEADER = "x-celebratedeal-first-success-cleanup-mode";
/** Stored as `Vendor.suspendedReason`; only vendors carrying it can ever be deleted. */
export const FIRST_SUCCESS_CLEANUP_REASON = "staging_first_success_cleanup";
export const FIRST_SUCCESS_CLEANUP_RETENTION_DAYS = 7;
export const FIRST_SUCCESS_CLEANUP_RETENTION_MS = FIRST_SUCCESS_CLEANUP_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
/** Vendors deactivated or deleted per call; the rest wait for the next call (`truncated`). */
export const FIRST_SUCCESS_CLEANUP_BATCH_LIMIT = 25;
/**
 * Candidates inspected per call. Skipped and failed vendors do not use the
 * BATCH_LIMIT budget, so they cannot hold back eligible ones behind them;
 * this bound keeps one call's work finite.
 */
export const FIRST_SUCCESS_CLEANUP_EXAMINE_LIMIT = 100;
export const FIRST_SUCCESS_CLEANUP_ACTOR = "job:staging-first-success-cleanup";
export const FIRST_SUCCESS_CLEANUP_AUDIT_ACTION = "staging_first_success_cleanup";
export const FIRST_SUCCESS_CLEANUP_DELETED_AUDIT_ACTION = "staging_first_success_vendor_deleted";
const OWNER_EMAIL_PREFIX = "delivered+cdfs-owner-";
const OWNER_EMAIL_SUFFIX = "@resend.dev";
const WORKSPACE_SLUG_PREFIX = "synthetic-workspace-";
const CANDIDATE_PAGE_SIZE = 25;
const TRANSACTION_TIMEOUT_MS = 30_000;

/** The caller must name the mode; a missing header or any other value is rejected. */
export function readFirstSuccessCleanupMode(request: Request): FirstSuccessCleanupMode | null {
  const value = request.headers.get(FIRST_SUCCESS_CLEANUP_MODE_HEADER);
  return value === "deactivate" || value === "delete" ? value : null;
}

/** The run id of a runner owner mailbox, or null for any other address. */
export function firstSuccessRunIdFromOwnerEmail(email: string) {
  const runId = FIRST_SUCCESS_OWNER_EMAIL.exec(email)?.[1] ?? null;
  return runId && firstSuccessOwnerEmail(runId) === email ? runId : null;
}

/**
 * The runner registers `Synthetic workspace ${runId.slice(0, 10)}`; registerAction
 * turns that into `synthetic-workspace-<10 hex>-<randomUUID()>`.
 */
export function isFirstSuccessWorkspaceSlug(slug: string, runId: string) {
  return new RegExp(`^synthetic-workspace-${runId.slice(0, 10)}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, "u").test(slug);
}

export function firstSuccessRunIdPrefix(runId: string) {
  return runId.slice(0, 8);
}

type SkipReason = "financialRecords" | "unexpectedMembership" | "notRunnerVendor" | "notEligible";

export type FirstSuccessCleanupReceipt = {
  schemaVersion: "celebratedeal-staging-first-success-cleanup/v1";
  mode: FirstSuccessCleanupMode;
  result: "COMPLETED" | "PARTIAL" | "REFUSED";
  retentionDays: number;
  examined: number;
  deactivated: number;
  deleted: number;
  /** Runner vendors this cleanup had already suspended (deactivate mode). */
  alreadyDeactivated: number;
  /** Suspended by this cleanup but still inside the retention window (delete mode). */
  retained: number;
  skipped: Record<SkipReason, number>;
  failed: number;
  /** Candidates were left for the next call (batch or examine limit reached); the result is then PARTIAL. */
  truncated: boolean;
  /** Rows hidden (deactivate) or removed (delete) with the processed vendors. */
  affected: { lives: number; registrations: number; projects: number; queuedEmailDeliveries: number; ownerUsers: number };
  runIdPrefixes: { processed: string[]; skipped: string[]; failed: string[] };
};

export function emptyFirstSuccessCleanupReceipt(mode: FirstSuccessCleanupMode): FirstSuccessCleanupReceipt {
  return {
    schemaVersion: "celebratedeal-staging-first-success-cleanup/v1",
    mode,
    result: "REFUSED",
    retentionDays: FIRST_SUCCESS_CLEANUP_RETENTION_DAYS,
    examined: 0,
    deactivated: 0,
    deleted: 0,
    alreadyDeactivated: 0,
    retained: 0,
    skipped: { financialRecords: 0, unexpectedMembership: 0, notRunnerVendor: 0, notEligible: 0 },
    failed: 0,
    truncated: false,
    affected: { lives: 0, registrations: 0, projects: 0, queuedEmailDeliveries: 0, ownerUsers: 0 },
    runIdPrefixes: { processed: [], skipped: [], failed: [] },
  };
}

/**
 * Money-bearing relations. A runner vendor never has any; if one does, a human
 * or another flow used it and it is left alone.
 */
const VENDOR_FINANCE_COUNTS = {
  commerceOrders: true,
  commerceOrderRefunds: true,
  paymentTransactions: true,
  refundRecords: true,
  inventoryReservations: true,
  paymentAccounts: true,
  paymentMethodReferences: true,
  paymentMethodSetupIntents: true,
  subscriptions: true,
  invoices: true,
  electronicInvoices: true,
  electronicInvoiceAllowances: true,
  settlements: true,
  settlementAdjustmentRequests: true,
  settlementAdjustmentLedger: true,
  payoutItems: true,
  affiliateCommissions: true,
  affiliateCommissionLedgerEntries: true,
  affiliatePayouts: true,
  courseCommissionAllocations: true,
  courseCommissionLedgerEntries: true,
  coursePayouts: true,
  platformReferralCommissions: true,
  merchantAffiliateCheckoutSnapshots: true,
  merchantAffiliateCalculations: true,
  supportRefundHandoffs: true,
  webhookEvents: true,
  merchantAffiliatePolicies: true,
  merchantAffiliateCheckoutRecipients: true,
  merchantAffiliateCounters: true,
  usageRecords: true,
  streamUsageLedgerEntries: true,
} satisfies Prisma.VendorCountOutputTypeSelect;

/** One-to-one finance or billing rows (several RESTRICT the vendor delete): present = skip. */
const VENDOR_FINANCE_SINGLETONS = {
  payUniLiveProbe: { select: { id: true } },
  affiliatePayoutPolicy: { select: { vendorId: true } },
  usageLimit: { select: { id: true } },
  merchantAffiliatePolicyState: { select: { vendorId: true } },
} satisfies Prisma.VendorSelect;

const USER_FINANCE_COUNTS = {
  platformReferralCodes: true,
  platformReferralAttributions: true,
  platformReferralCommissions: true,
  platformReferralPayouts: true,
} satisfies Prisma.UserCountOutputTypeSelect;

type Tx = Prisma.TransactionClient;
type LockedVendor = { id: string; email: string; slug: string; suspendedAt: Date | null; suspendedReason: string | null };
type Affected = FirstSuccessCleanupReceipt["affected"];

type Eligibility =
  | { ok: true; vendor: LockedVendor; ownerUserId: string; runId: string }
  | { ok: false; reason: SkipReason | "alreadyDeactivated" | "retained"; runId: string | null };

function sumCounts(counts: Record<string, number>) {
  return Object.values(counts).reduce((total, value) => total + value, 0);
}

/** Every rule of the module comment, read under `FOR UPDATE` on the vendor row. */
async function inspectLockedVendor(tx: Tx, vendorId: string, mode: FirstSuccessCleanupMode, now: Date): Promise<Eligibility> {
  const rows = await tx.$queryRaw<LockedVendor[]>`SELECT "id", "email", "slug", "suspendedAt", "suspendedReason" FROM "Vendor" WHERE "id" = ${vendorId} FOR UPDATE`;
  const vendor = rows[0];
  if (!vendor) return { ok: false, reason: "notEligible", runId: null };
  const runId = firstSuccessRunIdFromOwnerEmail(vendor.email);
  if (!runId || !isFirstSuccessWorkspaceSlug(vendor.slug, runId)) return { ok: false, reason: "notRunnerVendor", runId };

  const members = await tx.vendorMember.findMany({ where: { vendorId: vendor.id }, select: { userId: true, role: true, status: true } });
  const owner = members[0];
  if (members.length !== 1 || !owner || owner.role !== "owner" || owner.status !== "active") return { ok: false, reason: "unexpectedMembership", runId };
  // The owner row is locked too, so its Email and memberships cannot change before the delete.
  const users = await tx.$queryRaw<Array<{ id: string; email: string }>>`SELECT "id", "email" FROM "User" WHERE "id" = ${owner.userId} FOR UPDATE`;
  if (users[0]?.email !== vendor.email) return { ok: false, reason: "unexpectedMembership", runId };
  const user = await tx.user.findUniqueOrThrow({ where: { id: owner.userId }, select: { _count: { select: { memberships: true, ...USER_FINANCE_COUNTS } } } });
  if (user._count.memberships !== 1) return { ok: false, reason: "unexpectedMembership", runId };
  const userFinance = sumCounts(user._count) - user._count.memberships;
  const finance = await tx.vendor.findUniqueOrThrow({
    where: { id: vendor.id },
    select: { _count: { select: VENDOR_FINANCE_COUNTS }, ...VENDOR_FINANCE_SINGLETONS },
  });
  const singletons = (Object.keys(VENDOR_FINANCE_SINGLETONS) as Array<keyof typeof VENDOR_FINANCE_SINGLETONS>)
    .filter((key) => finance[key] !== null).length;
  if (sumCounts(finance._count) + userFinance + singletons > 0) return { ok: false, reason: "financialRecords", runId };

  if (mode === "deactivate") {
    if (vendor.suspendedAt === null) return { ok: true, vendor, ownerUserId: owner.userId, runId };
    return { ok: false, reason: vendor.suspendedReason === FIRST_SUCCESS_CLEANUP_REASON ? "alreadyDeactivated" : "notEligible", runId };
  }
  // Delete: only what this cleanup suspended, and only after the retention window.
  if (vendor.suspendedAt === null || vendor.suspendedReason !== FIRST_SUCCESS_CLEANUP_REASON) return { ok: false, reason: "notEligible", runId };
  if (vendor.suspendedAt.getTime() > now.getTime() - FIRST_SUCCESS_CLEANUP_RETENTION_MS) return { ok: false, reason: "retained", runId };
  return { ok: true, vendor, ownerUserId: owner.userId, runId };
}

async function countAffected(tx: Tx, vendorId: string): Promise<Omit<Affected, "ownerUsers">> {
  const [lives, registrations, projects, queuedEmailDeliveries] = await Promise.all([
    tx.live.count({ where: { vendorId } }),
    tx.formSubmission.count({ where: { form: { vendorId } } }),
    tx.salesProject.count({ where: { vendorId } }),
    tx.emailDelivery.count({ where: { vendorId, status: { in: ["queued", "failed"] } } }),
  ]);
  return { lives, registrations, projects, queuedEmailDeliveries };
}

type VendorOutcome =
  | { status: "processed"; runId: string; affected: Affected }
  | { status: "skipped"; reason: Exclude<Eligibility, { ok: true }>["reason"]; runId: string | null };

async function deactivateOne(tx: Tx, vendorId: string, now: Date): Promise<VendorOutcome> {
  const eligibility = await inspectLockedVendor(tx, vendorId, "deactivate", now);
  if (!eligibility.ok) return { status: "skipped", reason: eligibility.reason, runId: eligibility.runId };
  const { vendor, runId } = eligibility;
  // Compare-and-set on the locked row, as suspendVendor does; the CHECK keeps reason and timestamp together.
  const updated = await tx.vendor.updateMany({
    where: { id: vendor.id, email: vendor.email, suspendedAt: null },
    data: { suspendedAt: now, suspendedReason: FIRST_SUCCESS_CLEANUP_REASON },
  });
  if (updated.count !== 1) return { status: "skipped", reason: "notEligible", runId };
  const revoked = await revokeAllStudentPortalSessionsForVendor(tx, { vendorId: vendor.id });
  const affected = { ...await countAffected(tx, vendor.id), ownerUsers: 0 };
  await tx.auditLog.create({
    data: {
      vendorId: vendor.id,
      actorId: null,
      actorLabel: FIRST_SUCCESS_CLEANUP_ACTOR,
      action: "vendor_suspended",
      targetType: "Vendor",
      targetId: vendor.id,
      before: { suspendedAt: null },
      after: { suspendedAt: now.toISOString(), reason: FIRST_SUCCESS_CLEANUP_REASON, revokedStudentPortalTokenCount: revoked, runIdPrefix: firstSuccessRunIdPrefix(runId) },
    },
  });
  return { status: "processed", runId, affected };
}

async function deleteOne(tx: Tx, vendorId: string, now: Date): Promise<VendorOutcome> {
  const eligibility = await inspectLockedVendor(tx, vendorId, "delete", now);
  if (!eligibility.ok) return { status: "skipped", reason: eligibility.reason, runId: eligibility.runId };
  const { vendor, ownerUserId, runId } = eligibility;
  const counted = await countAffected(tx, vendor.id);
  // Cascades remove the vendor's lives, forms, registrations, projects, deliveries and the rest;
  // AuditLog rows keep their history with vendorId set to NULL.
  const removed = await tx.vendor.deleteMany({
    where: { id: vendor.id, email: vendor.email, suspendedReason: FIRST_SUCCESS_CLEANUP_REASON, suspendedAt: vendor.suspendedAt },
  });
  if (removed.count !== 1) throw new Error("FIRST_SUCCESS_CLEANUP_VENDOR_CHANGED");
  const user = await tx.user.deleteMany({ where: { id: ownerUserId, email: vendor.email, memberships: { none: {} } } });
  if (user.count !== 1) throw new Error("FIRST_SUCCESS_CLEANUP_OWNER_CHANGED");
  const affected = { ...counted, ownerUsers: 1 };
  await tx.auditLog.create({
    data: {
      vendorId: null,
      actorId: null,
      actorLabel: FIRST_SUCCESS_CLEANUP_ACTOR,
      action: FIRST_SUCCESS_CLEANUP_DELETED_AUDIT_ACTION,
      targetType: "Vendor",
      targetId: vendor.id,
      before: { suspendedAt: vendor.suspendedAt?.toISOString() ?? null, runIdPrefix: firstSuccessRunIdPrefix(runId) },
      after: { deleted: true, ...affected },
    },
  });
  return { status: "processed", runId, affected };
}

type CleanupDb = Pick<PrismaClient, "$transaction" | "vendor" | "auditLog">;

export async function runFirstSuccessCleanup(input: {
  mode: FirstSuccessCleanupMode;
  now?: Date;
  db?: CleanupDb;
  env?: Readonly<Record<string, string | undefined>>;
  /** Tests only: smaller bounds. Never lifted above the module limits. */
  limits?: { batch?: number; examine?: number };
}): Promise<FirstSuccessCleanupReceipt> {
  const batchLimit = Math.min(input.limits?.batch ?? FIRST_SUCCESS_CLEANUP_BATCH_LIMIT, FIRST_SUCCESS_CLEANUP_BATCH_LIMIT);
  const examineLimit = Math.min(input.limits?.examine ?? FIRST_SUCCESS_CLEANUP_EXAMINE_LIMIT, FIRST_SUCCESS_CLEANUP_EXAMINE_LIMIT);
  const receipt = emptyFirstSuccessCleanupReceipt(input.mode);
  // Defense in depth: never query anything outside the bound staging Preview runtime.
  if (!isWp4BoundNonProductionRuntime(input.env ?? process.env)) return receipt;
  const db = input.db ?? getDb();
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - FIRST_SUCCESS_CLEANUP_RETENTION_MS);
  const runnerEmail = { startsWith: OWNER_EMAIL_PREFIX, endsWith: OWNER_EMAIL_SUFFIX };

  const runnerVendor = { email: runnerEmail, slug: { startsWith: WORKSPACE_SLUG_PREFIX } };
  const where: Prisma.VendorWhereInput = input.mode === "deactivate"
    ? { ...runnerVendor, suspendedAt: null }
    : { ...runnerVendor, suspendedReason: FIRST_SUCCESS_CLEANUP_REASON, suspendedAt: { lte: cutoff } };

  // Keyset scan, oldest first. Only vendors actually changed use the batch budget, so skipped or
  // failed ones never pin the batch; at most EXAMINE_LIMIT candidates are inspected per call.
  let cursor: { createdAt: Date; id: string } | null = null;
  let changed = 0;
  scan: for (;;) {
    const page: Array<{ id: string; email: string; createdAt: Date }> = await db.vendor.findMany({
      where: cursor
        ? { AND: [where, { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] }
        : where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: CANDIDATE_PAGE_SIZE,
      select: { id: true, email: true, createdAt: true },
    });
    for (const candidate of page) {
      if (changed >= batchLimit || receipt.examined >= examineLimit) {
        receipt.truncated = true;
        break scan;
      }
      cursor = { createdAt: candidate.createdAt, id: candidate.id };
      receipt.examined += 1;
      const candidateRunId = firstSuccessRunIdFromOwnerEmail(candidate.email);
      if (!candidateRunId) { receipt.skipped.notRunnerVendor += 1; continue; }
      let outcome: VendorOutcome;
      try {
        outcome = await db.$transaction(
          (tx) => (input.mode === "deactivate" ? deactivateOne(tx, candidate.id, now) : deleteOne(tx, candidate.id, now)),
          { timeout: TRANSACTION_TIMEOUT_MS },
        );
      } catch {
        receipt.failed += 1;
        receipt.runIdPrefixes.failed.push(firstSuccessRunIdPrefix(candidateRunId));
        continue;
      }
      const prefix = firstSuccessRunIdPrefix(outcome.runId ?? candidateRunId);
      if (outcome.status === "processed") {
        changed += 1;
        if (input.mode === "deactivate") receipt.deactivated += 1; else receipt.deleted += 1;
        for (const key of Object.keys(receipt.affected) as Array<keyof Affected>) receipt.affected[key] += outcome.affected[key];
        receipt.runIdPrefixes.processed.push(prefix);
      } else {
        // alreadyDeactivated / retained here means the row changed after the candidate query;
        // the context counts below report those states, so the vendor counts as not eligible.
        const reason = outcome.reason === "alreadyDeactivated" || outcome.reason === "retained" ? "notEligible" : outcome.reason;
        receipt.skipped[reason] += 1;
        receipt.runIdPrefixes.skipped.push(prefix);
      }
    }
    if (page.length < CANDIDATE_PAGE_SIZE) break;
  }

  // Context counts, read after the batch: what this cleanup already holds and what waits for retention.
  const ours = { ...runnerVendor, suspendedReason: FIRST_SUCCESS_CLEANUP_REASON };
  if (input.mode === "deactivate") receipt.alreadyDeactivated = await db.vendor.count({ where: { ...ours, suspendedAt: { lt: now } } });
  else receipt.retained = await db.vendor.count({ where: { ...ours, suspendedAt: { gt: cutoff } } });

  receipt.result = receipt.failed > 0 || receipt.truncated ? "PARTIAL" : "COMPLETED";
  await db.auditLog.create({
    data: {
      vendorId: null,
      actorId: null,
      actorLabel: FIRST_SUCCESS_CLEANUP_ACTOR,
      action: FIRST_SUCCESS_CLEANUP_AUDIT_ACTION,
      targetType: "StagingFirstSuccessCleanup",
      targetId: input.mode,
      after: receipt as unknown as Prisma.InputJsonValue,
    },
  });
  return receipt;
}
