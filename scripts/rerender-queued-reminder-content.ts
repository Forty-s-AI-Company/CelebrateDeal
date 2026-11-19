/**
 * Re-renders the content of fixed-time live e-mails that were queued before
 * the A2-13 recipient-name fix (#670) and have not been sent yet (A3-03).
 *
 * Delivery rows store their subject and body encrypted at queue time
 * (`EmailDelivery.payloadEncryptedEnvelope`) and are never re-rendered at send
 * time, so a `live_reminder`, `before_live` or `during_live` row queued before
 * #670 still carries the registrant's raw `{{name}}` (possibly a link). This
 * tool rewrites that content in place. It never changes a row's status,
 * schedule, attempts or identity: the #670 first draft marked rows
 * `superseded` and relied on the reminder reconcile to rebuild them, which
 * could lose them for good; this one only swaps the content.
 *
 * How a row is judged (everything bound to the row's own vendor):
 * - Scope: trigger `live_reminder` / `before_live` / `during_live`, status
 *   `queued` or `failed` (still waiting to be sent or retried).
 * - The source is read again: the Live (and its vendor name), the row's own
 *   template (`sourceTemplateId`), the VERIFIED registration (name, chosen
 *   session) and, for a notification, its rule (from the idempotency key).
 *   The row's deterministic id must equal the id those sources produce now
 *   (live-reminder-delivery-identity.ts), which proves the template, title,
 *   slug, schedule anchor and offset it was rendered from; otherwise `stale`.
 * - The stored subject and body are compared with two renderings of that
 *   source, both reusing the stored recipient address, sender brand and
 *   personal watch link: the pre-#670 one (raw name) and the current one
 *   (`renderMessageTemplate`, i.e. `safeRecipientName`). Equal to the current
 *   one: `alreadySafe`, nothing to do (a clean name renders the same both
 *   ways). Equal to the pre-#670 one only: `needsRewrite`. Neither:
 *   `unrecognized`, never written (for example the vendor was renamed after
 *   queueing, or this run's NEXT_PUBLIC_APP_URL, signing keys or ICU differ
 *   from the server that queued it). So a write only ever replaces content
 *   this run reproduced exactly, and the replacement differs only in how the
 *   name is rendered.
 * - Each write is one compare-and-set UPDATE on: id, vendorId, trigger, the
 *   status read, the exact encrypted envelope read and the `updatedAt` read.
 *   It sets only `payloadEncryptedEnvelope` and moves `updatedAt` forward, so
 *   a dispatcher that read the row before the write loses its own
 *   `updatedAt` claim and re-reads the new content on its next round. A row
 *   claimed, sent, superseded or rewritten in between is left alone and
 *   counted as `raced`. A rerun finds rewritten rows `alreadySafe` and writes
 *   nothing; an interrupted run is simply run again.
 *
 * Safety (a guard against mistakes, not an access control):
 * - Dry run by default (decrypts in memory to classify, writes nothing).
 *   Writing needs `--apply` AND RERENDER_CONFIRM=RERENDER_QUEUED_REMINDER_CONTENT.
 * - Target: a loopback `celebratedeal_*` database is always allowed. Staging
 *   needs `--target=staging` and the staging database URL. Any other database
 *   needs `--target=production` AND
 *   RERENDER_PRODUCTION_APPROVAL=OWNER_APPROVED_PRODUCTION_REMINDER_RERENDER,
 *   which the operator sets only with the owner's explicit approval (dry runs
 *   included, since they decrypt recipient e-mails and names).
 * - NEXT_PUBLIC_APP_URL and the root secret must be the target environment's
 *   own values (injected by the operator; this tool reads no .env file).
 * - Prints vendor IDs and counts only: never names, e-mails or content.
 *
 * Usage:
 *   DATABASE_URL=<staging> NEXT_PUBLIC_APP_URL=<staging app url> \
 *     node --import tsx scripts/rerender-queued-reminder-content.ts --target=staging
 *   RERENDER_CONFIRM=RERENDER_QUEUED_REMINDER_CONTENT DATABASE_URL=<staging> NEXT_PUBLIC_APP_URL=<staging app url> \
 *     node --import tsx scripts/rerender-queued-reminder-content.ts --target=staging --apply
 * Options: --batch-size <1-500> (default 100), --vendor-id <id> (one tenant).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { isStagingDatabaseUrl } from "../src/lib/database-identity";
import { createEmailUnsubscribeUrl, protectEmailDeliveryPayload, revealEmailDeliveryPayload } from "../src/lib/email-delivery-pii";
import { ensureEmailUnsubscribeFooter, formatLiveStartAt } from "../src/lib/email-delivery-format";
import { liveNotificationIdentityFromKey } from "../src/lib/live-notification-identity";
import { createLiveViewerUrl } from "../src/lib/live-public-url";
import { stableLiveNotificationDeliveryId, stableLiveReminderDeliveryId } from "../src/lib/live-reminder-delivery-identity";
import { appendPersonalWatchLink, PERSONAL_WATCH_LINK_LABEL } from "../src/lib/live-watch-link-token";
import { renderMessageTemplate, type MessageTemplateVariables } from "../src/lib/message-template";
import { classifyLocalTestDatabase } from "./local-database-safety";

export const APPLY_CONFIRMATION = "RERENDER_QUEUED_REMINDER_CONTENT";
export const PRODUCTION_APPROVAL = "OWNER_APPROVED_PRODUCTION_REMINDER_RERENDER";
export const RERENDER_TRIGGERS = ["live_reminder", "before_live", "during_live"] as const;
export const RERENDER_STATUSES = ["queued", "failed"] as const;
const DEFAULT_BATCH_SIZE = 100;

type Environment = Readonly<Record<string, string | undefined>>;
type Db = Pick<PrismaClient, "emailDelivery" | "live" | "formSubmission" | "messageTemplate" | "liveNotificationRule">;

export class ReminderRerenderRefusedError extends Error {
  constructor(public readonly category: string) {
    super("Queued reminder re-render refused.");
    this.name = "ReminderRerenderRefusedError";
  }
}

export type ReminderRerenderOptions = {
  apply: boolean;
  target: "loopback" | "staging" | "production" | null;
  batchSize: number;
  vendorId: string | null;
};

export function parseReminderRerenderArguments(argv: readonly string[]): ReminderRerenderOptions {
  const options: ReminderRerenderOptions = { apply: false, target: null, batchSize: DEFAULT_BATCH_SIZE, vendorId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--apply") options.apply = true;
    else if (argument.startsWith("--target=")) {
      const target = argument.slice("--target=".length);
      if (target !== "loopback" && target !== "staging" && target !== "production") throw new ReminderRerenderRefusedError("invalid-target");
      options.target = target;
    } else if (argument === "--batch-size") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 500) throw new ReminderRerenderRefusedError("invalid-batch-size");
      options.batchSize = value;
      index += 1;
    } else if (argument === "--vendor-id") {
      const value = argv[index + 1]?.trim();
      if (!value || value.startsWith("--") || value.length > 191 || /[\s\u0000-\u001f\u007f]/u.test(value)) {
        throw new ReminderRerenderRefusedError("invalid-vendor-id");
      }
      options.vendorId = value;
      index += 1;
    } else {
      throw new ReminderRerenderRefusedError("unknown-argument");
    }
  }
  return options;
}

/** Returns the database URL the tool may use, or throws a safe category. */
export function resolveReminderRerenderTarget(env: Environment, target: ReminderRerenderOptions["target"]) {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new ReminderRerenderRefusedError("missing");
  if (classifyLocalTestDatabase(url).safe) {
    if (target !== null && target !== "loopback") throw new ReminderRerenderRefusedError("target-mismatch");
    return { url, target: "loopback" as const };
  }
  if (target === "staging") {
    if (!isStagingDatabaseUrl(url)) throw new ReminderRerenderRefusedError("not-staging");
    return { url, target: "staging" as const };
  }
  if (target === "production") {
    if (isStagingDatabaseUrl(url)) throw new ReminderRerenderRefusedError("target-mismatch");
    if (env.RERENDER_PRODUCTION_APPROVAL !== PRODUCTION_APPROVAL) throw new ReminderRerenderRefusedError("production-not-approved");
    return { url, target: "production" as const };
  }
  throw new ReminderRerenderRefusedError("remote-without-target");
}

