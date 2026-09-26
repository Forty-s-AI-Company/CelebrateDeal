import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireVendorManagerContext } from "@/lib/auth";
import { requireEditableSalesProjectScope } from "@/lib/sales-project-scope";
import { getDb } from "@/lib/db";
import { parseFunnelStepPages } from "@/lib/funnel-step-pages";
import { aggregateFunnelVisits, FunnelOperationsSchema, parseFunnelOperations, validExperimentTransition, type FunnelOperations } from "@/lib/funnel-operations";

export class FunnelOperationsError extends Error {}
const identifier = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/u);
export const FunnelSettingsInputSchema = z.object({
  pageId: identifier, revision: z.number().int().positive(),
  name: z.string().trim().min(1).max(160), slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  currency: z.enum(["TWD", "USD", "EUR", "JPY", "HKD", "SGD"]), operations: FunnelOperationsSchema,
}).strict();

async function scopedPage(pageId: string, database = getDb()) {
  if (!identifier.safeParse(pageId).success) throw new FunnelOperationsError("找不到 Funnel。");
  const { auth, vendor } = await requireVendorManagerContext();
  const scope = await requireEditableSalesProjectScope(auth.user.id, vendor.id);
  if (!scope.projectId) throw new FunnelOperationsError("請先選擇銷售專案。");
  const page = await database.landingPage.findFirst({ where: { id: pageId, vendorId: vendor.id, projectId: scope.projectId }, include: { publishedVersion: { select: { content: true } } } });
  if (!page) throw new FunnelOperationsError("找不到 Funnel 或沒有存取權限。");
  const state = parseFunnelStepPages(page.draftContent);
  const operations = parseFunnelOperations(page.operations);
  if (!state || !operations) throw new FunnelOperationsError("Funnel 資料格式無效，原始資料已保留。");
  return { page, state, operations };
}

type ScopedFunnelPage = Awaited<ReturnType<typeof scopedPage>>;

function operationsFromScoped({ page, state, operations }: ScopedFunnelPage) {
  return {
    pageId: page.id,
    name: page.name,
    slug: page.slug,
    currency: state.flow.currency,
    revision: page.revision,
    status: page.status,
    operations,
    content: state,
    formId: page.draftFormId,
    liveId: page.draftLiveId,
    steps: state.flow.steps.filter((step) => !step.isSystem).map(({ id, name, path }) => ({ id, name, path })),
  };
}
export async function loadFunnelOperations(pageId: string) {
  return operationsFromScoped(await scopedPage(pageId));
}
export type FunnelOperationsEditor = Awaited<ReturnType<typeof loadFunnelOperations>>;

/** Load the editor and reports from one tenant-checked page snapshot. */
export async function loadFunnelOperationsBundle(pageId: string, now = new Date()) {
  const scoped = await scopedPage(pageId);
  return { editor: operationsFromScoped(scoped), reports: await reportsFromScoped(scoped, now) };
}

function validateReferences(operations: FunnelOperations, state: NonNullable<ReturnType<typeof parseFunnelStepPages>>, published: ReturnType<typeof parseFunnelStepPages>) {
  const stepIds = new Set(state.flow.steps.filter((step) => !step.isSystem).map((step) => step.id));
  for (const report of Object.values(operations.reports)) if (report.stepId && !stepIds.has(report.stepId)) throw new FunnelOperationsError("報表步驟不存在。");
  const experiment = operations.experiment;
  if (experiment) {
    if (!stepIds.has(experiment.controlStepId) || !stepIds.has(experiment.variantStepId)) throw new FunnelOperationsError("A/B 步驟不存在。");
    if (experiment.status === "running" || experiment.status === "winner") {
      const liveSteps = new Set(published?.flow.steps.filter((step) => !step.isSystem).map((step) => step.id));
      if (!liveSteps.has(experiment.controlStepId) || !liveSteps.has(experiment.variantStepId)) throw new FunnelOperationsError("請先發布 Control 與 Variant 步驟。");
    }
  }
  if (operations.deadline.enabled && operations.deadline.behavior === "redirect") {
    const destination = published?.flow.steps.find((step) => !step.isSystem && step.path === operations.deadline.redirectPath);
    if (!destination || published?.flow.steps[0]?.id === destination.id) throw new FunnelOperationsError("到期導向必須是已發布的非首頁步驟。");
    if (experiment?.status === "running" && [experiment.controlStepId, experiment.variantStepId].includes(destination.id)) throw new FunnelOperationsError("到期導向不能是進行中的 A/B 測試步驟。");
  }
}

