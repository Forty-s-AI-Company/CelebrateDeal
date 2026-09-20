import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { parseFunnelOperations, type FunnelOperations } from "@/lib/funnel-operations";
import { parseFunnelStepPages } from "@/lib/funnel-step-pages";
import type { FunnelStep } from "@/lib/funnel-flow";
import { isFunnelVisitorId } from "@/lib/funnel-runtime-visitor";

export { FUNNEL_VISITOR_COOKIE, funnelVisitorIdFromRequest, isFunnelVisitorId } from "@/lib/funnel-runtime-visitor";

export type FunnelExperimentArm = "control" | "variant";
export type FunnelRuntimeDecision =
  | { status: "render"; requestedStepId: string; renderedStepId: string; experiment: { id: string; arm: FunnelExperimentArm } | null; progressionExcludedStepId?: string }
  | { status: "closed" }
  | { status: "redirect"; path: string }
  | { status: "unavailable" };

type RuntimePage = {
  id: string;
  vendorId: string;
  operations: unknown;
  publishedVersion: { content: unknown; formId: string | null; liveId: string | null } | null;
};

type RuntimeDb = Pick<PrismaClient, "landingPage" | "funnelVisit" | "funnelSubmission">;

/** Only used when a request did not pass through the public-route proxy. */
export function resolveFunnelVisitorId(value: string | undefined | null, create = randomUUID): string {
  return isFunnelVisitorId(value) ? value : create();
}

/** A deterministic bucket is deliberately independent of a browser's clock. */
export function assignFunnelExperiment(pageId: string, experiment: FunnelOperations["experiment"], visitorId: string): { id: string; arm: FunnelExperimentArm } | null {
  if (!experiment || !isFunnelVisitorId(visitorId)) return null;
  let arm: FunnelExperimentArm | null = null;
  if (experiment.status === "running") {
    const bucket = createHash("sha256").update(`${pageId}:${experiment.id}:${visitorId}`).digest().readUInt32BE(0) % 100;
    arm = bucket < experiment.controlWeight ? "control" : "variant";
  } else if (experiment.status === "winner" && experiment.winner) {
    arm = experiment.winner;
  }
  return arm ? { id: experiment.id, arm } : null;
}

export function decidePublicFunnelRuntime(input: {
  pageId: string;
  requestedStepId: string;
  steps: readonly FunnelStep[];
  operations: FunnelOperations | null;
  visitorId: string;
  now?: Date;
}): FunnelRuntimeDecision {
  const requested = input.steps.find((step) => step.id === input.requestedStepId && !step.isSystem);
  if (!requested || !input.operations || !isFunnelVisitorId(input.visitorId)) return { status: "unavailable" };
  const deadline = resolveFunnelDeadline({ steps: input.steps, requestedStepId: requested.id, operations: input.operations, now: input.now });
  if (deadline.status !== "render") return deadline;

  const assignment = assignFunnelExperiment(input.pageId, input.operations.experiment, input.visitorId);
  if (!assignment || !input.operations.experiment || requested.id !== input.operations.experiment.controlStepId) {
    return { status: "render", requestedStepId: requested.id, renderedStepId: requested.id, experiment: null };
  }
  const renderedStepId = assignment.arm === "control"
    ? input.operations.experiment.controlStepId
    : input.operations.experiment.variantStepId;
  const rendered = input.steps.find((step) => step.id === renderedStepId && !step.isSystem);
  return rendered
    ? { status: "render", requestedStepId: requested.id, renderedStepId: rendered.id, experiment: assignment, progressionExcludedStepId: input.operations.experiment.variantStepId }
    : { status: "unavailable" };
}

/** Evaluates a persisted deadline before any public form or checkout write. */
export function resolveFunnelDeadline(input: {
  steps: readonly FunnelStep[];
  requestedStepId: string;
  operations: FunnelOperations | null;
  now?: Date;
}): Extract<FunnelRuntimeDecision, { status: "render" | "closed" | "redirect" | "unavailable" }> {
  const requested = input.steps.find((step) => step.id === input.requestedStepId && !step.isSystem);
  if (!requested || !input.operations) return { status: "unavailable" };
  const deadline = input.operations.deadline;
  const expiresAt = deadline.enabled && deadline.expiresAt ? new Date(deadline.expiresAt) : null;
  if (deadline.enabled && (!expiresAt || Number.isNaN(expiresAt.getTime()))) return { status: "unavailable" };
  if (!expiresAt || (input.now ?? new Date()) < expiresAt) return { status: "render", requestedStepId: requested.id, renderedStepId: requested.id, experiment: null };
  if (deadline.behavior === "closed") return { status: "closed" };
  const target = input.steps.find((step) => !step.isSystem && step.path === deadline.redirectPath);
  if (!target || target.id === requested.id) return target?.id === requested.id
    ? { status: "render", requestedStepId: requested.id, renderedStepId: requested.id, experiment: null }
    : { status: "closed" };
  return { status: "redirect", path: target.path };
}

