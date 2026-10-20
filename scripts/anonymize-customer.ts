/**
 * F-070 / B04-17: personal-data request tool (deletion / de-identification).
 *
 * Locates one customer of one vendor by the vendor-bound customerKeyHash and
 * overwrites the customer's PII with fixed placeholders. Financial rows
 * (orders, payments, refunds, commissions, invoices) are kept; only the
 * buyer / shipping contact data on them is replaced. See
 * docs/operations/personal-data-request-runbook.md.
 *
 * Safety:
 * - Dry run by default: prints counts only. `--execute` is required to write.
 * - Never prints names, emails, phones, message bodies or the hash itself.
 * - Runs only against a loopback `celebratedeal_*` database, or inside the
 *   approved GitHub Actions workflow (GITHUB_ACTIONS=true and
 *   PERSONAL_DATA_REQUEST_WORKFLOW=true). Every other target is refused
 *   before connecting.
 *
 * Usage:
 *   npx tsx scripts/anonymize-customer.ts --vendor-id <id> --customer-key-hash <hash> [--execute]
 *   ANONYMIZE_CUSTOMER_EMAIL=<email> npx tsx scripts/anonymize-customer.ts --vendor-id <id> [--execute]
 *     (the email is read from the environment so it never lands in shell history
 *      or process listings; the hash is derived with the app's own key)
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { automationCustomerKeyHash } from "../src/lib/automation-workflow";
import { protectCommerceOrderPii } from "../src/lib/commerce-order-pii";
import { encryptPrivateChatBody } from "../src/lib/live-private-chat-storage";
import { classifyLocalTestDatabase } from "./local-database-safety";

export const ANONYMIZED_NAME = "已去識別化";
export const ANONYMIZED_TEXT = "此內容已依個資請求移除";
const LEGACY_SCAN_PAGE = 500;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 120_000,
} as const;

export class AnonymizeTargetRefusedError extends Error {
  constructor(public readonly category: string) {
    super("Personal-data request target refused.");
    this.name = "AnonymizeTargetRefusedError";
  }
}

/** Refuses any database except a disposable loopback one or the approved workflow. */
export function assertAnonymizeTarget(env: Readonly<Record<string, string | undefined>> = process.env) {
  const local = classifyLocalTestDatabase(env.DATABASE_URL);
  if (local.safe) return "loopback" as const;
  if (env.GITHUB_ACTIONS === "true" && env.PERSONAL_DATA_REQUEST_WORKFLOW === "true") return "workflow" as const;
  throw new AnonymizeTargetRefusedError(local.category);
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
  consultationBookings: number;
  communityPosts: number;
  communityReplies: number;
  consultantNotes: number;
  studentPortalTokens: number;
};

/** Rows with a stored hash, plus legacy rows (hash NULL) whose email hashes to it. */
async function matchingSubmissionIds(db: Db, vendorId: string, customerKeyHash: string) {
  const direct = await db.formSubmission.findMany({
    where: { form: { vendorId }, customerKeyHash },
    select: { id: true },
  });
  const ids = new Set(direct.map((row) => row.id));
  let cursor: string | undefined;
  while (true) {
    const legacy = await db.formSubmission.findMany({
      where: { form: { vendorId }, customerKeyHash: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, email: true },
      orderBy: { id: "asc" },
      take: LEGACY_SCAN_PAGE,
    });
    for (const row of legacy) {
      if (safeHash(vendorId, row.email) === customerKeyHash) ids.add(row.id);
    }
    cursor = legacy.at(-1)?.id;
    if (legacy.length < LEGACY_SCAN_PAGE) break;
  }
  return [...ids];
}