/** Every settings write participates in the editor's revision CAS. */
export async function saveFunnelOperations(input: unknown) {
  const parsed = FunnelSettingsInputSchema.safeParse(input);
  if (!parsed.success) throw new FunnelOperationsError(parsed.error.issues[0]?.message ?? "設定格式無效。");
  const data = parsed.data;
  const database = getDb();
  const { page, state, operations } = await scopedPage(data.pageId, database);
  if (page.revision !== data.revision) throw new FunnelOperationsError("版本衝突：已有較新的變更，請重新載入後再編輯。");
  if (page.status === "published" && page.slug !== data.slug) throw new FunnelOperationsError("已發布的 slug 已鎖定，請先取消發布再修改。");
  if (!validExperimentTransition(operations.experiment, data.operations.experiment)) throw new FunnelOperationsError("分流配置已鎖定；請先停止實驗，再建立新的實驗。");
  const nextExperiment = data.operations.experiment;
  if (nextExperiment && nextExperiment.id !== operations.experiment?.id) {
    const assigned = await database.funnelVisit.count({ where: { vendorId: page.vendorId, pageId: page.id, experimentId: nextExperiment.id } });
    if (assigned) throw new FunnelOperationsError("這個實驗 ID 已有分流紀錄，請建立新的實驗 ID。");
  }
  validateReferences(data.operations, state, parseFunnelStepPages(page.publishedVersion?.content));
  // Currency is metadata, never an exchange operation on existing prices/orders.
  const boundProductIds = Object.values(state.pages).flatMap((document) => document.commerce ? [document.commerce.productId, ...(document.commerce.orderBumpProductId ? [document.commerce.orderBumpProductId] : [])] : []);
  if (boundProductIds.length) {
    const mismatched = await database.product.count({ where: { vendorId: page.vendorId, id: { in: boundProductIds }, currency: { not: data.currency } } });
    if (mismatched) throw new FunnelOperationsError("Currency 必須與綁定商品一致；此操作不會換算商品價格。");
  }
  const content = { ...state, flow: { ...state.flow, name: data.name, domain: data.slug, currency: data.currency } };
  try {
    const updated = await database.landingPage.updateMany({ where: { id: page.id, vendorId: page.vendorId, projectId: page.projectId, revision: data.revision }, data: { name: data.name, slug: data.slug, draftContent: content as unknown as Prisma.InputJsonValue, operations: data.operations as Prisma.InputJsonValue, revision: { increment: 1 } } });
    if (updated.count !== 1) throw new FunnelOperationsError("版本衝突：已有較新的變更，請重新載入後再編輯。");
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new FunnelOperationsError("這個 slug 已被使用。");
    throw error;
  }
  return { revision: data.revision + 1 };
}

const REPORT_LIMIT = 10_000;
function period(days: number, now: Date) { return { gte: new Date(now.getTime() - days * 86_400_000), lte: now }; }
export async function loadFunnelReports(pageId: string, now = new Date()) {
  return reportsFromScoped(await scopedPage(pageId), now);
}

