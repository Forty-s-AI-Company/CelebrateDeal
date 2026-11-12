import {
  getLivePublishReadiness,
  type LivePublishRequirementCode,
} from "@/lib/live-publish-readiness";
import { isPaymentOnboardingTask, onboardingTaskHref } from "@/lib/onboarding-task-links";
import type { OnboardingProgress, OnboardingTaskStatus, SalesProjectFlow } from "@/lib/sales-workspace";

export type MerchantOnboardingSignals = {
  supportEmailConfigured: boolean;
  verifiedVendorPaymentMethodCount: number;
  sellableProductCount: number;
  activeFormCount: number;
  activeInteractionRoleCount: number;
  publishedInteractionScriptCount: number;
  registrationEmailTemplateCount: number;
  sellableLiveCount: number;
  readyVideoCount?: number;
  trackingConfigured: boolean;
};

export type MerchantOnboardingRequirement = {
  label: string;
  done: boolean;
  href?: string;
  actionLabel?: string;
  /** Why a deliberately skipped task still matters (persisted skip impact). */
  note?: string;
};

export type MerchantOnboardingStep = {
  key: "profile" | "payment" | "catalog" | "journey" | "launch" | "project";
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  done: boolean;
  deferred?: boolean;
  /** Badge text for a deferred step; defaults to the external-verification wording. */
  deferredLabel?: string;
  requirements: MerchantOnboardingRequirement[];
  /** 選配的建議項目：會顯示，但不影響這一步或整體的完成度。 */
  suggestions?: MerchantOnboardingRequirement[];
};

function step(input: Omit<MerchantOnboardingStep, "done">): MerchantOnboardingStep {
  return {
    ...input,
    done: input.requirements.every((requirement) => requirement.done),
  };
}

