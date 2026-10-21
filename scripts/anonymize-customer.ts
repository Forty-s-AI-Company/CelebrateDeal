/**
 * F-070 / B04-17: personal-data request tool (deletion / de-identification).
 *
 * Locates one customer of one vendor by the vendor-bound customerKeyHash and
 * overwrites the customer's PII with fixed placeholders. Financial rows
 * (orders, payments, refunds, commissions, invoices) are kept; only the
 * buyer / shipping contact data on them is replaced. See
 * docs/operations/personal-data-request-runbook.md.
 *
 * Safety (a guard against mistakes, not an access control: anyone holding the
 * database credentials can bypass it):
 * - Dry run by default: prints counts only. Writing needs `--execute` AND
 *   ANONYMIZE_CUSTOMER_CONFIRM=ANONYMIZE_CUSTOMER_PII.
 * - Never prints names, emails, phones, message bodies or the hash itself.
 * - The target is resolved like `npm run db:migrate:deploy`
 *   (scripts/db-migrate-guard.ts): a loopback `celebratedeal_*` database is
 *   always allowed; any other target needs ANONYMIZE_CUSTOMER_WORKFLOW to name
 *   an entry of the reviewed APPROVED_ANONYMIZE_WORKFLOWS table and run on its
 *   platform. The table is empty until a protected workflow exists, so every
 *   remote target is refused today. The validated URL is pinned into the
 *   Prisma client, so no .env file can redirect it afterwards.
 *
 * Usage:
 *   npx tsx scripts/anonymize-customer.ts --vendor-id <id> --customer-key-hash <hash>
 *   ANONYMIZE_CUSTOMER_EMAIL=<email> npx tsx scripts/anonymize-customer.ts --vendor-id <id>
 *   ANONYMIZE_CUSTOMER_CONFIRM=ANONYMIZE_CUSTOMER_PII ... --execute
 *     (the email is read from the environment so it never lands in shell history
 *      or process listings; the hash is derived with the app's own key)
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { automationCustomerKeyHash } from "../src/lib/automation-workflow";
import { protectCommerceOrderPii, revealCommerceOrderPii } from "../src/lib/commerce-order-pii";
import { encryptPrivateChatBody } from "../src/lib/live-private-chat-storage";
import { classifyLocalTestDatabase } from "./local-database-safety";

export const ANONYMIZED_NAME = "已去識別化";
export const ANONYMIZED_TEXT = "此內容已依個資請求移除";
export const EXECUTE_CONFIRMATION = "ANONYMIZE_CUSTOMER_PII";
const LEGACY_SCAN_PAGE = 500;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 120_000,
} as const;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Remote callers, each named by an ANONYMIZE_CUSTOMER_WORKFLOW value that only
 * that workflow sets, plus the platform marker it must run under. Adding one
 * (for example a `production`-environment personal-data-request workflow
 * pinned by GITHUB_WORKFLOW_REF) is a reviewed change to this table. Empty on
 * purpose: no such workflow exists yet.
 */
const APPROVED_ANONYMIZE_WORKFLOWS: Readonly<Record<string, (environment: Environment) => boolean>> = {};

export class AnonymizeTargetRefusedError extends Error {
  constructor(public readonly category: string) {
    super("Personal-data request target refused.");
    this.name = "AnonymizeTargetRefusedError";
  }
}