async function reportsFromScoped({ page, state, operations }: ScopedFunnelPage, now: Date) {
  const database = getDb();
  const { stats, leads, sales } = operations.reports;
  const source = { vendorId: page.vendorId, pageId: page.id };
  const [visits, submissions, leadRows, orders] = await Promise.all([
    database.funnelVisit.findMany({ where: { ...source, createdAt: period(stats.days, now) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: REPORT_LIMIT + 1, select: { id: true, stepId: true, logicalStepId: true, visitorId: true, createdAt: true, experimentId: true, arm: true } }),
    database.funnelSubmission.findMany({ where: { ...source, createdAt: period(stats.days, now), submission: { form: { vendorId: page.vendorId, projectId: page.projectId } } }, take: REPORT_LIMIT + 1, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, stepId: true, visit: { select: { logicalStepId: true, experimentId: true, arm: true } } } }),
    database.funnelSubmission.findMany({ where: { ...source, ...(leads.stepId ? { stepId: leads.stepId } : {}), createdAt: period(leads.days, now), submission: { form: { vendorId: page.vendorId, projectId: page.projectId } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101, select: { id: true, stepId: true, submissionId: true, createdAt: true, submission: { select: { verificationStatus: true } } } }),
    database.commerceOrder.findMany({ where: { vendorId: page.vendorId, projectId: page.projectId, isTestOrder: false, paidAt: period(sales.days, now), paidAmountCents: { gt: 0 }, primaryPaymentTransaction: { is: { vendorId: page.vendorId, metadata: { path: ["funnel", "pageId"], equals: page.id }, ...(sales.stepId ? { AND: [{ metadata: { path: ["funnel", "stepId"], equals: sales.stepId } }] } : {}) } } }, orderBy: [{ paidAt: "desc" }, { id: "desc" }], take: 101, select: { id: true, orderNumber: true, status: true, currency: true, paidAmountCents: true, refundedAmountCents: true, paidAt: true, primaryPaymentTransaction: { select: { id: true, status: true, metadata: true } } } }),
  ]);
  const variant = operations.experiment?.variantStepId;
  const steps = state.flow.steps.filter((step) => !step.isSystem && step.id !== variant);
  const aggregate = aggregateFunnelVisits(steps, visits.slice(0, REPORT_LIMIT).map((visit) => ({ ...visit, stepId: visit.logicalStepId })), submissions.slice(0, REPORT_LIMIT).map((submission) => ({ stepId: submission.visit?.logicalStepId ?? submission.stepId })));
  const experimentRows = new Map<string, { id: string; arm: string; pageViews: number; submissions: number }>();
  for (const visit of visits.slice(0, REPORT_LIMIT)) {
    if (!visit.experimentId || !visit.arm) continue;
    const key = `${visit.experimentId}:${visit.arm}`;
    const row = experimentRows.get(key) ?? { id: visit.experimentId, arm: visit.arm, pageViews: 0, submissions: 0 };
    row.pageViews += 1; experimentRows.set(key, row);
  }
  for (const submission of submissions.slice(0, REPORT_LIMIT)) {
    const row = experimentRows.get(`${submission.visit?.experimentId}:${submission.visit?.arm}`);
    if (row) row.submissions += 1;
  }
  const experiments = [...experimentRows.values()];
  return {
    generatedAt: now.toISOString(), experiments, statsTruncated: visits.length > REPORT_LIMIT || submissions.length > REPORT_LIMIT,
    stats: aggregate.filter((row) => !stats.stepId || row.stepId === stats.stepId),
    sources: visits.slice(0, 20).map(({ id, stepId, createdAt }) => ({ id, stepId, createdAt: createdAt.toISOString() })),
    leadsTruncated: leadRows.length > 100,
    leads: leadRows.slice(0, 100).map((row) => ({ id: row.id, pageId: page.id, stepId: row.stepId, submissionId: row.submissionId, createdAt: row.createdAt.toISOString(), verificationStatus: row.submission.verificationStatus })),
    salesTruncated: orders.length > 100,
    sales: orders.slice(0, 100).map((order) => {
      const metadata = order.primaryPaymentTransaction?.metadata as { funnel?: { stepId?: string } } | null;
      return { id: order.id, orderNumber: order.orderNumber, status: order.status, currency: order.currency, paidAmountCents: order.paidAmountCents, refundedAmountCents: order.refundedAmountCents, paidAt: order.paidAt!.toISOString(), paymentId: order.primaryPaymentTransaction!.id, paymentStatus: order.primaryPaymentTransaction!.status, stepId: metadata?.funnel?.stepId ?? "" };
    }),
  };
}
export type FunnelReports = Awaited<ReturnType<typeof loadFunnelReports>>;