/** Expiry also blocks form and checkout writes on an otherwise viewable redirect target. */
export function isFunnelDeadlineExpired(operations: FunnelOperations | null, now = new Date()): boolean {
  if (!operations?.deadline.enabled || !operations.deadline.expiresAt) return false;
  const expiresAt = new Date(operations.deadline.expiresAt);
  return !Number.isNaN(expiresAt.getTime()) && now >= expiresAt;
}

/** Re-reads the actual published page before a public delivery event is saved. */
export async function resolvePublicFunnelRuntime(input: {
  pageId: string;
  requestedStepId: string;
  visitorId: string;
  now?: Date;
  database?: RuntimeDb;
}): Promise<{ page: RuntimePage; decision: FunnelRuntimeDecision } | null> {
  const database = input.database ?? getDb();
  const page = await database.landingPage.findFirst({
    where: {
      id: input.pageId,
      status: "published",
      publishedVersionId: { not: null },
      project: { is: { status: "published", publishedAt: { not: null } } },
    },
    select: {
      id: true,
      vendorId: true,
      operations: true,
      publishedVersion: { select: { content: true, formId: true, liveId: true } },
    },
  }) as RuntimePage | null;
  if (!page?.publishedVersion) return null;
  const state = parseFunnelStepPages(page.publishedVersion.content);
  if (!state) return null;
  const decision = decidePublicFunnelRuntime({
    pageId: page.id,
    requestedStepId: input.requestedStepId,
    steps: state.flow.steps,
    operations: parseFunnelOperations(page.operations),
    visitorId: input.visitorId,
    now: input.now,
  });
  return { page, decision };
}

/** Delivery events are server-owned and include only a pseudonymous visitor ID. */
export async function recordPublicFunnelVisit(input: {
  pageId: string;
  vendorId: string;
  stepId: string;
  logicalStepId: string;
  visitorId: string;
  experiment: { id: string; arm: FunnelExperimentArm } | null;
  database?: RuntimeDb;
}) {
  if (!isFunnelVisitorId(input.visitorId)) return null;
  const database = input.database ?? getDb();
  return database.funnelVisit.create({
    data: {
      pageId: input.pageId,
      vendorId: input.vendorId,
      stepId: input.stepId,
      logicalStepId: input.logicalStepId,
      visitorId: input.visitorId,
      ...(input.experiment ? { experimentId: input.experiment.id, arm: input.experiment.arm } : {}),
    },
    select: { id: true },
  });
}

export async function resolveTrustedFunnelSubmission(input: {
  pageId: string;
  stepId: string;
  formId: string;
  liveId: string | null;
  visitorId: string;
  now?: Date;
  database?: RuntimeDb;
}): Promise<{ vendorId: string; pageId: string; stepId: string; visitId: string | null } | null> {
  const resolved = await resolvePublicFunnelRuntime({
    pageId: input.pageId,
    requestedStepId: input.stepId,
    visitorId: input.visitorId,
    now: input.now,
    database: input.database,
  });
  if (!resolved || resolved.decision.status !== "render") return null;
  if (isFunnelDeadlineExpired(parseFunnelOperations(resolved.page.operations), input.now)) return null;
  if (resolved.page.publishedVersion?.formId !== input.formId || resolved.page.publishedVersion.liveId !== input.liveId) return null;
  const database = input.database ?? getDb();
  const visit = await database.funnelVisit.findFirst({
    where: {
      vendorId: resolved.page.vendorId,
      pageId: resolved.page.id,
      stepId: resolved.decision.renderedStepId,
      visitorId: input.visitorId,
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!visit) return null;
  return {
    vendorId: resolved.page.vendorId,
    pageId: resolved.page.id,
    stepId: resolved.decision.renderedStepId,
    visitId: visit.id,
  };
}

/** The unique submission key makes retrying a verified public POST idempotent. */
export async function recordTrustedFunnelSubmission(input: {
  vendorId: string;
  pageId: string;
  stepId: string;
  submissionId: string;
  visitId: string | null;
  database?: RuntimeDb;
}) {
  const database = input.database ?? getDb();
  return database.funnelSubmission.upsert({
    where: { submissionId: input.submissionId },
    create: {
      vendorId: input.vendorId,
      pageId: input.pageId,
      stepId: input.stepId,
      submissionId: input.submissionId,
      ...(input.visitId ? { visitId: input.visitId } : {}),
    },
    update: {},
    select: { id: true },
  });
}
