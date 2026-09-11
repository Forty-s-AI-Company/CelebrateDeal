import { CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { OnboardingTaskCenter } from "@/components/onboarding-task-center";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { merchantOnboardingProgress } from "@/lib/merchant-onboarding";
import { liveReadyVideoWhere } from "@/lib/live-video-readiness";
import {
  hasUsableMessageTemplateContent,
  REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE,
} from "@/lib/message-template";
import { parseRegistrationFormFields } from "@/lib/registration-form-fields";
import {
  countSellableLiveReadinessCandidates,
  sellableLiveReadinessQuery,
} from "@/lib/sellable-live";
import { evaluateProjectOnboarding, evaluateWorkspaceOnboarding } from "@/lib/sales-workspace";

function taskHref(taskKey: string) {
  if (taskKey.includes("payment")) return "/billing/payment-methods";
  if (taskKey.includes("logo") || taskKey.includes("profile") || taskKey.includes("support")) return "/settings/brand";
  if (taskKey.includes("team")) return "/settings/team";
  if (taskKey.includes("product") || taskKey.includes("price")) return "/products/new";
  if (taskKey.includes("funnel")) return "/forms/new";
  if (taskKey.includes("live")) return "/lives/new";
  if (taskKey.includes("consultation") || taskKey.includes("availability")) return "/consultations";
  return "/onboarding";
}

export default async function OnboardingPage() {
  const { auth, vendor } = await requireVendorManagerContext();
  const db = getDb();
  const now = new Date();
  const [preference, projects] = await Promise.all([
    db.userOnboardingPreference.findUnique({
      where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } },
    }),
    db.salesProject.findMany({
      where: { vendorId: vendor.id, status: { not: "archived" } },
      select: { id: true, name: true, primaryFlow: true, publishedAt: true },
    }),
  ]);
  const selectedProject = projects.find((project) => project.id === preference?.selectedProjectId) ?? null;
  const scopeKey = selectedProject?.id ?? "workspace";
  const taskStates = await db.onboardingTaskState.findMany({
    where: { vendorId: vendor.id, scopeKey },
    select: { taskKey: true, status: true, skipImpact: true, archivedAt: true },
  });
  const taskProgress = selectedProject
    ? await (async () => {
      const [productLinks, pricedProducts, forms, lives, consultations, paymentMethods] = await Promise.all([
        db.salesProjectProduct.count({ where: { vendorId: vendor.id, projectId: selectedProject.id } }),
        db.salesProjectProduct.count({ where: { vendorId: vendor.id, projectId: selectedProject.id, product: { priceCents: { gt: 0 } } } }),
        db.registrationForm.count({ where: { vendorId: vendor.id, projectId: selectedProject.id, isActive: true, templateId: { not: null } } }),
        db.live.count({ where: { vendorId: vendor.id, projectId: selectedProject.id } }),
        db.consultationEvent.findMany({ where: { vendorId: vendor.id, projectId: selectedProject.id, isActive: true }, select: { weeklySchedule: true } }),
        db.paymentMethodReference.count({ where: { vendorId: vendor.id, scopeType: "VENDOR", membershipId: null, status: "verified", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
      ]);
      const hasAvailability = consultations.some(({ weeklySchedule }) => Array.isArray(weeklySchedule) && weeklySchedule.some((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const ranges = (entry as { ranges?: unknown }).ranges;
        return Array.isArray(ranges) && ranges.some((range) => typeof range === "string" && range.length > 0);
      }));
      return evaluateProjectOnboarding(selectedProject.primaryFlow, {
        exists: true,
        hasLinkedProduct: productLinks > 0,
        hasPricedProduct: pricedProducts > 0,
        hasFunnelTemplate: forms > 0,
        hasLiveSession: lives > 0,
        hasConsultationService: consultations.length > 0,
        hasAvailability,
        hasPaymentMethod: paymentMethods > 0,
        hasPreviewableFlow: productLinks > 0 && (forms > 0 || lives > 0 || consultations.length > 0),
        isPublished: Boolean(selectedProject.publishedAt),
      }, taskStates);
    })()
    : await (async () => {
      const [payments, members] = await Promise.all([
        db.paymentMethodReference.count({ where: { vendorId: vendor.id, scopeType: "VENDOR", membershipId: null, status: "verified", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
        db.vendorMember.count({ where: { vendorId: vendor.id, status: "active" } }),
      ]);
      return evaluateWorkspaceOnboarding({
        hasBasicProfile: Boolean(vendor.name.trim() && vendor.email.trim()),
        hasLogo: Boolean(vendor.logoUrl),
        hasPaymentMethod: payments > 0,
        hasSupportContact: Boolean(vendor.supportEmail?.trim()),
        hasInvitedTeamMember: members > 1,
        // A test order needs a canonical local/sandbox marker; do not infer it from real orders.
        hasTestOrder: false,
      }, taskStates);
    })();
  const taskCenterTasks = taskProgress.tasks.map((task) => ({
    key: task.key,
    title: task.title,
    status: task.status,
    estimateMinutes: task.estimatedMinutes,
    href: taskHref(task.key),
    required: task.required,
    impact: task.impact,
  }));
  const [
    verifiedVendorPaymentMethodCount,
    sellableProductCount,
    activeFormCandidates,
    activeInteractionRoleCount,
    publishedInteractionScriptCount,
    registrationEmailTemplateCandidates,
    readyVideoCount,
    sellableLiveCandidates,
  ] = await Promise.all([
    db.paymentMethodReference.count({
      where: {
        vendorId: vendor.id,
        scopeType: "VENDOR",
        membershipId: null,
        status: "verified",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    db.product.count({
      where: { vendorId: vendor.id, isActive: true, fulfillmentTypeConfirmed: true },
    }),
    db.registrationForm.findMany({
      where: { vendorId: vendor.id, isActive: true },
      select: { fields: true },
    }),
    db.interactionRole.count({ where: { vendorId: vendor.id, isActive: true } }),
    db.interactionScript.count({ where: { vendorId: vendor.id, status: "published" } }),
    db.messageTemplate.findMany({
      where: { vendorId: vendor.id, ...REGISTRATION_CONFIRMATION_EMAIL_TEMPLATE_WHERE },
      select: { subject: true, body: true },
    }),
    db.video.count({ where: liveReadyVideoWhere(vendor.id) }),
    db.live.findMany(sellableLiveReadinessQuery(vendor.id)),
  ]);
  const activeFormCount = activeFormCandidates.filter((form) => parseRegistrationFormFields(form.fields).success).length;
  const registrationEmailTemplateCount = registrationEmailTemplateCandidates.filter(hasUsableMessageTemplateContent).length;
  const sellableLiveCount = countSellableLiveReadinessCandidates(sellableLiveCandidates);
  const progress = merchantOnboardingProgress({
    supportEmailConfigured: Boolean(vendor.supportEmail?.trim()),
    verifiedVendorPaymentMethodCount,
    sellableProductCount,
    activeFormCount,
    activeInteractionRoleCount,
    publishedInteractionScriptCount,
    registrationEmailTemplateCount,
    sellableLiveCount,
    readyVideoCount,
    trackingConfigured: Boolean(
      vendor.tracking?.googleTagManagerId
      || vendor.tracking?.facebookPixelId
      || vendor.tracking?.tiktokPixelId,
    ),
  });

  return (
    <>
      <PageHeader
        title="商家上線導引"
        description="依真實商店設定自動保存進度；完成一項設定後回到這裡即可接著做，不需要重複填表。"
        action={progress.nextStep ? (
          <ButtonLink href={progress.nextStep.href} tone="cta">繼續：{progress.nextStep.actionLabel}</ButtonLink>
        ) : undefined}
      />

      <OnboardingTaskCenter
        scopeKey={scopeKey}
        scopeLabel={selectedProject ? `銷售專案：${selectedProject.name}` : "商家 Workspace"}
        tasks={taskCenterTasks}
        guideStopped={Boolean(preference?.guideDismissedAt)}
      />

      <Card className="mt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">可販售準備進度</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{progress.completedSteps} / {progress.totalSteps}</p>
            <p className="mt-2 text-sm text-slate-600">
              {progress.complete ? "核心商店流程已準備完成；發布前仍需遵守外部與人工 release gate。" : "先完成下一個缺口，系統會以資料庫中的真實狀態更新進度。"}
            </p>
          </div>
          <Badge tone={progress.complete ? "green" : "orange"}>{progress.complete ? "核心流程完成" : `${progress.percentage}%`}</Badge>
        </div>
        <div
          role="progressbar"
          aria-label="商家上線準備進度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percentage}
          className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percentage}%` }} />
        </div>
      </Card>

      <ol className="mt-6 grid gap-4">
        {progress.steps.map((step, index) => (
          <li key={step.key}>
            <Card className="grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-start">
              {step.done ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 text-emerald-600" />
              ) : (
                <Circle aria-hidden="true" className="mt-0.5 text-slate-300" />
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-950">Step {index + 1}. {step.title}</h2>
                  <Badge tone={step.done ? "green" : step.deferred ? "orange" : "gray"}>
                    {step.done ? "已完成" : step.deferred ? "外部驗證，可稍後" : "待完成"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                <ul className="mt-3 grid gap-1.5 text-sm">
                  {step.requirements.map((requirement) => (
                    <li key={requirement.label} className={`flex flex-wrap items-center justify-between gap-2 ${requirement.done ? "text-emerald-700" : "text-slate-700"}`}>
                      <span>
                        <span aria-hidden="true">{requirement.done ? "✓" : "○"}</span> {requirement.label}
                        <span className="sr-only">：{requirement.done ? "已完成" : "尚未完成"}</span>
                      </span>
                      {!requirement.done && requirement.href ? (
                        <Link href={requirement.href} className="min-h-10 content-center font-semibold text-primary underline underline-offset-2 hover:text-primary-dark">
                          {requirement.actionLabel ?? "前往設定"}
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
              {step.key === "launch" && !step.done ? null : (
                <ButtonLink href={step.href} tone={step.done || step.deferred ? "secondary" : "cta"}>
                  {step.done ? "檢查設定" : step.actionLabel}
                </ButtonLink>
              )}
            </Card>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-slate-950">成長追蹤（不阻擋販售）</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Pixel／GTM 是選配；未設定不會讓核心 onboarding 假裝失敗，也不影響平台內部事件紀錄。
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Badge tone={progress.trackingConfigured ? "green" : "gray"}>{progress.trackingConfigured ? "已設定" : "選配"}</Badge>
            <ButtonLink href="/settings/tracking" tone="secondary">追蹤設定</ButtonLink>
          </div>
        </Card>
        <Card>
          <h2 className="font-semibold text-slate-950">正式上線仍需真人確認</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            這個進度只代表產品資料已準備好，不取代法務、財務、客服 SLA、外部監控或 release owner 簽核。
          </p>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <Link href="/support" className="font-semibold text-primary hover:underline">客服與事件升級</Link>
            <Link href="/policies" className="font-semibold text-primary hover:underline">政策與協助中心</Link>
          </div>
        </Card>
      </div>
    </>
  );
}