/** Tests (and a targeted manual run) may restrict the scan to given vendors. */
export type ReminderRerenderScope = { vendorIds?: readonly string[] };

/** Test seam: runs between a row's read and its compare-and-set. */
export type ReminderRerenderHooks = { beforeCompareAndSet?: (row: { id: string; vendorId: string }) => Promise<void> };

const ROW_SELECT = {
  id: true,
  vendorId: true,
  trigger: true,
  status: true,
  sourceLiveId: true,
  sourceFormSubmissionId: true,
  sourceTemplateId: true,
  idempotencyKey: true,
  payloadEncryptedEnvelope: true,
  updatedAt: true,
} as const;

type QueuedRow = {
  id: string;
  vendorId: string;
  trigger: string;
  status: string;
  sourceLiveId: string | null;
  sourceFormSubmissionId: string | null;
  sourceTemplateId: string;
  idempotencyKey: string;
  payloadEncryptedEnvelope: string;
  updatedAt: Date;
};

type RenderSource = {
  subjectTemplate: string;
  bodyTemplate: string;
  recipientName: string;
  variables: Omit<MessageTemplateVariables, "name">;
};

type Content = { subject: string; body: string };

// The pre-#670 renderer: the same allowlist in one pass, `{{name}}` verbatim.
const RENDERABLE_VARIABLE = /\{\{\s*(name|live_title|live_url|live_start_at|vendor_name|unsubscribe_url)\s*\}\}/gu;
function renderLegacy(value: string, variables: MessageTemplateVariables) {
  return value.replace(RENDERABLE_VARIABLE, (_, variable: keyof MessageTemplateVariables) => variables[variable]);
}

