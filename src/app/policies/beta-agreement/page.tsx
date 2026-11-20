import type { Metadata } from "next";
import { BetaAgreementText } from "@/components/beta-agreement-text";
import { PublicPolicyShell } from "@/components/public-policy";
import { betaAgreement } from "@/lib/beta-agreement-content";

export const metadata: Metadata = {
  title: `${betaAgreement.title} | CelebrateDeal`,
  description: betaAgreement.summary,
};

/**
 * Public copy of the 封測合作協議 for later reference. Same module, version
 * and text as the back-office gate (`/beta-agreement`); nothing here records
 * consent.
 */
export default function BetaAgreementPolicyPage() {
  return (
    <PublicPolicyShell>
      <article className="mx-auto max-w-3xl" aria-labelledby="beta-agreement-title">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">政策與協助中心</p>
          <h1 id="beta-agreement-title" className="mt-2 text-3xl font-bold tracking-tight text-slate-950">{betaAgreement.title}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{betaAgreement.summary}</p>
        </div>
        <dl className="grid gap-3 rounded-lg border border-border bg-white p-4 text-sm text-slate-700 sm:grid-cols-2">
          <div><dt className="font-semibold">版本</dt><dd className="mt-1">{betaAgreement.version}</dd></div>
          <div><dt className="font-semibold">簽署方式</dt><dd className="mt-1">商家 owner 在後台閱讀全文後勾選同意</dd></div>
        </dl>
        <div className="mt-8 rounded-lg border border-border bg-white p-6 shadow-sm">
          <BetaAgreementText party={{ vendorName: null, accountEmail: null }} headingLevel={2} />
        </div>
      </article>
    </PublicPolicyShell>
  );
}
