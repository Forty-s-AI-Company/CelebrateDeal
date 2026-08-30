import {
  getLivePublishReadiness,
  type LivePublishRequirementCode,
} from "@/lib/live-publish-readiness";

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
};

export type MerchantOnboardingStep = {
  key: "profile" | "payment" | "catalog" | "journey" | "launch";
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  done: boolean;
  deferred?: boolean;
  requirements: MerchantOnboardingRequirement[];
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
    { label: "啟用互動角色", done: signals.activeInteractionRoleCount > 0, href: "/interaction-roles/new" },
    { label: "發布互動腳本", done: signals.publishedInteractionScriptCount > 0, href: "/interaction-scripts/new" },
    { label: "啟用報名確認 Email", done: signals.registrationEmailTemplateCount > 0, href: "/messages/templates/new" },
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
    media: { label: "準備可播放媒體", href: "/videos/new", actionLabel: "新增影片或 Live Input" },
    products: { label: "建立可販售商品", href: "/products/new", actionLabel: "建立商品" },
    registration_form: { label: "準備有效報名表單", href: "/forms/new", actionLabel: "建立報名表單" },
    registration_email: { label: "啟用報名成功 Email", href: "/messages/templates/new", actionLabel: "建立 Email 模板" },
    interaction_script: { label: "發布互動腳本", href: "/interaction-scripts/new", actionLabel: "建立互動腳本" },
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
      title: "付款方式驗證",
      description: "完成商店層級 provider reference 驗證；平台不保存卡號。",
      href: "/billing/payment-methods",
      actionLabel: "驗證付款方式",
      deferred: true,
      requirements: [{ label: "有效的商店付款方式", done: signals.verifiedVendorPaymentMethodCount > 0 }],
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
      title: "完成報名與互動流程",
      description: "把表單、互動角色、腳本與報名確認 Email 準備完整。",
      href: nextJourneyRequirement?.href ?? "/forms",
      actionLabel: nextJourneyRequirement?.label ?? "檢查互動流程",
      requirements: journeyRequirements.map(({ label, done }) => ({ label, done })),
    }),
    step({
      key: "launch",
      title: "準備第一場可販售直播",
      description: "逐項確認商品、表單、Email、互動腳本與媒體；內容直播仍可依自己的發布規則建立，不會被銷售檢查誤擋。",
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