/**
 * The personal watch link (Q-17) the row was queued with. Its token embeds the
 * queue time, so it cannot be produced again; the stored one is kept. Null
 * when the body has none (queued before Q-17). A wrong guess only makes the
 * renderings differ from the stored body, i.e. `unrecognized`.
 */
function storedPersonalWatchUrl(body: string) {
  const marker = `${PERSONAL_WATCH_LINK_LABEL}：`;
  const index = body.lastIndexOf(marker);
  if (index < 0 || (index > 0 && body.slice(index - 2, index) !== "\n\n")) return null;
  const url = body.slice(index + marker.length).split("\n", 1)[0];
  return url ? url : null;
}

/** The composition ensureLiveReminderDelivery and the notification materializer use. */
function compose(source: RenderSource, render: typeof renderLegacy, watchUrl: string | null): Content {
  const variables = { ...source.variables, name: source.recipientName };
  const rendered = render(source.bodyTemplate, variables);
  return {
    subject: render(source.subjectTemplate, variables).replace(/\s+/gu, " ").trim(),
    body: ensureEmailUnsubscribeFooter(watchUrl ? appendPersonalWatchLink(rendered, watchUrl) : rendered, variables.unsubscribe_url),
  };
}

const sameTime = (left: Date, right: Date) => left.getTime() === right.getTime();

/**
 * Every source the row could have been rendered from that yields the row's own
 * id now. Empty when anything is missing, belongs to another vendor or no
 * longer produces that id. Each read is bound to the row's vendor.
 */