async function matchingBookingIds(db: Db, vendorId: string, customerKeyHash: string) {
  const direct = await db.consultationBooking.findMany({ where: { vendorId, customerKeyHash }, select: { id: true } });
  const ids = new Set(direct.map((row) => row.id));
  let cursor: string | undefined;
  while (true) {
    const legacy = await db.consultationBooking.findMany({
      where: { vendorId, customerKeyHash: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, clientEmail: true },
      orderBy: { id: "asc" },
      take: LEGACY_SCAN_PAGE,
    });
    for (const row of legacy) {
      if (safeHash(vendorId, row.clientEmail) === customerKeyHash) ids.add(row.id);
    }
    cursor = legacy.at(-1)?.id;
    if (legacy.length < LEGACY_SCAN_PAGE) break;
  }
  return [...ids];
}

function safeHash(vendorId: string, email: string) {
  try {
    return automationCustomerKeyHash(vendorId, email);
  } catch {
    // Already-anonymized or malformed legacy email: cannot belong to the request.
    return null;
  }
}

async function collect(db: Db, vendorId: string, customerKeyHash: string) {
  const submissionIds = await matchingSubmissionIds(db, vendorId, customerKeyHash);
  const bookingIds = await matchingBookingIds(db, vendorId, customerKeyHash);
  const [chat, privateChat, orders, posts, replies, crm, tokens] = await Promise.all([
    db.liveChatMessage.findMany({ where: { vendorId, formSubmissionId: { in: submissionIds } }, select: { id: true } }),
    db.livePrivateChatMessage.findMany({
      where: { vendorId, formSubmissionId: { in: submissionIds } },
      select: { id: true, liveId: true, formSubmissionId: true, source: true },
    }),
    db.commerceOrder.findMany({ where: { vendorId, automationCustomerKeyHash: customerKeyHash }, select: { id: true } }),
    db.courseCommunityPost.findMany({ where: { vendorId, customerKeyHash }, select: { id: true, productId: true } }),
    db.courseCommunityReply.findMany({ where: { vendorId, customerKeyHash }, select: { id: true, productId: true, postId: true } }),
    db.customerCrmRecord.findMany({ where: { vendorId, customerKeyHash }, select: { id: true } }),
    db.studentPortalAccessToken.count({ where: { vendorId, customerKeyHash } }),
  ]);
  const notes = await db.consultantNote.count({ where: { vendorId, customerRecordId: { in: crm.map((row) => row.id) } } });
  return { submissionIds, bookingIds, chat, privateChat, orders, posts, replies, crm, tokens, notes };
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
      commerceOrders: found.orders.length,
      consultationBookings: found.bookingIds.length,
      communityPosts: found.posts.length,
      communityReplies: found.replies.length,
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
    for (const order of found.orders) {
      const pii = protectCommerceOrderPii(
        { buyer: { name: ANONYMIZED_NAME, email: anonymizedEmail(order.id) }, shipping: null },
        { vendorId, orderId: order.id },
      );
      // Amounts, status, items, payments, refunds and invoice records are kept.
      await tx.commerceOrder.updateMany({
        where: { vendorId, id: order.id },
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
    if (found.posts.length) {
      await tx.courseCommunityPost.updateMany({
        where: { vendorId, customerKeyHash },
        data: { authorName: ANONYMIZED_NAME, body: ANONYMIZED_TEXT },
      });
    }
    if (found.replies.length) {
      await tx.courseCommunityReply.updateMany({
        where: { vendorId, customerKeyHash },
        data: { authorName: ANONYMIZED_NAME, body: ANONYMIZED_TEXT },
      });
    }
    if (found.notes) {
      await tx.consultantNote.updateMany({
        where: { vendorId, customerRecordId: { in: found.crm.map((row) => row.id) } },
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
  const target = assertAnonymizeTarget();
  const execute = process.argv.includes("--execute");
  const vendorId = argument("--vendor-id") ?? "";
  const email = process.env.ANONYMIZE_CUSTOMER_EMAIL;
  const customerKeyHash = argument("--customer-key-hash") ?? (email ? automationCustomerKeyHash(vendorId, email) : "");

  const db = new PrismaClient({ log: [] });
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
