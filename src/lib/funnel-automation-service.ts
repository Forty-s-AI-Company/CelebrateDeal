import { Prisma, type PrismaClient } from "@prisma/client";
import { requireVendorManagerContext } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { stopDelayedStepRunsOfRule } from "@/lib/automation-delayed-steps";
import {
  automationRuleIncludesLinePush,
  mayConfigureAutomationLinePush,
  mayWriteAutomationActions,
  storedAutomationRuleIncludesLinePush,
} from "@/lib/automation-line-push-policy";
import { getDb } from "@/lib/db";
import { requireEditableSalesProjectScope } from "@/lib/sales-project-scope";
import { isLockTimeout } from "@/lib/serializable-retry";

const MAX_NAME_LENGTH = 120;
const MAX_TAG_LENGTH = 50;
const identifierPattern = /^[A-Za-z0-9_-]{1,100}$/u;

export type FunnelAutomationRule = {
  id: string;
  name: string;
  tag: string;
  isActive: boolean;
  version: number;
  updatedAt: string;
  /**
   * The rule has a custom LINE push (a delayed step added in
   * /settings/automations) and the viewer is not the owner: only switching it
   * off stays available (owner decision 2026-11-14).
   */
  linePushOwnerOnly: boolean;
};

export class FunnelAutomationInputError extends Error {
  constructor() { super("funnel_automation_invalid_input"); }
}

export class FunnelAutomationScopeError extends Error {
  constructor() { super("funnel_automation_scope_required"); }
}

export class FunnelAutomationNotFoundError extends Error {
  constructor() { super("funnel_automation_not_found"); }
}

/** The rule stayed locked (the delayed-step worker or another tab) for too long; nothing changed. */
export class FunnelAutomationBusyError extends Error {
  constructor() { super("funnel_automation_busy"); }
}

export class FunnelAutomationConflictError extends Error {
  constructor() { super("funnel_automation_conflict"); }
}

/** An admin tried to edit or switch on a rule with a custom LINE push (owner-only); nothing changed. */
export class FunnelAutomationLinePushOwnerOnlyError extends Error {
  constructor() { super("line_push_owner_only"); }
}

type FunnelAutomationDb = Pick<PrismaClient, "landingPage" | "automationRule" | "$transaction">;

type ScopedPage = {
  vendorId: string;
  projectId: string;
  pageId: string;
  actorId: string;
  actorLabel: string;
  /** The actor is the vendor owner (mayConfigureAutomationLinePush). */
  linePushAllowed: boolean;
};

function value(input: unknown, maximum: number) {
  return typeof input === "string" && input.trim().length > 0 && input.trim().length <= maximum
    ? input.trim()
    : null;
}

function expectedVersion(input: unknown) {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0 ? input : null;
}

function ruleId(input: unknown) {
  return typeof input === "string" && identifierPattern.test(input) ? input : null;
}

async function scopedPage(database: FunnelAutomationDb, input: { pageId: unknown }): Promise<ScopedPage> {
  const pageId = ruleId(input.pageId);
  if (!pageId) throw new FunnelAutomationInputError();
  const { auth, vendor } = await requireVendorManagerContext();
  // 保留實際 membership 作為 audit actor；缺少身分時拒絕繼續查詢。
  if (!auth.member) throw new FunnelAutomationScopeError();
  const scope = await requireEditableSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) throw new FunnelAutomationScopeError();
  const page = await database.landingPage.findFirst({
    where: { id: pageId, vendorId: vendor.id, projectId: scope.projectId, archivedAt: null },
    select: { id: true },
  });
  if (!page) throw new FunnelAutomationNotFoundError();
  return {
    vendorId: vendor.id,
    projectId: scope.projectId,
    pageId: page.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    linePushAllowed: mayConfigureAutomationLinePush(auth.member.role),
  };
}

type RuleRow = { id: string; name: string; isActive: boolean; version: number; actions: unknown; updatedAt: Date; steps?: Array<{ actions: unknown }> };

