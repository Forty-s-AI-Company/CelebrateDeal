import { z } from "zod";

/** These literals intentionally match the additive Prisma enums. */
export const SALES_WORKSPACE_MODES = ["live_course", "consulting", "flagship"] as const;
export type SalesWorkspaceMode = (typeof SALES_WORKSPACE_MODES)[number];
export const SALES_PROJECT_FLOWS = ["live", "consultation"] as const;
export type SalesProjectFlow = (typeof SALES_PROJECT_FLOWS)[number];
export const ONBOARDING_TASK_STATUSES = ["not_started", "in_progress", "completed", "skipped", "needs_attention", "archived"] as const;
export type OnboardingTaskStatus = (typeof ONBOARDING_TASK_STATUSES)[number];

export const QUESTIONNAIRE_STEPS = 4;
export const SALES_APPROACHES = ["live", "consultation", "both", "unsure"] as const;
export const SALES_PRODUCT_TYPES = ["online_course", "consulting_service", "in_person_event", "membership", "digital_product"] as const;
export const SALES_FEATURES = ["funnel_page", "live_pitch", "booking", "online_payment", "conversion_tracking", "customer_notification"] as const;
export const SALES_PROGRESS_STAGES = ["starting", "has_offer", "has_customers", "migrating"] as const;

export const SalesWorkspaceQuestionnaireSchema = z.object({
  sellingApproach: z.enum(SALES_APPROACHES).optional(),
  productType: z.enum(SALES_PRODUCT_TYPES).optional(),
  requiredFeatures: z.array(z.enum(SALES_FEATURES)).max(SALES_FEATURES.length).optional(),
  progressStage: z.enum(SALES_PROGRESS_STAGES).optional(),
}).strict();
export type SalesWorkspaceQuestionnaire = z.infer<typeof SalesWorkspaceQuestionnaireSchema>;

export const SalesProjectCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9-]+$/u),
  mode: z.enum(SALES_WORKSPACE_MODES),
  primaryFlow: z.enum(SALES_PROJECT_FLOWS),
  onboardingEnabled: z.boolean(),
}).strict();
export type SalesProjectCreateInput = z.infer<typeof SalesProjectCreateSchema>;

/** Deduplicates multi-select feature values before data is persisted. */
export function parseSalesWorkspaceQuestionnaire(input: unknown): SalesWorkspaceQuestionnaire {
  const parsed = SalesWorkspaceQuestionnaireSchema.parse(input);
  return {
    ...parsed,
    requiredFeatures: parsed.requiredFeatures ? [...new Set(parsed.requiredFeatures)] : undefined,
  };
}

/**
 * Recommends a navigation/template mode only. Capability checks must continue
 * to use the merchant subscription and existing feature-toggle policies.
 */
export function recommendSalesWorkspaceMode(answers: SalesWorkspaceQuestionnaire): SalesWorkspaceMode {
  if (answers.sellingApproach === "live") return "live_course";
  if (answers.sellingApproach === "consultation") return "consulting";
  if (answers.sellingApproach === "both") return "flagship";

  const features = new Set(answers.requiredFeatures ?? []);
  const needsLive = features.has("live_pitch");
  const needsConsultation = features.has("booking");
  if (needsLive && !needsConsultation) return "live_course";
  if (needsConsultation && !needsLive) return "consulting";
  if (answers.productType === "consulting_service") return "consulting";
  if (answers.productType === "online_course") return "live_course";
  return "flagship";
}

export type OnboardingTaskDefinition = {
  key: string;
  title: string;
  estimatedMinutes: number;
  required: boolean;
  /** Visible explanation when a required task was deliberately skipped. */
  skipImpact?: string;
};

export const WORKSPACE_ONBOARDING_TASKS: readonly OnboardingTaskDefinition[] = [
  { key: "workspace_profile", title: "完成商家基本資料", estimatedMinutes: 2, required: true },
  { key: "workspace_logo", title: "上傳 Logo", estimatedMinutes: 1, required: false },
  { key: "workspace_payment", title: "串接付款方式", estimatedMinutes: 4, required: true, skipImpact: "已略過付款設定，目前無法接受線上付款。" },
  { key: "workspace_support", title: "設定客服與通知資訊", estimatedMinutes: 2, required: true, skipImpact: "已略過客服與通知設定，客戶可能無法取得必要協助與通知。" },
  { key: "workspace_team", title: "邀請團隊成員", estimatedMinutes: 1, required: false },
  { key: "workspace_test_order", title: "完成測試訂單", estimatedMinutes: 3, required: true, skipImpact: "已略過測試訂單，付款與交付流程尚未驗證。" },
];

