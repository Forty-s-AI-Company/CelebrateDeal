import { z } from "zod";

const stepId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,95}$/u);
const filter = z.object({ stepId: z.union([z.literal(""), stepId]), days: z.number().int().min(1).max(90) }).strict();
export const FunnelExperimentSchema = z.object({
  id: z.string().min(1).max(96).regex(/^[A-Za-z0-9_-]+$/u),
  status: z.enum(["draft", "running", "stopped", "winner"]),
  controlStepId: stepId, variantStepId: stepId,
  controlWeight: z.number().int().min(0).max(100), variantWeight: z.number().int().min(0).max(100),
  winner: z.enum(["control", "variant"]).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.controlStepId === value.variantStepId) ctx.addIssue({ code: "custom", message: "Control 與 Variant 必須是不同步驟" });
  if (value.controlWeight + value.variantWeight !== 100) ctx.addIssue({ code: "custom", message: "權重總和必須為 100" });
  if (value.status === "running" && (!value.controlWeight || !value.variantWeight)) ctx.addIssue({ code: "custom", message: "執行中兩組權重都必須大於 0" });
  if ((value.status === "winner") !== (value.winner !== null)) ctx.addIssue({ code: "custom", message: "Winner 狀態必須指定勝出組別" });
});

export const FunnelOperationsSchema = z.object({
  schemaVersion: z.literal(1),
  experiment: FunnelExperimentSchema.nullable(),
  deadline: z.object({
    enabled: z.boolean(),
    timezone: z.string().min(1).max(80).refine((zone) => { try { new Intl.DateTimeFormat("en", { timeZone: zone }); return true; } catch { return false; } }, "請輸入有效 IANA 時區"),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    behavior: z.enum(["closed", "redirect"]),
    redirectPath: z.string().max(100).regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/u),
  }).strict().superRefine((value, ctx) => {
    if (value.enabled && !value.expiresAt) ctx.addIssue({ code: "custom", message: "請設定包含 UTC offset 的截止時間" });
    if (value.enabled && value.behavior === "redirect" && !value.redirectPath) ctx.addIssue({ code: "custom", message: "請指定到期導向步驟" });
  }),
  reports: z.object({ stats: filter, leads: filter, sales: filter }).strict(),
}).strict();

export type FunnelOperations = z.infer<typeof FunnelOperationsSchema>;
export type FunnelExperiment = z.infer<typeof FunnelExperimentSchema>;
export function defaultFunnelOperations(): FunnelOperations {
  return { schemaVersion: 1, experiment: null, deadline: { enabled: false, timezone: "Asia/Taipei", expiresAt: null, behavior: "closed", redirectPath: "" }, reports: { stats: { stepId: "", days: 30 }, leads: { stepId: "", days: 30 }, sales: { stepId: "", days: 30 } } };
}
export function parseFunnelOperations(value: unknown): FunnelOperations | null {
  if (value === null || value === undefined) return defaultFunnelOperations();
  const result = FunnelOperationsSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Allocation inputs never change under an existing experiment identity. */
export function validExperimentTransition(previous: FunnelExperiment | null, next: FunnelExperiment | null): boolean {
  if (!previous) return !next || next.status === "draft" || next.status === "running";
  if (!next || previous.id !== next.id) return previous.status !== "running" && (!next || next.status === "draft" || next.status === "running");
  const allocationUnchanged = previous.controlStepId === next.controlStepId && previous.variantStepId === next.variantStepId && previous.controlWeight === next.controlWeight && previous.variantWeight === next.variantWeight;
  if (previous.status === "draft") return next.status === "draft" || next.status === "running";
  if (!allocationUnchanged) return false;
  if (previous.status === "winner") return next.status === "winner" && next.winner === previous.winner;
  if (previous.status === "stopped") return next.status === "stopped" || next.status === "winner";
  return next.status === "running" || next.status === "stopped" || next.status === "winner";
}

/** Published operational references must survive editor saves and rollbacks. */
export function funnelOperationsReferencesValid(value: unknown, steps: Array<{ id: string; path: string; isSystem: boolean }>): boolean {
  const operations = parseFunnelOperations(value);
  if (!operations) return false;
  const editable = steps.filter((step) => !step.isSystem);
  if (operations.experiment && ![operations.experiment.controlStepId, operations.experiment.variantStepId].every((id) => editable.some((step) => step.id === id))) return false;
  if (operations.deadline.enabled && operations.deadline.behavior === "redirect" && !editable.some((step, index) => index > 0 && step.path === operations.deadline.redirectPath)) return false;
  return Object.values(operations.reports).every((report) => !report.stepId || editable.some((step) => step.id === report.stepId));
}

export type FunnelVisitProjection = { id: string; stepId: string; visitorId: string; createdAt: Date };
/** A next-step conversion requires an observed visit after this step, by the same pseudonym. */
export function aggregateFunnelVisits(steps: Array<{ id: string; name: string }>, visits: FunnelVisitProjection[], submissions: Array<{ stepId: string }>) {
  const earliest = new Map<string, Map<string, number>>();
  const counts = new Map<string, number>();
  const byStep = new Map<string, FunnelVisitProjection[]>();
  const submissionCounts = new Map<string, number>();
  for (const submission of submissions) submissionCounts.set(submission.stepId, (submissionCounts.get(submission.stepId) ?? 0) + 1);
  for (const visit of visits) {
    counts.set(visit.stepId, (counts.get(visit.stepId) ?? 0) + 1);
    const byVisitor = earliest.get(visit.stepId) ?? new Map<string, number>();
    byVisitor.set(visit.visitorId, Math.min(byVisitor.get(visit.visitorId) ?? Infinity, visit.createdAt.getTime()));
    earliest.set(visit.stepId, byVisitor);
    const stepVisits = byStep.get(visit.stepId) ?? [];
    stepVisits.push(visit); byStep.set(visit.stepId, stepVisits);
  }
  return steps.map((step, index) => {
    const visitors = earliest.get(step.id) ?? new Map<string, number>();
    const next = steps[index + 1];
    const nextVisits = next ? byStep.get(next.id) ?? [] : [];
    const converted = new Set(nextVisits.filter((visit) => visitors.has(visit.visitorId) && visit.createdAt.getTime() >= visitors.get(visit.visitorId)!).map((visit) => visit.visitorId)).size;
    return { stepId: step.id, name: step.name, pageViews: counts.get(step.id) ?? 0, visitors: visitors.size, submissions: submissionCounts.get(step.id) ?? 0, conversions: next ? converted : null, conversionRate: next && visitors.size ? converted / visitors.size : null, dropOff: next ? visitors.size - converted : null };
  });
}
