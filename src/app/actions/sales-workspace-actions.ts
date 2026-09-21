"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canPublishSalesProject, parseSalesWorkspaceQuestionnaire, projectOnboardingTasks, recommendSalesWorkspaceMode, SalesProjectCreateSchema, WORKSPACE_ONBOARDING_TASKS, type SalesWorkspaceQuestionnaire } from "@/lib/sales-workspace";
import { assertServerActionOrigin, assertServerActionSecurity } from "@/lib/csrf";

function nextQuestionnaireStep(answers: SalesWorkspaceQuestionnaire) {
  if (!answers.sellingApproach) return 0;
  if (!answers.productType) return 1;
  if (!answers.requiredFeatures?.length) return 2;
  if (!answers.progressStage) return 3;
  return 4;
}

export async function saveOnboardingAnswerAction(answers: SalesWorkspaceQuestionnaire) {
  await assertServerActionOrigin();
  const { auth, vendor } = await requireVendorManagerContext();
  const parsed = parseSalesWorkspaceQuestionnaire(answers);
  await getDb().userOnboardingPreference.upsert({
    where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } },
    create: { userId: auth.user.id, vendorId: vendor.id, questionnaireAnswers: parsed, questionnaireStep: nextQuestionnaireStep(parsed) },
    update: { questionnaireAnswers: parsed, questionnaireStep: nextQuestionnaireStep(parsed) },
  });
}

export async function skipPersonalizedOnboardingAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  await getDb().userOnboardingPreference.upsert({
    where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } },
    create: { userId: auth.user.id, vendorId: vendor.id, questionnaireStep: 4, questionnaireDoneAt: new Date(), guideDismissedAt: new Date(), taskPanelCollapsed: true },
    update: { questionnaireStep: 4, questionnaireDoneAt: new Date(), guideDismissedAt: new Date(), taskPanelCollapsed: true },
  });
  redirect("/dashboard");
}

export async function completePersonalizedOnboardingAction() {
  await assertServerActionOrigin();
  const { auth, vendor } = await requireVendorManagerContext();
  const preference = await getDb().userOnboardingPreference.findUnique({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } } });
  const answers = parseSalesWorkspaceQuestionnaire(preference?.questionnaireAnswers ?? {});
  if (nextQuestionnaireStep(answers) !== 4) redirect("/welcome?error=incomplete");
  const mode = recommendSalesWorkspaceMode(answers);
  await getDb().$transaction(async (tx) => {
    await tx.userOnboardingPreference.update({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } }, data: { questionnaireStep: 4, questionnaireDoneAt: new Date(), recommendedMode: mode, selectedMode: mode, guideDismissedAt: null, taskPanelCollapsed: false } });
    await tx.onboardingTaskState.createMany({ data: WORKSPACE_ONBOARDING_TASKS.map((task) => ({ vendorId: vendor.id, scopeKey: "workspace", taskKey: task.key, status: "not_started" })), skipDuplicates: true });
    const projectCount = await tx.salesProject.count({ where: { vendorId: vendor.id } });
    if (projectCount === 0) {
      const flow = mode === "consulting" ? "consultation" : "live";
      const project = await tx.salesProject.create({ data: { vendorId: vendor.id, name: mode === "consulting" ? "我的諮詢專案" : "我的第一個銷售專案", slug: "first-sales-project", mode, primaryFlow: flow, onboardingEnabled: true } });
      await tx.userOnboardingPreference.update({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } }, data: { selectedProjectId: project.id } });
      await tx.onboardingTaskState.createMany({ data: projectOnboardingTasks(flow).map((task) => ({ vendorId: vendor.id, projectId: project.id, scopeKey: project.id, taskKey: task.key, status: "not_started" })), skipDuplicates: true });
    }
  });
  redirect("/welcome/preparing");
}

export async function selectSalesProjectAction(projectId: string | null) {
  await assertServerActionOrigin();
  const { auth, vendor } = await requireVendorManagerContext();
  if (projectId) {
    const exists = await getDb().salesProject.count({ where: { id: projectId, vendorId: vendor.id, status: { not: "archived" } } });
    if (exists !== 1) throw new Error("project_not_found");
  }
  await getDb().userOnboardingPreference.upsert({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } }, create: { userId: auth.user.id, vendorId: vendor.id, selectedProjectId: projectId }, update: { selectedProjectId: projectId } });
  revalidatePath("/", "layout");
}

export async function persistTaskPanelCollapsedAction(collapsed: boolean) {
  await assertServerActionOrigin();
  const { auth, vendor } = await requireVendorManagerContext();
  await getDb().userOnboardingPreference.upsert({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } }, create: { userId: auth.user.id, vendorId: vendor.id, taskPanelCollapsed: collapsed }, update: { taskPanelCollapsed: collapsed } });
}

