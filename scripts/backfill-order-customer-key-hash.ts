/**
 * Backfills CommerceOrder.automationCustomerKeyHash (finding F-175).
 *
 * The column was added by migration 20260908113000 but checkout never wrote
 * it until this fix, so orders placed through checkout cannot be found by the
 * learner portal sign-in, the learner dashboard, course access, payment
 * notifications or the CRM. New checkouts now write the key; this one-off run
 * derives it for existing orders from the encrypted buyer e-mail.
 *
 * Safety (a guard against mistakes, not an access control):
 * - Dry run by default: decrypts in memory only to classify rows and prints
 *   counts per vendor. Writing needs `--apply` AND
 *   BACKFILL_CONFIRM=BACKFILL_ORDER_CUSTOMER_KEY_HASH.
 * - Target: a loopback `celebratedeal_*` database is always allowed. Staging
 *   needs `--target=staging` and a URL that is the staging database. Any other
 *   database needs `--target=production` AND
 *   BACKFILL_PRODUCTION_APPROVAL=OWNER_APPROVED_PRODUCTION_ORDER_KEY_BACKFILL,
 *   which the operator sets only with the owner's explicit approval (dry runs
 *   included, since they decrypt buyer PII). The validated URL is pinned into
 *   the Prisma client.
 * - The key is derived with the app's own helper from the decrypted,
 *   normalized buyer e-mail, exactly as checkout and the portal derive it.
 *   Rows that do not decrypt (e.g. a run with the wrong root key) are never
 *   written and block `--apply` unless `--allow-unreadable` is passed. Rows
 *   that decrypt but hold no valid buyer contact are counted as `invalid`,
 *   never written, and do not block `--apply`. Orders de-identified by
 *   scripts/anonymize-customer.ts (its shared ANONYMIZED_EMAIL_PATTERN) are
 *   skipped so their placeholder address never becomes a lookup key again.
 * - Each write is a compare-and-swap on `automationCustomerKeyHash IS NULL`
 *   AND the exact buyer envelope that was decrypted, bound to the order's own
 *   vendor: an existing key is never overwritten, an envelope replaced
 *   meanwhile (e.g. by a concurrent de-identification) is left alone and
 *   counted as `changed`, a rerun is a no-op, and an interrupted run resumes
 *   where it stopped.
 * - `--write-ids <path>` (with `--apply`) appends the ID of every order this
 *   run wrote, one per line, so the run can be reverted exactly.
 * - Never prints e-mail addresses, names or key hashes; vendor IDs and counts
 *   only.
 *
 * Usage (the target environment's root key must be injected by the operator):
 *   DATABASE_URL=<staging> node --import tsx scripts/backfill-order-customer-key-hash.ts --target=staging
 *   BACKFILL_CONFIRM=BACKFILL_ORDER_CUSTOMER_KEY_HASH DATABASE_URL=<staging> \
 *     node --import tsx scripts/backfill-order-customer-key-hash.ts --target=staging --apply --write-ids <path>
 * Options: --batch-size <1-500> (default 100), --vendor-id <id> (one tenant),
 *          --allow-unreadable, --write-ids <path>.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { CommerceOrderPiiValidationError, revealCommerceOrderPii } from "../src/lib/commerce-order-pii";
import { automationCustomerKeyHash } from "../src/lib/customer-key-hash";
import { isStagingDatabaseUrl } from "../src/lib/database-identity";
import { ANONYMIZED_EMAIL_PATTERN } from "./anonymize-customer";
import { classifyLocalTestDatabase } from "./local-database-safety";

export const APPLY_CONFIRMATION = "BACKFILL_ORDER_CUSTOMER_KEY_HASH";
export const PRODUCTION_APPROVAL = "OWNER_APPROVED_PRODUCTION_ORDER_KEY_BACKFILL";
const DEFAULT_BATCH_SIZE = 100;

type Environment = Readonly<Record<string, string | undefined>>;
type Db = Pick<PrismaClient, "commerceOrder">;

export class OrderKeyBackfillRefusedError extends Error {
  constructor(public readonly category: string) {
    super("Order customer key backfill refused.");
    this.name = "OrderKeyBackfillRefusedError";
  }
}

export type OrderKeyBackfillOptions = {
  apply: boolean;
  target: "loopback" | "staging" | "production" | null;
  batchSize: number;
  allowUnreadable: boolean;
  vendorId: string | null;
  writeIds: string | null;
};

export function parseOrderKeyBackfillArguments(argv: readonly string[]): OrderKeyBackfillOptions {
  const options: OrderKeyBackfillOptions = { apply: false, target: null, batchSize: DEFAULT_BATCH_SIZE, allowUnreadable: false, vendorId: null, writeIds: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--apply") options.apply = true;
    else if (argument === "--allow-unreadable") options.allowUnreadable = true;
    else if (argument.startsWith("--target=")) {
      const target = argument.slice("--target=".length);
      if (target !== "loopback" && target !== "staging" && target !== "production") throw new OrderKeyBackfillRefusedError("invalid-target");
      options.target = target;
    } else if (argument === "--batch-size") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 500) throw new OrderKeyBackfillRefusedError("invalid-batch-size");
      options.batchSize = value;
      index += 1;
    } else if (argument === "--vendor-id") {
      const value = argv[index + 1]?.trim();
      if (!value || value.length > 191 || /[\s\u0000-\u001f\u007f]/u.test(value)) throw new OrderKeyBackfillRefusedError("invalid-vendor-id");
      options.vendorId = value;
      index += 1;
    } else if (argument === "--write-ids") {
      const value = argv[index + 1]?.trim();
      if (!value || value.startsWith("--") || /[\u0000-\u001f\u007f]/u.test(value)) throw new OrderKeyBackfillRefusedError("invalid-write-ids");
      options.writeIds = value;
      index += 1;
    } else {
      throw new OrderKeyBackfillRefusedError("unknown-argument");
    }
  }
  if (options.writeIds && !options.apply) throw new OrderKeyBackfillRefusedError("write-ids-without-apply");
  return options;
}

/** Returns the database URL the tool may use, or throws a safe category. */
export function resolveOrderKeyBackfillTarget(env: Environment, target: OrderKeyBackfillOptions["target"]) {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new OrderKeyBackfillRefusedError("missing");
  if (classifyLocalTestDatabase(url).safe) {
    if (target !== null && target !== "loopback") throw new OrderKeyBackfillRefusedError("target-mismatch");
    return { url, target: "loopback" as const };
  }
  if (target === "staging") {
    if (!isStagingDatabaseUrl(url)) throw new OrderKeyBackfillRefusedError("not-staging");
    return { url, target: "staging" as const };
  }
  if (target === "production") {
    if (isStagingDatabaseUrl(url)) throw new OrderKeyBackfillRefusedError("target-mismatch");
    if (env.BACKFILL_PRODUCTION_APPROVAL !== PRODUCTION_APPROVAL) throw new OrderKeyBackfillRefusedError("production-not-approved");
    return { url, target: "production" as const };
  }
  throw new OrderKeyBackfillRefusedError("remote-without-target");
}