export function merchantOnboardingProgress(signals: MerchantOnboardingSignals) {
  const journeyRequirements = [
    { label: "啟用報名表單", done: signals.activeFormCount > 0, href: "/forms/new" },
    { label: "啟用報名確認 Email", done: signals.registrationEmailTemplateCount > 0, href: "/messages/templates/new" },
  ];
  // 互動角色與腳本是選配（建議），不列入必要步驟，也不影響完成度。
  const interactionSuggestions = [
    { label: "啟用互動角色", done: signals.activeInteractionRoleCount > 0, href: "/interaction-roles/new", actionLabel: "建立互動角色" },
    { label: "發布互動腳本", done: signals.publishedInteractionScriptCount > 0, href: "/interaction-scripts/new", actionLabel: "建立互動腳本" },
  ];
  const nextJourneyRequirement = journeyRequirements.find((requirement) => !requirement.done);
  const salesReadiness = getLivePublishReadiness({
    mode: "commerce",
    productCount: signals.sellableProductCount,
    productsReady: signals.sellableProductCount > 0,
    videoReady: (signals.readyVideoCount ?? signals.sellableLiveCount) > 0,
    formReady: signals.activeFormCount > 0,
    registrationEmailReady: signals.registrationEmailTemplateCount > 0,
    interactionScriptReady: signals.publishedInteractionScriptCount > 0,
  });
  const salesRequirementCopy: Record<LivePublishRequirementCode, Omit<MerchantOnboardingRequirement, "done">> = {
    media: { label: "準備可播放媒體", href: "/videos/new", actionLabel: "新增影片或即時直播" },
    products: { label: "建立可販售商品", href: "/products/new", actionLabel: "建立商品" },
    registration_form: { label: "準備有效報名表單", href: "/forms/new", actionLabel: "建立報名表單" },
    registration_email: { label: "啟用報名成功 Email", href: "/messages/templates/new", actionLabel: "建立 Email 模板" },
    interaction_script: { label: "發布互動腳本（建議）", href: "/interaction-scripts/new", actionLabel: "建立互動腳本" },
  };
  const launchRequirements: MerchantOnboardingRequirement[] = [
    ...salesReadiness.requirements.map((requirement) => ({
      ...salesRequirementCopy[requirement.code],
      done: requirement.ready,
    })),
    {
      label: "完成直播綁定並進入可販售狀態",
      done: signals.sellableLiveCount > 0,
      href: "/lives/new",
      actionLabel: "建立或繼續直播",
    },
  ];
  const nextLaunchRequirement = launchRequirements.find((requirement) => !requirement.done);
  const steps: MerchantOnboardingStep[] = [
    step({
      key: "profile",
      title: "商店與客服資料",
      description: "確認品牌識別與可受理買家問題的客服信箱。",
      href: "/settings/brand",
      actionLabel: "設定商店資料",
      requirements: [{ label: "設定客服 Email", done: signals.supportEmailConfigured }],
    }),
    step({
      key: "payment",
      title: "平台服務付款驗證",
      // Same wording as /billing/payment-methods: this is not customer checkout collection.
      description: "確認平台方案與 Stream 用量的付款驗證；這不是顧客結帳收款設定，完成後也不代表顧客收款已啟用，顧客收款設定需另外確認。專案發布仍需有效驗證。",
      href: "/billing/payment-methods",
      actionLabel: "設定平台付款方式",
      deferred: true,
      requirements: [{ label: "有效的商家平台服務付款紀錄", done: signals.verifiedVendorPaymentMethodCount > 0 }],
    }),
    step({
      key: "catalog",
      title: "建立可販售商品",
      description: "至少一項啟用中且已確認履約類型的商品。",
      href: "/products/new",
      actionLabel: "建立商品",
      requirements: [{ label: "可販售商品", done: signals.sellableProductCount > 0 }],
    }),
    step({
      key: "journey",
      title: "完成報名流程",
      description: "把報名表單與報名確認 Email 準備好。互動角色與腳本是選配，想讓聊天室更熱絡時再建立即可。",
      href: nextJourneyRequirement?.href ?? "/forms",
      actionLabel: nextJourneyRequirement?.label ?? "檢查互動流程",
      requirements: journeyRequirements.map(({ label, done }) => ({ label, done })),
      suggestions: interactionSuggestions,
    }),
    step({
      key: "launch",
      title: "準備第一場可販售直播",
      description: "逐項確認商品、表單、Email 與媒體；互動腳本是選配，不會擋住發布。內容直播仍可依自己的發布規則建立，不會被銷售檢查誤擋。",
      href: nextLaunchRequirement?.href ?? "/lives",
      actionLabel: nextLaunchRequirement?.actionLabel ?? "檢查直播",
      requirements: launchRequirements,
    }),
  ];
  const completedSteps = steps.filter((item) => item.done).length;
  const incompleteSteps = steps.filter((item) => !item.done);

  return {
    steps,
    completedSteps,
    totalSteps: steps.length,
    percentage: Math.round((completedSteps / steps.length) * 100),
    complete: completedSteps === steps.length,
    // Payment verification depends on an external provider. Keep it visible,
    // while letting merchants finish every local content task first.
    nextStep: incompleteSteps.find((item) => !item.deferred) ?? incompleteSteps[0] ?? null,
    trackingConfigured: signals.trackingConfigured,
  };
}

export type MerchantOnboardingProgress = ReturnType<typeof merchantOnboardingProgress>;

/** The selected sales project, already bound to the current vendor by the caller. */
export type OnboardingChecklistProject = {
  id: string;
  name: string;
  primaryFlow: SalesProjectFlow;
  progress: OnboardingProgress;
  cardBindingRequired: boolean;
};

export type OnboardingChecklist = {
  steps: MerchantOnboardingStep[];
  completedSteps: number;
  totalSteps: number;
  percentage: number;
  complete: boolean;
  nextStep: MerchantOnboardingStep | null;
  trackingConfigured: boolean;
  project: { id: string; name: string } | null;
};

/**
 * The selected project's publish tasks as one step. They come from the same
 * gate as `publishSalesProjectAction`; `project_created` is always true once
 * the project exists, so it is not repeated.
 */