const LIVE_PROJECT_TASKS: readonly OnboardingTaskDefinition[] = [
  { key: "project_created", title: "建立專案", estimatedMinutes: 1, required: true },
  { key: "project_product", title: "建立商品", estimatedMinutes: 3, required: true },
  { key: "project_funnel", title: "選擇漏斗頁模板", estimatedMinutes: 3, required: true },
  { key: "project_live", title: "設定直播場次", estimatedMinutes: 3, required: true },
  { key: "project_payment", title: "檢查付款方式", estimatedMinutes: 1, required: true, skipImpact: "已略過付款檢查，顧客可能無法完成線上付款。" },
  { key: "project_preview", title: "預覽流程", estimatedMinutes: 2, required: true },
  { key: "project_publish", title: "發布並取得分享連結", estimatedMinutes: 1, required: true },
];

const CONSULTATION_PROJECT_TASKS: readonly OnboardingTaskDefinition[] = [
  { key: "project_created", title: "建立專案", estimatedMinutes: 1, required: true },
  { key: "project_consultation", title: "建立諮詢服務", estimatedMinutes: 3, required: true },
  { key: "project_price", title: "設定價格", estimatedMinutes: 2, required: true },
  { key: "project_availability", title: "設定可預約時間", estimatedMinutes: 3, required: true },
  { key: "project_funnel", title: "建立漏斗頁", estimatedMinutes: 3, required: true },
  { key: "project_payment", title: "檢查付款方式", estimatedMinutes: 1, required: true, skipImpact: "已略過付款檢查，顧客可能無法完成線上付款。" },
  { key: "project_preview", title: "預覽流程", estimatedMinutes: 2, required: true },
  { key: "project_publish", title: "發布並取得分享連結", estimatedMinutes: 1, required: true },
];

export function projectOnboardingTasks(flow: SalesProjectFlow): readonly OnboardingTaskDefinition[] {
  return flow === "live" ? LIVE_PROJECT_TASKS : CONSULTATION_PROJECT_TASKS;
}

export type WorkspaceTaskSignals = {
  hasBasicProfile: boolean;
  hasLogo: boolean;
  hasPaymentMethod: boolean;
  hasSupportContact: boolean;
  hasInvitedTeamMember: boolean;
  /** A paid sandbox/local order is the canonical test-order completion signal. */
  hasTestOrder: boolean;
};

export type ProjectTaskSignals = {
  exists: boolean;
  hasLinkedProduct: boolean;
  hasPricedProduct: boolean;
  hasFunnelTemplate: boolean;
  hasLiveSession: boolean;
  hasConsultationService: boolean;
  hasAvailability: boolean;
  hasPaymentMethod: boolean;
  /** A previewable checkout/resource combination, supplied by the data loader. */
  hasPreviewableFlow: boolean;
  isPublished: boolean;
};

/** Shared release gate used by the project publish action and its tests. */
export function canPublishSalesProject(flow: SalesProjectFlow, signals: ProjectTaskSignals) {
  const flowReady = flow === "live"
    ? signals.hasLiveSession
    : signals.hasConsultationService && signals.hasAvailability;
  return signals.exists
    && signals.hasLinkedProduct
    && signals.hasPricedProduct
    && signals.hasFunnelTemplate
    && signals.hasPaymentMethod
    && flowReady;
}

export type PersistedTaskState = Pick<OnboardingTaskStateRecord, "taskKey" | "status" | "skipImpact" | "archivedAt">;
export type OnboardingTaskStateRecord = {
  taskKey: string;
  status: OnboardingTaskStatus;
  skipImpact?: string | null;
  archivedAt?: Date | null;
};

export type EvaluatedOnboardingTask = OnboardingTaskDefinition & {
  status: OnboardingTaskStatus;
  completedBySignal: boolean;
  impact?: string;
};

export type OnboardingProgress = {
  tasks: EvaluatedOnboardingTask[];
  completedCount: number;
  skippedCount: number;
  totalCount: number;
  nextTask: EvaluatedOnboardingTask | null;
  isComplete: boolean;
};