async function renderSources(db: Db, row: QueuedRow): Promise<RenderSource[]> {
  if (!row.sourceLiveId || !row.sourceFormSubmissionId) return [];
  const vendorId = row.vendorId;
  const liveId = row.sourceLiveId;
  const [live, template, submission] = await Promise.all([
    db.live.findFirst({
      where: { id: liveId, vendorId },
      select: { id: true, slug: true, title: true, scheduledAt: true, startedAt: true, liveReminderOffsetMinutes: true, vendor: { select: { name: true } } },
    }),
    db.messageTemplate.findFirst({ where: { id: row.sourceTemplateId, vendorId }, select: { id: true, subject: true, body: true } }),
    db.formSubmission.findFirst({
      where: { id: row.sourceFormSubmissionId, liveId, verificationStatus: "VERIFIED", form: { vendorId } },
      select: { id: true, name: true, liveSession: { select: { vendorId: true, liveId: true, startAt: true } } },
    }),
  ]);
  if (!live || !template?.subject || !submission) return [];
  const templateSource = { id: template.id, subject: template.subject, body: template.body };
  const session = submission.liveSession && submission.liveSession.vendorId === vendorId && submission.liveSession.liveId === liveId
    ? submission.liveSession
    : null;
  const base = { vendorId, liveId, liveSlug: live.slug, liveTitle: live.title, formSubmissionId: submission.id, template: templateSource };

  // (anchor in the id, time shown as {{live_start_at}}): the shared schedule,
  // or the registrant's own fixed session (指定場次).
  let candidates: Array<{ id: string; startAt: Date }> = [];
  if (row.trigger === "live_reminder") {
    candidates = [live.scheduledAt, ...(session ? [session.startAt] : [])].map((startAt) => ({
      id: stableLiveReminderDeliveryId({ ...base, liveScheduledAt: startAt, reminderOffsetMinutes: live.liveReminderOffsetMinutes }),
      startAt,
    }));
  } else {
    const identity = liveNotificationIdentityFromKey(row.idempotencyKey);
    if (!identity || identity.trigger !== row.trigger) return [];
    const rule = await db.liveNotificationRule.findFirst({
      where: { id: identity.ruleId, vendorId, liveId, trigger: identity.trigger },
      select: { id: true, offsetMinutes: true },
    });
    if (!rule) return [];
    const shared = identity.trigger === "before_live" ? live.scheduledAt : live.startedAt;
    const pairs = [
      ...(shared ? [{ anchor: shared, startAt: live.scheduledAt }] : []),
      ...(session ? [{ anchor: session.startAt, startAt: session.startAt }] : []),
    ];
    candidates = pairs.map(({ anchor, startAt }) => ({
      id: stableLiveNotificationDeliveryId({ ...base, ruleId: rule.id, trigger: identity.trigger, offsetMinutes: rule.offsetMinutes, anchor }),
      startAt,
    }));
  }
  const startTimes: Date[] = [];
  for (const candidate of candidates) {
    if (candidate.id === row.id && !startTimes.some((startAt) => sameTime(startAt, candidate.startAt))) startTimes.push(candidate.startAt);
  }
  return startTimes.map((startAt) => ({
    subjectTemplate: templateSource.subject,
    bodyTemplate: templateSource.body,
    recipientName: submission.name,
    variables: {
      live_title: live.title,
      live_url: createLiveViewerUrl(live.slug),
      live_start_at: formatLiveStartAt(startAt),
      vendor_name: live.vendor.name,
      unsubscribe_url: createEmailUnsubscribeUrl(row.id),
    },
  }));
}

type Stored = ReturnType<typeof revealEmailDeliveryPayload>;
type Classified =
  | { kind: "needsRewrite"; stored: Stored; next: Content }
  | { kind: "alreadySafe" | "unrecognized" | "stale" | "unreadable" };

/** Decrypts in memory only; nothing read here leaves this module except a category. */
async function classify(db: Db, row: QueuedRow): Promise<Classified> {
  let stored: Stored;
  try {
    stored = revealEmailDeliveryPayload(row.payloadEncryptedEnvelope, { vendorId: row.vendorId, deliveryId: row.id });
  } catch {
    return { kind: "unreadable" };
  }
  const sources = await renderSources(db, row);
  if (sources.length === 0) return { kind: "stale" };
  const watchUrl = storedPersonalWatchUrl(stored.body);
  const equals = (content: Content) => content.subject === stored.subject && content.body === stored.body;
  for (const source of sources) {
    const current = compose(source, renderMessageTemplate, watchUrl);
    if (equals(current)) return { kind: "alreadySafe" };
    if (equals(compose(source, renderLegacy, watchUrl))) return { kind: "needsRewrite", stored, next: current };
  }
  return { kind: "unrecognized" };
}

export type VendorCounts = {
  vendorId: string;
  scanned: number;
  needsRewrite: number;
  rewritten: number;
  raced: number;
  alreadySafe: number;
  unrecognized: number;
  stale: number;
  unreadable: number;
  unrenderable: number;
};
type Counter = Exclude<keyof VendorCounts, "vendorId">;
const COUNTERS: readonly Counter[] = ["scanned", "needsRewrite", "rewritten", "raced", "alreadySafe", "unrecognized", "stale", "unreadable", "unrenderable"];

function emptyCounts(vendorId: string): VendorCounts {
  return { vendorId, scanned: 0, needsRewrite: 0, rewritten: 0, raced: 0, alreadySafe: 0, unrecognized: 0, stale: 0, unreadable: 0, unrenderable: 0 };
}

const pendingWhere = { trigger: { in: [...RERENDER_TRIGGERS] }, status: { in: [...RERENDER_STATUSES] } };

