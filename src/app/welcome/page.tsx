import { redirect } from "next/navigation";
import { PersonalizedOnboardingQuestionnaire, type QuestionnaireAnswers } from "@/components/personalized-onboarding-questionnaire";
import { completePersonalizedOnboardingAction, saveOnboardingAnswerAction, skipPersonalizedOnboardingAction } from "@/app/actions/sales-workspace-actions";
import { requireVendorManagerContext } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CsrfField } from "@/components/csrf-field";

export default async function WelcomePage() {
  const { auth, vendor } = await requireVendorManagerContext();
  const preference = await getDb().userOnboardingPreference.findUnique({ where: { userId_vendorId: { userId: auth.user.id, vendorId: vendor.id } } });
  if (preference?.questionnaireDoneAt) redirect("/dashboard");
  const answers = (preference?.questionnaireAnswers ?? {}) as QuestionnaireAnswers;
  async function save(_step: number, next: QuestionnaireAnswers) { "use server"; await saveOnboardingAnswerAction(next); }
  async function complete() { "use server"; await completePersonalizedOnboardingAction(); }
  return <main className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-slate-50 px-4 py-8 sm:py-12">
    <div className="mx-auto mb-8 max-w-4xl text-center"><p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700">CelebrateDeal</p><h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">歡迎加入 CelebrateDeal</h1><p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-slate-600">花 60 秒告訴我們你的銷售方式，我們會替你準備最適合的工作空間。</p></div>
    <PersonalizedOnboardingQuestionnaire initialStep={Math.min(preference?.questionnaireStep ?? 0, 3)} initialAnswers={answers} saveAnswer={save} complete={complete} />
    <form action={skipPersonalizedOnboardingAction} className="mx-auto mt-5 max-w-4xl text-center"><CsrfField /><button className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-600 underline underline-offset-4 hover:text-slate-950">我是老使用者，略過設定</button></form>
  </main>;
}