/** Tests (and a targeted manual run) may restrict the scan to given vendors. */
export type OrderKeyBackfillScope = { vendorIds?: readonly string[] };

type MissingOrder = { id: string; vendorId: string; buyerEncryptedEnvelope: string };
type Classified =
  | { kind: "computable"; customerKeyHash: string }
  | { kind: "anonymized" | "unreadable" | "invalid" };

/** Decrypts in memory only; the e-mail never leaves this function. */
function classify(order: MissingOrder): Classified {
  let email: string;
  try {
    email = revealCommerceOrderPii({ buyerEncrypted: order.buyerEncryptedEnvelope, shippingEncrypted: null }, { vendorId: order.vendorId, orderId: order.id }).buyer.email;
  } catch (error) {
    // Decrypted fine but is not a valid buyer contact: nothing to derive, and
    // unlike a key problem it says nothing about the run's root secret.
    if (error instanceof CommerceOrderPiiValidationError) return { kind: "invalid" };
    return { kind: "unreadable" };
  }
  if (ANONYMIZED_EMAIL_PATTERN.test(email)) return { kind: "anonymized" };
  try {
    return { kind: "computable", customerKeyHash: automationCustomerKeyHash(order.vendorId, email) };
  } catch {
    return { kind: "invalid" };
  }
}