/** The next vendor (by id) that still has rows in scope; one vendor is processed at a time. */
async function nextVendorId(db: Db, after: string | null, scope: ReminderRerenderScope) {
  const vendorFilter: Prisma.StringFilter = {};
  if (after !== null) vendorFilter.gt = after;
  if (scope.vendorIds) vendorFilter.in = [...scope.vendorIds];
  const row = await db.emailDelivery.findFirst({
    where: { ...pendingWhere, vendorId: vendorFilter },
    orderBy: { vendorId: "asc" },
    select: { vendorId: true },
  });
  return row?.vendorId ?? null;
}

async function processVendor(db: Db, vendorId: string, options: ReminderRerenderOptions, hooks: ReminderRerenderHooks) {
  const counts = emptyCounts(vendorId);
  let cursor: string | undefined;
  while (true) {
    const rows: QueuedRow[] = await db.emailDelivery.findMany({
      where: { ...pendingWhere, vendorId, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: options.batchSize,
      select: ROW_SELECT,
    });
    for (const row of rows) {
      counts.scanned += 1;
      const outcome = await classify(db, row);
      if (outcome.kind !== "needsRewrite") {
        counts[outcome.kind] += 1;
        continue;
      }
      counts.needsRewrite += 1;
      if (!options.apply) continue;
      let envelope: string;
      try {
        // Same recipient and sender brand as stored; only subject and body change.
        envelope = protectEmailDeliveryPayload({
          recipientEmail: outcome.stored.recipientEmail,
          subject: outcome.next.subject,
          body: outcome.next.body,
          ...(outcome.stored.brand ? { brand: outcome.stored.brand } : {}),
        }, { vendorId: row.vendorId, deliveryId: row.id }).payloadEncryptedEnvelope;
      } catch {
        counts.unrenderable += 1;
        continue;
      }
      await hooks.beforeCompareAndSet?.({ id: row.id, vendorId: row.vendorId });
      const written = await db.emailDelivery.updateMany({
        where: {
          id: row.id,
          vendorId: row.vendorId,
          trigger: row.trigger,
          status: row.status,
          payloadEncryptedEnvelope: row.payloadEncryptedEnvelope,
          updatedAt: row.updatedAt,
        },
        // Strictly later than the value read, so a dispatcher's updatedAt claim taken before this write fails.
        data: { payloadEncryptedEnvelope: envelope, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) },
      });
      if (written.count === 1) counts.rewritten += 1;
      else counts.raced += 1;
    }
    cursor = rows.at(-1)?.id;
    if (rows.length < options.batchSize) return counts;
  }
}

export async function runReminderRerender(
  db: Db,
  options: ReminderRerenderOptions,
  env: Environment,
  scope: ReminderRerenderScope = {},
  hooks: ReminderRerenderHooks = {},
) {
  if (options.apply && env.RERENDER_CONFIRM !== APPLY_CONFIRMATION) throw new ReminderRerenderRefusedError("confirmation-missing");
  // Links in the content are built from it; a missing value cannot reproduce anything.
  if (!env.NEXT_PUBLIC_APP_URL?.trim()) throw new ReminderRerenderRefusedError("app-url-missing");
  const effectiveScope = options.vendorId ? { vendorIds: [options.vendorId] } : scope;
  const vendors: VendorCounts[] = [];
  let after: string | null = null;
  while (true) {
    const vendorId = await nextVendorId(db, after, effectiveScope);
    if (vendorId === null) break;
    vendors.push(await processVendor(db, vendorId, options, hooks));
    after = vendorId;
  }
  const total = Object.fromEntries(COUNTERS.map((key) => [key, vendors.reduce((sum, row) => sum + row[key], 0)])) as Record<Counter, number>;
  return { mode: options.apply ? "apply" as const : "plan" as const, ...total, vendors };
}

async function main() {
  let category = "unexpected";
  try {
    const options = parseReminderRerenderArguments(process.argv.slice(2));
    const { url, target } = resolveReminderRerenderTarget(process.env, options.target);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    try {
      category = "run";
      const outcome = await runReminderRerender(db, options, process.env);
      console.log(JSON.stringify({ status: "ok", target, batchSize: options.batchSize, ...outcome, secretDetailsEmitted: false }));
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    if (error instanceof ReminderRerenderRefusedError) category = error.category;
    console.error(JSON.stringify({ status: "failed", safeCategory: `reminder-rerender:${category}`, secretDetailsEmitted: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
