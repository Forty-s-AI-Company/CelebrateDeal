import { Prisma, type PrismaClient } from "@prisma/client";
import { requireVendorManagerContext } from "@/lib/auth";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { requireEditableSalesProjectScope } from "@/lib/sales-project-scope";

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

export class FunnelAutomationConflictError extends Error {
  constructor() { super("funnel_automation_conflict"); }
}

type FunnelAutomationDb = Pick<PrismaClient, "landingPage" | "automationRule">;

type ScopedPage = {
  vendorId: string;
  projectId: string;
  pageId: string;
  actorId: string;
  actorLabel: string;
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
    where: { id: pageId, vendorId: vendor.id, projectId: scope.projectId },
    select: { id: true },
  });
  if (!page) throw new FunnelAutomationNotFoundError();
  return { vendorId: vendor.id, projectId: scope.projectId, pageId: page.id, actorId: auth.user.id, actorLabel: auth.member.role };
}

function asRule(row: { id: string; name: string; isActive: boolean; version: number; actions: unknown; updatedAt: Date }): FunnelAutomationRule | null {
  if (!Array.isArray(row.actions) || row.actions.length !== 1) return null;
  const [action] = row.actions;
  if (!action || typeof action !== "object" || (action as Record<string, unknown>).type !== "add_customer_tag") return null;
  const tag = value((action as Record<string, unknown>).tag, MAX_TAG_LENGTH);
  return tag ? { id: row.id, name: row.name, tag, isActive: row.isActive, version: row.version, updatedAt: row.updatedAt.toISOString() } : null;
}

async function listForPage(database: FunnelAutomationDb, page: ScopedPage) {
  const rows = await database.automationRule.findMany({
    where: { vendorId: page.vendorId, funnelPageId: page.pageId, trigger: "form_registered" },
    select: { id: true, name: true, isActive: true, version: true, actions: true, updatedAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  // Stored JSON is untrusted input. Invalid or legacy rows stay hidden rather
  // than becoming a configurable funnel side effect.
  return rows.map(asRule).filter((row): row is FunnelAutomationRule => row !== null);
}

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
  const created = await database.automationRule.create({
    data: {
      vendorId: page.vendorId,
      funnelPageId: page.pageId,
      name: parsed.name,
      trigger: "form_registered",
      condition: { type: "always" } as Prisma.InputJsonValue,
      actions: [{ type: "add_customer_tag", tag: parsed.tag }] as Prisma.InputJsonArray,
    },
    select: { id: true, name: true, isActive: true, version: true, actions: true, updatedAt: true },
  });
  const rule = asRule(created);
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
  const updated = await database.automationRule.updateMany({
    where: { id, vendorId: page.vendorId, funnelPageId: page.pageId, trigger: "form_registered", version },
    data: { name: parsed.name, condition: { type: "always" } as Prisma.InputJsonValue, actions: [{ type: "add_customer_tag", tag: parsed.tag }] as Prisma.InputJsonArray, version: { increment: 1 } },
  });
  if (updated.count === 0) await noUpdate(database, page, id);
  await writeAuditLog({ vendorId: page.vendorId, actorId: page.actorId, actorLabel: page.actorLabel, action: "update_funnel_automation_rule", targetType: "AutomationRule", targetId: id, after: { version: version + 1 } });
}

export async function setFunnelAutomationRuleEnabled(input: { pageId: unknown; ruleId: unknown; version: unknown; isActive: unknown }, database: FunnelAutomationDb = getDb()) {
  const page = await scopedPage(database, input);
  const id = ruleId(input.ruleId);
  const version = expectedVersion(input.version);
  if (!id || !version || typeof input.isActive !== "boolean") throw new FunnelAutomationInputError();
  const updated = await database.automationRule.updateMany({
    where: { id, vendorId: page.vendorId, funnelPageId: page.pageId, trigger: "form_registered", version },
    data: { isActive: input.isActive, version: { increment: 1 } },
  });
  if (updated.count === 0) await noUpdate(database, page, id);
  await writeAuditLog({ vendorId: page.vendorId, actorId: page.actorId, actorLabel: page.actorLabel, action: input.isActive ? "enable_funnel_automation_rule" : "disable_funnel_automation_rule", targetType: "AutomationRule", targetId: id, after: { isActive: input.isActive, version: version + 1 } });
}