export async function createSalesProjectAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { auth, vendor } = await requireVendorManagerContext();
  const existingPublished = await getDb().salesProject.count({ where: { vendorId: vendor.id, status: "published" } });
  const parsed = SalesProjectCreateSchema.parse({
    name: formData.get("name"), slug: formData.get("slug"), mode: formData.get("mode"), primaryFlow: formData.get("primaryFlow"),
    onboardingEnabled: formData.get("creationPath") === "guided" || existingPublished === 0,
  });
  const project = await getDb().$transaction(async (tx) => {
    const created = await tx.salesProject.create({ data: { ...parsed, vendorId: vendor.id } });
    await tx.userOnboardingPreference.upsert({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } }, create: { userId: auth.user.id, vendorId: vendor.id, selectedProjectId: created.id }, update: { selectedProjectId: created.id } });
    if (parsed.onboardingEnabled) await tx.onboardingTaskState.createMany({ data: projectOnboardingTasks(parsed.primaryFlow).map((task) => ({ vendorId: vendor.id, projectId: created.id, scopeKey: created.id, taskKey: task.key, status: "not_started" })) });
    return created;
  });
  // The current App Router layout may survive the redirect; invalidate it so
  // the Sidebar immediately reflects the newly selected project.
  revalidatePath("/", "layout");
  redirect(parsed.onboardingEnabled ? "/onboarding" : `/projects/${project.id}`);
}

/** Publishes only when the selected project has a real sellable flow. */
export async function publishSalesProjectAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { vendor } = await requireVendorManagerContext();
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId || projectId.length > 191) throw new Error("project_not_found");
  const db = getDb();
  const project = await db.salesProject.findFirst({
    where: { id: projectId, vendorId: vendor.id, status: { not: "archived" } },
    select: { id: true, primaryFlow: true },
  });
  if (!project) throw new Error("project_not_found");
  const now = new Date();
  const [pricedProducts, funnels, lives, consultations, paymentMethods] = await Promise.all([
    db.salesProjectProduct.count({ where: { vendorId: vendor.id, projectId, product: { isActive: true, priceCents: { gt: 0 } } } }),
    db.registrationForm.count({ where: { vendorId: vendor.id, projectId, isActive: true } }),
    db.live.count({ where: { vendorId: vendor.id, projectId } }),
    db.consultationEvent.findMany({ where: { vendorId: vendor.id, projectId, isActive: true }, select: { weeklySchedule: true } }),
    db.paymentMethodReference.count({ where: { vendorId: vendor.id, scopeType: "VENDOR", membershipId: null, status: "verified", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
  ]);
  const hasAvailability = consultations.some(({ weeklySchedule }) => Array.isArray(weeklySchedule) && weeklySchedule.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const ranges = (entry as { ranges?: unknown }).ranges;
    return Array.isArray(ranges) && ranges.some((range) => typeof range === "string" && range.length > 0);
  }));
  const ready = canPublishSalesProject(project.primaryFlow, {
    exists: true,
    hasLinkedProduct: pricedProducts > 0,
    hasPricedProduct: pricedProducts > 0,
    hasFunnelTemplate: funnels > 0,
    hasLiveSession: lives > 0,
    hasConsultationService: consultations.length > 0,
    hasAvailability,
    hasPaymentMethod: paymentMethods > 0,
    hasPreviewableFlow: true,
    isPublished: false,
  });
  if (!ready) redirect(`/projects/${encodeURIComponent(projectId)}?error=not_ready`);
  await db.salesProject.updateMany({ where: { id: projectId, vendorId: vendor.id, status: { not: "archived" } }, data: { status: "published", publishedAt: now } });
  revalidatePath("/", "layout");
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${encodeURIComponent(projectId)}?published=1`);
}

export async function controlOnboardingGuideAction(control: "hide" | "remind" | "stop" | "restart") {
  await assertServerActionOrigin();
  const { auth, vendor } = await requireVendorManagerContext();
  const now = new Date();
  const data = control === "hide" ? { taskPanelHiddenUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000) }
    : control === "remind" ? { taskPanelHiddenUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) }
      : control === "stop" ? { guideDismissedAt: now, taskPanelCollapsed: true }
        : { guideDismissedAt: null, taskPanelHiddenUntil: null, taskPanelCollapsed: false };
  await getDb().userOnboardingPreference.upsert({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } }, create: { userId: auth.user.id, vendorId: vendor.id, ...data }, update: data });
  revalidatePath("/", "layout");
}

export async function setOnboardingTaskStatusAction(scopeKey: string, taskKey: string, status: "not_started" | "in_progress" | "skipped" | "needs_attention" | "archived") {
  await assertServerActionOrigin();
  const { vendor } = await requireVendorManagerContext();
  const project = scopeKey === "workspace" ? null : await getDb().salesProject.findFirst({ where: { id: scopeKey, vendorId: vendor.id }, select: { id: true } });
  if (scopeKey !== "workspace" && !project) throw new Error("project_not_found");
  const definitions = scopeKey === "workspace" ? WORKSPACE_ONBOARDING_TASKS : projectOnboardingTasks((await getDb().salesProject.findFirst({ where: { id: scopeKey, vendorId: vendor.id }, select: { primaryFlow: true } }))!.primaryFlow);
  const definition = definitions.find((task) => task.key === taskKey);
  if (!definition) throw new Error("task_not_found");
  await getDb().onboardingTaskState.upsert({ where: { vendorId_scopeKey_taskKey: { vendorId: vendor.id, scopeKey, taskKey } }, create: { vendorId: vendor.id, projectId: project?.id ?? null, scopeKey, taskKey, status, skipImpact: status === "skipped" ? definition.skipImpact : null, archivedAt: status === "archived" ? new Date() : null }, update: { status, skipImpact: status === "skipped" ? definition.skipImpact : null, archivedAt: status === "archived" ? new Date() : null } });
  revalidatePath("/", "layout");
  revalidatePath("/onboarding");
}