function projectStep(project: OnboardingChecklistProject): MerchantOnboardingStep {
  const tasks = project.progress.tasks.filter((task) => task.key !== "project_created" && (project.cardBindingRequired || !isPaymentOnboardingTask(task.key)));
  const requirements: MerchantOnboardingRequirement[] = tasks.map((task) => ({
    label: task.title,
    done: task.status === "completed",
    href: onboardingTaskHref(task.key, project.id),
    actionLabel: task.title,
    note: task.status === "skipped" ? task.impact ?? undefined : undefined,
  }));
  const next = requirements.find((requirement) => !requirement.done);
  return step({
    key: "project",
    title: `發布專案「${project.name}」`,
    description: "專案發布後，報名頁、直播與結帳才會對外公開；按下發布時系統會再檢查一次。",
    href: next?.href ?? `/projects/${encodeURIComponent(project.id)}`,
    actionLabel: next?.actionLabel ?? "檢查專案",
    requirements,
  });
}

/**
 * The single 上線任務 list. The sidebar panel, `/onboarding`, the dashboard
 * card and the public guide all render these steps, so they cannot disagree.
 * Status comes only from persisted merchant data (see the loader in
 * `merchant-onboarding-data.ts`); nothing here is a manual checkbox.
 */
export function buildOnboardingChecklist(merchant: MerchantOnboardingProgress, project: OnboardingChecklistProject | null = null): OnboardingChecklist {
  // A consultation project never needs a sellable live, so the live step stays
  // visible but is not offered as the next thing to do.
  const merchantSteps = project?.primaryFlow === "consultation"
    ? merchant.steps.map((item) => item.key === "launch" ? { ...item, deferred: true, deferredLabel: "諮詢專案不需要，可稍後" } : item)
    : merchant.steps;
  const steps = project ? [...merchantSteps, projectStep(project)] : merchantSteps;
  const completedSteps = steps.filter((item) => item.done).length;
  const incompleteSteps = steps.filter((item) => !item.done);
  return {
    steps,
    completedSteps,
    totalSteps: steps.length,
    percentage: Math.round((completedSteps / steps.length) * 100),
    complete: completedSteps === steps.length,
    nextStep: incompleteSteps.find((item) => !item.deferred) ?? incompleteSteps[0] ?? null,
    trackingConfigured: merchant.trackingConfigured,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

/** One row of the sidebar panel; a projection of an `OnboardingChecklist` step. */
export type OnboardingChecklistItem = {
  key: string;
  title: string;
  href: string;
  status: OnboardingTaskStatus;
  deferred?: boolean;
};

export function onboardingChecklistItems(checklist: OnboardingChecklist): OnboardingChecklistItem[] {
  return checklist.steps.map((item) => ({
    key: item.key,
    title: item.title,
    href: item.href,
    status: item.done ? "completed" : "not_started",
    deferred: item.deferred && !item.done ? true : undefined,
  }));
}

const TERMINAL_ITEM_STATUSES: ReadonlySet<OnboardingTaskStatus> = new Set(["completed", "skipped", "archived"]);

/** Same rule as `nextStep`: an external, deferred step waits until local work is done. */
export function nextOnboardingChecklistItem<T extends Pick<OnboardingChecklistItem, "status" | "deferred">>(items: readonly T[]): T | null {
  const open = items.filter((item) => !TERMINAL_ITEM_STATUSES.has(item.status));
  return open.find((item) => !item.deferred) ?? open[0] ?? null;
}

const EMPTY_SIGNALS: MerchantOnboardingSignals = {
  supportEmailConfigured: false,
  verifiedVendorPaymentMethodCount: 0,
  sellableProductCount: 0,
  activeFormCount: 0,
  activeInteractionRoleCount: 0,
  publishedInteractionScriptCount: 0,
  registrationEmailTemplateCount: 0,
  sellableLiveCount: 0,
  readyVideoCount: 0,
  trackingConfigured: false,
};

/** The same steps without anyone's status, for the public merchant guide. */
export function merchantOnboardingOutline() {
  return merchantOnboardingProgress(EMPTY_SIGNALS).steps.map(({ key, title, description, href, actionLabel, deferred }) => ({ key, title, description, href, actionLabel, deferred: Boolean(deferred) }));
}