/** Cursor-paged scan over orders still missing the key, so a large table never loads at once. */
async function forEachMissingOrder(
  db: Db,
  batchSize: number,
  scope: OrderKeyBackfillScope,
  visit: (order: MissingOrder) => Promise<void> | void,
) {
  let cursor: string | undefined;
  while (true) {
    const orders = await db.commerceOrder.findMany({
      where: {
        automationCustomerKeyHash: null,
        ...(scope.vendorIds ? { vendorId: { in: [...scope.vendorIds] } } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, vendorId: true, buyerEncryptedEnvelope: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    for (const order of orders) await visit(order);
    cursor = orders.at(-1)?.id;
    if (orders.length < batchSize) return;
  }
}

type VendorCounts = { vendorId: string; missing: number; computable: number; anonymized: number; unreadable: number; invalid: number };
function emptyCounts(vendorId: string): VendorCounts {
  return { vendorId, missing: 0, computable: 0, anonymized: 0, unreadable: 0, invalid: 0 };
}

/** Read-only: counts orders missing the key, per vendor and by outcome. */
export async function planOrderKeyBackfill(db: Db, batchSize = DEFAULT_BATCH_SIZE, scope: OrderKeyBackfillScope = {}) {
  const byVendor = new Map<string, VendorCounts>();
  await forEachMissingOrder(db, batchSize, scope, (order) => {
    const counts = byVendor.get(order.vendorId) ?? emptyCounts(order.vendorId);
    counts.missing += 1;
    counts[classify(order).kind] += 1;
    byVendor.set(order.vendorId, counts);
  });
  const vendors = [...byVendor.values()].sort((a, b) => a.vendorId.localeCompare(b.vendorId));
  const total = vendors.reduce((sum, row) => ({
    missing: sum.missing + row.missing, computable: sum.computable + row.computable, anonymized: sum.anonymized + row.anonymized,
    unreadable: sum.unreadable + row.unreadable, invalid: sum.invalid + row.invalid,
  }), { missing: 0, computable: 0, anonymized: 0, unreadable: 0, invalid: 0 });
  return { ...total, vendors };
}

/**
 * Writes the key on every computable order still missing it. `changed` counts
 * rows that, between the read and the compare-and-swap, gained a key or had
 * their buyer envelope replaced (a concurrent writer such as
 * anonymize-customer); they are left as they are. `onUpdated` receives the ID
 * of each order this call actually wrote.
 */
export async function backfillOrderCustomerKeyHash(
  db: Db,
  batchSize = DEFAULT_BATCH_SIZE,
  scope: OrderKeyBackfillScope = {},
  onUpdated: (orderId: string) => void = () => undefined,
) {
  const result = { updated: 0, changed: 0, anonymized: 0, unreadable: 0, invalid: 0 };
  await forEachMissingOrder(db, batchSize, scope, async (order) => {
    const outcome = classify(order);
    if (outcome.kind !== "computable") {
      result[outcome.kind] += 1;
      return;
    }
    const written = await db.commerceOrder.updateMany({
      where: { id: order.id, vendorId: order.vendorId, automationCustomerKeyHash: null, buyerEncryptedEnvelope: order.buyerEncryptedEnvelope },
      data: { automationCustomerKeyHash: outcome.customerKeyHash },
    });
    if (written.count === 1) {
      result.updated += 1;
      onUpdated(order.id);
    } else {
      result.changed += 1;
    }
  });
  return result;
}

export async function runOrderKeyBackfill(db: Db, options: OrderKeyBackfillOptions, env: Environment, scope: OrderKeyBackfillScope = {}) {
  const effectiveScope = options.vendorId ? { vendorIds: [options.vendorId] } : scope;
  const plan = await planOrderKeyBackfill(db, options.batchSize, effectiveScope);
  if (!options.apply) return { mode: "plan" as const, ...plan };
  if (env.BACKFILL_CONFIRM !== APPLY_CONFIRMATION) throw new OrderKeyBackfillRefusedError("confirmation-missing");
  if (plan.unreadable > 0 && !options.allowUnreadable) throw new OrderKeyBackfillRefusedError("unreadable-rows");
  // Opened for append before the first write, so an unwritable path fails the
  // run before any order changes; each ID is written as soon as its row lands.
  let idsFd: number | null = null;
  if (options.writeIds) {
    try {
      idsFd = fs.openSync(options.writeIds, "a");
      // Windows opens a directory for append without error; only a regular file will do.
      if (!fs.fstatSync(idsFd).isFile()) throw new Error("not a regular file");
    } catch {
      if (idsFd !== null) fs.closeSync(idsFd);
      throw new OrderKeyBackfillRefusedError("write-ids-unwritable");
    }
  }
  const fd = idsFd;
  let result: Awaited<ReturnType<typeof backfillOrderCustomerKeyHash>>;
  try {
    result = await backfillOrderCustomerKeyHash(db, options.batchSize, effectiveScope,
      fd === null ? undefined : (orderId) => { fs.writeSync(fd, `${orderId}\n`); });
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  const after = await planOrderKeyBackfill(db, options.batchSize, effectiveScope);
  return { mode: "apply" as const, ...result, remainingComputable: after.computable, remainingMissing: after.missing };
}

async function main() {
  let category = "unexpected";
  try {
    const options = parseOrderKeyBackfillArguments(process.argv.slice(2));
    const { url, target } = resolveOrderKeyBackfillTarget(process.env, options.target);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    try {
      category = "run";
      const outcome = await runOrderKeyBackfill(db, options, process.env);
      console.log(JSON.stringify({ status: "ok", target, batchSize: options.batchSize, ...outcome, secretDetailsEmitted: false }));
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    if (error instanceof OrderKeyBackfillRefusedError) category = error.category;
    console.error(JSON.stringify({ status: "failed", safeCategory: `order-key-backfill:${category}`, secretDetailsEmitted: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