function asRule(row: RuleRow, page: ScopedPage): FunnelAutomationRule | null {
  if (!Array.isArray(row.actions) || row.actions.length !== 1) return null;
  const [action] = row.actions;
  if (!action || typeof action !== "object" || (action as Record<string, unknown>).type !== "add_customer_tag") return null;
  const tag = value((action as Record<string, unknown>).tag, MAX_TAG_LENGTH);
  const linePushOwnerOnly = !page.linePushAllowed && automationRuleIncludesLinePush(row);
  return tag ? { id: row.id, name: row.name, tag, isActive: row.isActive, version: row.version, updatedAt: row.updatedAt.toISOString(), linePushOwnerOnly } : null;
}

async function listForPage(database: FunnelAutomationDb, page: ScopedPage) {
  const rows = await database.automationRule.findMany({
    where: { vendorId: page.vendorId, funnelPageId: page.pageId, trigger: "form_registered" },
    // Steps' actions only to tell an admin which rules have a LINE push.
    select: { id: true, name: true, isActive: true, version: true, actions: true, updatedAt: true, steps: { where: { vendorId: page.vendorId }, select: { actions: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  // Stored JSON is untrusted input. Invalid or legacy rows stay hidden rather
  // than becoming a configurable funnel side effect.
  return rows.map((row) => asRule(row, page)).filter((row): row is FunnelAutomationRule => row !== null);
}

/**
 * Without the owner role, a rule with a custom LINE push (owner decision
 * 2026-11-14) is neither edited nor switched on here. Read inside the
 * transaction that holds the rule row FOR UPDATE, after the lock.
 */
async function assertFunnelRuleWritable(tx: Pick<Prisma.TransactionClient, "automationRule">, page: ScopedPage, id: string) {
  if (page.linePushAllowed) return;
  // Scoped like the CAS below (this page's form_registered rules), so a rule
  // of another page or of /settings/automations is "not found" here, never
  // "owner only". null falls through to the CAS, which reports not found.
  const hasLinePush = await storedAutomationRuleIncludesLinePush(tx, { vendorId: page.vendorId, ruleId: id, funnelPageId: page.pageId, trigger: "form_registered" });
  if (hasLinePush) throw new FunnelAutomationLinePushOwnerOnlyError();
}

/** lock_timeout (55P03) on the rule row, or the transaction could not start or finish in time (P2028). */
function isBusy(error: unknown) {
  return isLockTimeout(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028");
}

const RULE_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

export async function listFunnelAutomationRules(input: { pageId: unknown }, database: FunnelAutomationDb = getDb()) {
  return listForPage(database, await scopedPage(database, input));
}

function mutationInput(input: { pageId: unknown; name: unknown; tag: unknown }) {
  const name = value(input.name, MAX_NAME_LENGTH);
  const tag = value(input.tag, MAX_TAG_LENGTH);
  if (!name || !tag) throw new FunnelAutomationInputError();
  return { name, tag };
}

export async function createFunnelAutomationRule(input: { pageId: unknown; name: unknown; tag: unknown }, database: FunnelAutomationDb = getDb()) {
  const page = await scopedPage(database, input);
  const parsed = mutationInput(input);
  const actions = [{ type: "add_customer_tag", tag: parsed.tag }];
  // The funnel editor only writes a tag today; the shared owner-only check
  // still runs so a LINE push added here later cannot skip it.
  if (!mayWriteAutomationActions(page.actorLabel, actions)) throw new FunnelAutomationLinePushOwnerOnlyError();
  const created = await database.automationRule.create({
    data: {
      vendorId: page.vendorId,
      funnelPageId: page.pageId,
      name: parsed.name,
      trigger: "form_registered",
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: actions as Prisma.InputJsonArray,
    },
    select: { id: true, name: true, isActive: true, version: true, actions: true, updatedAt: true },
  });
  const rule = asRule(created, page);
  if (!rule) throw new FunnelAutomationInputError();
  await writeAuditLog({ vendorId: page.vendorId, actorId: page.actorId, actorLabel: page.actorLabel, action: "create_funnel_automation_rule", targetType: "AutomationRule", targetId: created.id, after: auditSnapshot(created) });
  return rule;
}

async function noUpdate(database: FunnelAutomationDb, page: ScopedPage, id: string) {
  const exists = await database.automationRule.findFirst({
    where: { id, vendorId: page.vendorId, funnelPageId: page.pageId, trigger: "form_registered" },
    select: { id: true },
  });
  if (!exists) throw new FunnelAutomationNotFoundError();
  throw new FunnelAutomationConflictError();
}

export async function updateFunnelAutomationRule(input: { pageId: unknown; ruleId: unknown; version: unknown; name: unknown; tag: unknown }, database: FunnelAutomationDb = getDb()) {
  const page = await scopedPage(database, input);
  const id = ruleId(input.ruleId);
  const version = expectedVersion(input.version);
  const parsed = mutationInput(input);
  if (!id || !version) throw new FunnelAutomationInputError();
  const actions = [{ type: "add_customer_tag", tag: parsed.tag }];
  if (!mayWriteAutomationActions(page.actorLabel, actions)) throw new FunnelAutomationLinePushOwnerOnlyError();
  // The rule row is locked FOR UPDATE first (bound to the vendor), like every
  // other writer of a rule, so the owner-only LINE push check below and the
  // CAS see the same rule.
  let updated: { count: number };
  try {
    updated = await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${id} AND "vendorId" = ${page.vendorId} FOR UPDATE`;
      await assertFunnelRuleWritable(tx, page, id);
      return tx.automationRule.updateMany({
        where: { id, vendorId: page.vendorId, funnelPageId: page.pageId, trigger: "form_registered", version },
        data: { name: parsed.name, condition: { type: "always" } as Prisma.InputJsonValue, actions: actions as Prisma.InputJsonArray, version: { increment: 1 } },
      });
    }, RULE_TRANSACTION_OPTIONS);
  } catch (error) {
    if (isBusy(error)) throw new FunnelAutomationBusyError();
    throw error;
  }
  if (updated.count === 0) await noUpdate(database, page, id);
  await writeAuditLog({ vendorId: page.vendorId, actorId: page.actorId, actorLabel: page.actorLabel, action: "update_funnel_automation_rule", targetType: "AutomationRule", targetId: id, after: { version: version + 1 } });
}

export async function setFunnelAutomationRuleEnabled(input: { pageId: unknown; ruleId: unknown; version: unknown; isActive: unknown }, database: FunnelAutomationDb = getDb()) {
  const page = await scopedPage(database, input);
  const id = ruleId(input.ruleId);
  const version = expectedVersion(input.version);
  if (!id || !version || typeof input.isActive !== "boolean") throw new FunnelAutomationInputError();
  const isActive = input.isActive;
  // The rule row is locked FOR UPDATE first (bound to the vendor), the order
  // every writer of delayed-step runs uses (rule, then runs). Switching off
  // also stops the rule's active delayed-step runs in the same transaction
  // (F-4 review M1, same as /settings/automations): switching on again never
  // revives them. Switching on starts a custom LINE push again, so it is
  // owner-only for a rule that has one; switching off is always allowed.
  let updated: { count: number };
  try {
    updated = await database.$transaction(async (tx) => {
      // Waiting for the delayed-step worker or another tab is bounded.
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$queryRaw`SELECT "id" FROM "AutomationRule" WHERE "id" = ${id} AND "vendorId" = ${page.vendorId} FOR UPDATE`;
      if (isActive) await assertFunnelRuleWritable(tx, page, id);
      const result = await tx.automationRule.updateMany({
        where: { id, vendorId: page.vendorId, funnelPageId: page.pageId, trigger: "form_registered", version },
        data: { isActive, version: { increment: 1 } },
      });
      if (result.count === 1 && !isActive) await stopDelayedStepRunsOfRule(tx, { vendorId: page.vendorId, ruleId: id });
      return result;
    }, RULE_TRANSACTION_OPTIONS);
  } catch (error) {
    if (isBusy(error)) throw new FunnelAutomationBusyError();
    throw error;
  }
  if (updated.count === 0) await noUpdate(database, page, id);
  await writeAuditLog({ vendorId: page.vendorId, actorId: page.actorId, actorLabel: page.actorLabel, action: input.isActive ? "enable_funnel_automation_rule" : "disable_funnel_automation_rule", targetType: "AutomationRule", targetId: id, after: { isActive: input.isActive, version: version + 1 } });
}