function taskStateByKey(states: readonly PersistedTaskState[]) {
  return new Map(states.map((state) => [state.taskKey, state]));
}

function deriveTaskStatus(
  definition: OnboardingTaskDefinition,
  completedBySignal: boolean,
  persisted: PersistedTaskState | undefined,
): EvaluatedOnboardingTask {
  // A user cannot forge completion with a checkbox: real merchant data wins.
  if (completedBySignal) return { ...definition, status: "completed", completedBySignal: true };
  if (persisted?.status === "archived") return { ...definition, status: "archived", completedBySignal: false };
  if (persisted?.status === "skipped") {
    return { ...definition, status: "skipped", completedBySignal: false, impact: persisted.skipImpact ?? definition.skipImpact };
  }
  if (persisted?.status === "needs_attention" || persisted?.status === "in_progress") {
    return { ...definition, status: persisted.status, completedBySignal: false, impact: persisted.skipImpact ?? definition.skipImpact };
  }
  // Persisted `completed` is intentionally downgraded when its real signal is
  // gone, preventing stale manual state from claiming a working setup.
  return { ...definition, status: "not_started", completedBySignal: false };
}

function summarize(tasks: EvaluatedOnboardingTask[]): OnboardingProgress {
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const skippedCount = tasks.filter((task) => task.status === "skipped").length;
  const nextTask = tasks.find((task) => !["completed", "skipped", "archived"].includes(task.status)) ?? null;
  // Skipping or archiving dismisses a prompt; it never proves that the
  // underlying merchant setup is complete.
  return { tasks, completedCount, skippedCount, totalCount: tasks.length, nextTask, isComplete: tasks.every((task) => task.status === "completed") };
}

/** Evaluates Workspace task progress exclusively from source-of-truth signals. */
export function evaluateWorkspaceOnboarding(
  signals: WorkspaceTaskSignals,
  states: readonly PersistedTaskState[] = [],
): OnboardingProgress {
  const state = taskStateByKey(states);
  const complete: Record<string, boolean> = {
    workspace_profile: signals.hasBasicProfile,
    workspace_logo: signals.hasLogo,
    workspace_payment: signals.hasPaymentMethod,
    workspace_support: signals.hasSupportContact,
    workspace_team: signals.hasInvitedTeamMember,
    workspace_test_order: signals.hasTestOrder,
  };
  return summarize(WORKSPACE_ONBOARDING_TASKS.map((task) => deriveTaskStatus(task, complete[task.key] ?? false, state.get(task.key))));
}

/** Evaluates the selected project's distinct live or consultation task path. */
export function evaluateProjectOnboarding(
  flow: SalesProjectFlow,
  signals: ProjectTaskSignals,
  states: readonly PersistedTaskState[] = [],
): OnboardingProgress {
  const state = taskStateByKey(states);
  const complete: Record<string, boolean> = {
    project_created: signals.exists,
    project_product: signals.hasLinkedProduct,
    project_consultation: signals.hasConsultationService,
    project_price: signals.hasPricedProduct,
    project_availability: signals.hasAvailability,
    project_funnel: signals.hasFunnelTemplate,
    project_live: signals.hasLiveSession,
    project_payment: signals.hasPaymentMethod,
    project_preview: signals.hasPreviewableFlow,
    project_publish: signals.isPublished,
  };
  return summarize(projectOnboardingTasks(flow).map((task) => deriveTaskStatus(task, complete[task.key] ?? false, state.get(task.key))));
}

export const WORKSPACE_SCOPE_KEY = "workspace";
export function projectScopeKey(projectId: string) {
  const normalized = projectId.trim();
  if (!normalized || normalized.length > 191) throw new ProjectScopeError("invalid_project_scope");
  return normalized;
}

export class ProjectScopeError extends Error {
  constructor(message = "invalid_project_scope") {
    super(message);
    this.name = "ProjectScopeError";
  }
}

/** A small domain guard used by actions before persisting project selection. */
export function assertProjectBelongsToVendor<T extends { id: string; vendorId: string }>(
  project: T | null | undefined,
  vendorId: string,
): T {
  if (!project || project.vendorId !== vendorId) throw new ProjectScopeError("project_not_found");
  return project;
}
