import { Check, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";

import { SettingsBackLink } from "@/components/settings-back-link";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isCardBindingRequired } from "@/lib/feature-gates";
import {
  findSelectedOnboardingProject,
  loadOnboardingChecklist,
  trackingConfiguredFor,
} from "@/lib/merchant-onboarding-data";

/** The complete 上線任務 list; the sidebar panel and the dashboard show the same steps. */
export default async function OnboardingPage() {
  const { auth, vendor } = await requireVendorManagerContext();
  const db = getDb();
  const progress = await loadOnboardingChecklist(db, {
    vendorId: vendor.id,
    supportEmailConfigured: Boolean(vendor.supportEmail?.trim()),
    trackingConfigured: trackingConfiguredFor(vendor.tracking),
    // While funnel_binding is closed no card can be bound, so the step counts as satisfied (F-002).
    cardBindingRequired: isCardBindingRequired(vendor),
    selectedProject: await findSelectedOnboardingProject(db, vendor.id, auth.user.id),
  });

  return (
    <>
      <SettingsBackLink />
      <PageHeader
        title="上線導引"
        description="依真實商店設定自動保存進度；完成一項設定後回到這裡即可接著做，不需要重複填表。"
        action={progress.nextStep ? (
          <ButtonLink href={progress.nextStep.href} tone="cta">繼續：{progress.nextStep.actionLabel}</ButtonLink>
        ) : undefined}
      />

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">可販售準備進度</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{progress.completedSteps} / {progress.totalSteps}</p>
            <p className="mt-2 text-sm text-slate-600">
              {progress.complete ? "核心商店流程已準備完成；發布前仍需遵守外部與人工的上線前確認。" : "先完成下一個缺口，系統會以資料庫中的真實狀態更新進度。"}
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
                    {step.done ? "已完成" : step.deferred ? step.deferredLabel ?? "外部驗證，可稍後" : "待完成"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                <ul className="mt-3 grid gap-1.5 text-sm">
                  {step.requirements.map((requirement) => (
                    <li key={requirement.label} className={`flex flex-wrap items-center justify-between gap-2 ${requirement.done ? "text-emerald-700" : "text-slate-700"}`}>
                      <span>
                        {requirement.done ? <Check size={14} aria-hidden="true" className="mr-1 inline-block align-[-2px]" /> : <Circle size={14} aria-hidden="true" className="mr-1 inline-block align-[-2px]" />}{requirement.label}
                        <span className="sr-only">：{requirement.done ? "已完成" : "尚未完成"}</span>
                      </span>
                      {!requirement.done && requirement.href ? (
                        <Link href={requirement.href} className="min-h-10 content-center font-semibold text-primary underline underline-offset-2 hover:text-primary-dark">
                          {requirement.actionLabel ?? "前往設定"}
                        </Link>
                      ) : null}
                      {requirement.note ? <span className="w-full text-xs leading-5 text-amber-800">已略過：{requirement.note}</span> : null}
                    </li>
                  ))}
                </ul>
                {step.suggestions?.length ? (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-500">建議（選配，不影響完成度）</p>
                    <ul className="mt-2 grid gap-1.5 text-sm">
                      {step.suggestions.map((suggestion) => (
                        <li key={suggestion.label} className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
                          <span>
                            {suggestion.done ? <Check size={14} aria-hidden="true" className="mr-1 inline-block align-[-2px]" /> : <Circle size={14} aria-hidden="true" className="mr-1 inline-block align-[-2px]" />}{suggestion.label}
                            <span className="sr-only">：{suggestion.done ? "已完成" : "尚未設定，可稍後再做"}</span>
                          </span>
                          {!suggestion.done && suggestion.href ? (
                            <Link href={suggestion.href} className="min-h-10 content-center font-semibold text-primary underline underline-offset-2 hover:text-primary-dark">
                              {suggestion.actionLabel ?? "前往設定"}
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
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
            這個進度只代表產品資料已準備好，不取代法務、財務、客服回覆時限、外部監控或上線負責人簽核。
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