function present(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Returns the database URL the tool may use, or throws a safe category. */
export function resolveAnonymizeTarget(env: Environment = process.env, approved = APPROVED_ANONYMIZE_WORKFLOWS) {
  const url = present(env.DATABASE_URL);
  if (!url) throw new AnonymizeTargetRefusedError("missing");
  const local = classifyLocalTestDatabase(url);
  if (local.safe) return { url, target: "loopback" as const };
  const workflow = env.ANONYMIZE_CUSTOMER_WORKFLOW ?? "";
  const platformMatches = Object.hasOwn(approved, workflow) && approved[workflow]!(env);
  if (!platformMatches) throw new AnonymizeTargetRefusedError(local.category === "non-loopback" ? "remote-outside-workflow" : local.category);
  return { url, target: "workflow" as const };
}

function anonymizedEmail(rowId: string) {
  // Unique per row: legacy CRM grouping (hash of email) must not merge every
  // anonymized person into one synthetic customer.
  return `anonymized+${rowId.toLowerCase().replace(/[^a-z0-9]/g, "")}@redacted.invalid`;
}

type Db = PrismaClient | Prisma.TransactionClient;

export type AnonymizeCustomerInput = {
  vendorId: string;
  customerKeyHash: string;
  execute: boolean;
};

export type AnonymizeCustomerCounts = {
  formSubmissions: number;
  liveChatMessages: number;
  livePrivateChatMessages: number;
  commerceOrders: number;
  /** Orders without a stored hash whose buyer envelope could not be read; review by hand. */
  legacyOrdersUnreadable: number;
  consultationBookings: number;
  blacklistEntries: number;
  communityPosts: number;
  communityReplies: number;
  consultantNotes: number;
  studentPortalTokens: number;
};

function safeHash(vendorId: string, email: string) {
  try {
    return automationCustomerKeyHash(vendorId, email);
  } catch {
    // Already-anonymized or malformed legacy email: cannot belong to the request.
    return null;
  }
}

/** Pages through rows without a stored hash and keeps those whose email hashes to the request. */
async function scanLegacy<T extends { id: string }>(
  fetchPage: (cursor: string | undefined) => Promise<T[]>,
  matches: (row: T) => boolean,
) {
  const ids: string[] = [];
  let cursor: string | undefined;
  while (true) {
    const rows = await fetchPage(cursor);
    for (const row of rows) if (matches(row)) ids.push(row.id);
    cursor = rows.at(-1)?.id;
    if (rows.length < LEGACY_SCAN_PAGE) return ids;
  }
}

async function matchingSubmissionIds(db: Db, vendorId: string, customerKeyHash: string) {
  const direct = await db.formSubmission.findMany({ where: { form: { vendorId }, customerKeyHash }, select: { id: true } });
  const legacy = await scanLegacy(
    (cursor) => db.formSubmission.findMany({
      where: { form: { vendorId }, customerKeyHash: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, email: true }, orderBy: { id: "asc" }, take: LEGACY_SCAN_PAGE,
    }),
    (row) => safeHash(vendorId, row.email) === customerKeyHash,
  );
  return [...new Set([...direct.map((row) => row.id), ...legacy])];
}

async function matchingBookingIds(db: Db, vendorId: string, customerKeyHash: string) {
  const direct = await db.consultationBooking.findMany({ where: { vendorId, customerKeyHash }, select: { id: true } });
  const legacy = await scanLegacy(
    (cursor) => db.consultationBooking.findMany({
      where: { vendorId, customerKeyHash: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, clientEmail: true }, orderBy: { id: "asc" }, take: LEGACY_SCAN_PAGE,
    }),
    (row) => safeHash(vendorId, row.clientEmail) === customerKeyHash,
  );
  return [...new Set([...direct.map((row) => row.id), ...legacy])];
}

/**
 * Orders created before automationCustomerKeyHash existed have no hash: the
 * buyer envelope is decrypted in memory only to compare its email hash.
 * Already-anonymized orders decrypt to a redacted address and never match.
 */
async function matchingOrderIds(db: Db, vendorId: string, customerKeyHash: string) {
  const direct = await db.commerceOrder.findMany({ where: { vendorId, automationCustomerKeyHash: customerKeyHash }, select: { id: true } });
  let unreadable = 0;
  const legacy = await scanLegacy(
    (cursor) => db.commerceOrder.findMany({
      where: { vendorId, automationCustomerKeyHash: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, buyerEncryptedEnvelope: true }, orderBy: { id: "asc" }, take: LEGACY_SCAN_PAGE,
    }),
    (row) => {
      try {
        const pii = revealCommerceOrderPii({ buyerEncrypted: row.buyerEncryptedEnvelope, shippingEncrypted: null }, { vendorId, orderId: row.id });
        return safeHash(vendorId, pii.buyer.email) === customerKeyHash;
      } catch {
        unreadable += 1;
        return false;
      }
    },
  );
  return { ids: [...new Set([...direct.map((row) => row.id), ...legacy])], unreadable };
}

async function matchingBlacklistIds(db: Db, vendorId: string, customerKeyHash: string) {
  return scanLegacy(
    (cursor) => db.blacklist.findMany({
      where: { vendorId, identifierType: "email", ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, identifier: true }, orderBy: { id: "asc" }, take: LEGACY_SCAN_PAGE,
    }),
    (row) => safeHash(vendorId, row.identifier) === customerKeyHash,
  );
}

async function collect(db: Db, vendorId: string, customerKeyHash: string) {
  const submissionIds = await matchingSubmissionIds(db, vendorId, customerKeyHash);
  const bookingIds = await matchingBookingIds(db, vendorId, customerKeyHash);
  const orders = await matchingOrderIds(db, vendorId, customerKeyHash);
  const blacklistIds = await matchingBlacklistIds(db, vendorId, customerKeyHash);
  // Rows that keep the hash (community posts, CRM notes) are counted only
  // while they still hold original content, so a completed request re-runs to 0.
  const notAnonymized = { NOT: { body: ANONYMIZED_TEXT } };
  const [chat, privateChat, posts, replies, crm, tokens] = await Promise.all([
    db.liveChatMessage.findMany({ where: { vendorId, formSubmissionId: { in: submissionIds } }, select: { id: true } }),
    db.livePrivateChatMessage.findMany({
      where: { vendorId, formSubmissionId: { in: submissionIds } },
      select: { id: true, liveId: true, formSubmissionId: true, source: true },
    }),
    db.courseCommunityPost.count({ where: { vendorId, customerKeyHash, ...notAnonymized } }),
    db.courseCommunityReply.count({ where: { vendorId, customerKeyHash, ...notAnonymized } }),
    db.customerCrmRecord.findMany({ where: { vendorId, customerKeyHash }, select: { id: true } }),
    db.studentPortalAccessToken.count({ where: { vendorId, customerKeyHash } }),
  ]);
  const crmIds = crm.map((row) => row.id);
  const notes = await db.consultantNote.count({ where: { vendorId, customerRecordId: { in: crmIds }, ...notAnonymized } });
  return { submissionIds, bookingIds, orders, blacklistIds, chat, privateChat, posts, replies, crmIds, tokens, notes };
}

export async function anonymizeCustomer(db: PrismaClient, input: AnonymizeCustomerInput): Promise<AnonymizeCustomerCounts> {
  if (!ID_PATTERN.test(input.vendorId) || !HASH_PATTERN.test(input.customerKeyHash)) {
    throw new Error("Invalid vendor or customer identifier.");
  }
  const { vendorId, customerKeyHash } = input;

  const run = async (tx: Db) => {
    const found = await collect(tx, vendorId, customerKeyHash);
    const counts: AnonymizeCustomerCounts = {
      formSubmissions: found.submissionIds.length,
      liveChatMessages: found.chat.length,
      livePrivateChatMessages: found.privateChat.length,
      commerceOrders: found.orders.ids.length,
      legacyOrdersUnreadable: found.orders.unreadable,
      consultationBookings: found.bookingIds.length,
      blacklistEntries: found.blacklistIds.length,
      communityPosts: found.posts,
      communityReplies: found.replies,
      consultantNotes: found.notes,
      studentPortalTokens: found.tokens,
    };
    if (!input.execute) return counts;

    // Every write repeats the vendor predicate; ids came from vendor-scoped reads above.
    for (const id of found.submissionIds) {
      await tx.formSubmission.updateMany({
        where: { id, form: { vendorId } },
        data: { name: ANONYMIZED_NAME, email: anonymizedEmail(id), phone: null, answers: Prisma.DbNull, customerKeyHash: null },
      });
    }
    if (found.chat.length) {
      await tx.liveChatMessage.updateMany({
        where: { vendorId, id: { in: found.chat.map((row) => row.id) } },
        data: { authorName: ANONYMIZED_NAME, body: ANONYMIZED_TEXT },
      });
    }
    for (const message of found.privateChat) {
      const source = message.source === "instructor" ? "instructor" : "viewer";
      await tx.livePrivateChatMessage.updateMany({
        where: { vendorId, id: message.id },
        data: {
          bodyEncrypted: encryptPrivateChatBody(ANONYMIZED_TEXT, {
            vendorId, liveId: message.liveId, submissionId: message.formSubmissionId, messageId: message.id, source,
          }),
        },
      });
    }
    for (const orderId of found.orders.ids) {
      const pii = protectCommerceOrderPii(
        { buyer: { name: ANONYMIZED_NAME, email: anonymizedEmail(orderId) }, shipping: null },
        { vendorId, orderId },
      );
      // Amounts, status, items, payments, refunds and invoice records are kept.
      await tx.commerceOrder.updateMany({
        where: { vendorId, id: orderId },
        data: {
          buyerEncryptedEnvelope: pii.buyerEncrypted,
          buyerMaskedName: ANONYMIZED_NAME,
          buyerMaskedEmail: ANONYMIZED_NAME,
          buyerMaskedPhone: null,
          shippingEncryptedEnvelope: null,
          shippingMaskedSummary: null,
          trackingContextEncrypted: null,
          checkoutIdentityHash: pii.checkoutIdentityHash,
          automationCustomerKeyHash: null,
        },
      });
    }
    for (const id of found.bookingIds) {
      await tx.consultationBooking.updateMany({
        where: { vendorId, id },
        data: {
          clientName: ANONYMIZED_NAME,
          clientEmail: anonymizedEmail(id),
          clientPhone: ANONYMIZED_NAME,
          answers: Prisma.DbNull,
          meetingUrl: null,
          customerKeyHash: null,
        },
      });
    }
    for (const id of found.blacklistIds) {
      // The block can no longer match this person; the merchant is told in the runbook flow.
      await tx.blacklist.updateMany({
        where: { vendorId, id },
        data: { identifier: anonymizedEmail(id), notes: null },
      });
    }
    if (found.posts) {
      await tx.courseCommunityPost.updateMany({
        where: { vendorId, customerKeyHash },
        data: { authorName: ANONYMIZED_NAME, body: ANONYMIZED_TEXT },
      });
    }
    if (found.replies) {
      await tx.courseCommunityReply.updateMany({
        where: { vendorId, customerKeyHash },
        data: { authorName: ANONYMIZED_NAME, body: ANONYMIZED_TEXT },
      });
    }
    if (found.notes) {
      await tx.consultantNote.updateMany({
        where: { vendorId, customerRecordId: { in: found.crmIds } },
        data: { body: ANONYMIZED_TEXT },
      });
    }
    await tx.studentPortalAccessToken.deleteMany({ where: { vendorId, customerKeyHash } });
    return counts;
  };

  return input.execute ? db.$transaction(run, TRANSACTION_OPTIONS) : run(db);
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const { url, target } = resolveAnonymizeTarget();
  const execute = process.argv.includes("--execute");
  if (execute && process.env.ANONYMIZE_CUSTOMER_CONFIRM !== EXECUTE_CONFIRMATION) {
    throw new AnonymizeTargetRefusedError("confirmation-missing");
  }
  const vendorId = argument("--vendor-id") ?? "";
  const email = process.env.ANONYMIZE_CUSTOMER_EMAIL;
  const customerKeyHash = argument("--customer-key-hash") ?? (email ? automationCustomerKeyHash(vendorId, email) : "");

  // Pin the validated URL: dotenv files can no longer change the target.
  const db = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    const vendor = await db.vendor.findUnique({ where: { id: ID_PATTERN.test(vendorId) ? vendorId : "" }, select: { id: true } });
    if (!vendor) throw new Error("Vendor not found.");
    const counts = await anonymizeCustomer(db, { vendorId, customerKeyHash, execute });
    console.log(JSON.stringify({
      mode: execute ? "execute" : "dry-run",
      target,
      ...counts,
      personalDataEmitted: false,
    }));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "failed",
      safeCategory: error instanceof AnonymizeTargetRefusedError ? `target-refused:${error.category}` : "anonymize-customer",
      personalDataEmitted: false,
    }));
    process.exitCode = 1;
  });
}
