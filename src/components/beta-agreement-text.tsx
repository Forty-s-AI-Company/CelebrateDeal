import { betaAgreement, type BetaAgreementParty } from "@/lib/beta-agreement-content";

/**
 * The 封測合作協議 body shared by the back-office gate and the public page
 * `/policies/beta-agreement`, so both always show the same version and text.
 * 乙方 comes from the server (the vendor name and account e-mail at the time
 * of acceptance); the public page has no particular merchant.
 */
export function BetaAgreementText({ party, headingLevel = 3 }: { party: BetaAgreementParty; headingLevel?: 2 | 3 }) {
  const SectionHeading = headingLevel === 2 ? "h2" : "h3";
  const partyLabel = party.vendorName
    ? `${party.vendorName}${party.accountEmail ? `（帳號 Email：${party.accountEmail}）` : ""}`
    : "同意本協議的商家（商家名稱與帳號 Email 於同意時由本平台帶入）";
  return (
    <div className="grid gap-6 text-sm leading-7 text-slate-700" data-beta-agreement-version={betaAgreement.version}>
      <section aria-label="立協議人">
        <SectionHeading className="text-base font-semibold text-slate-950">立協議人</SectionHeading>
        <dl className="mt-2 grid gap-2">
          <div>
            <dt className="inline font-semibold text-slate-900">甲方（平台營運者）：</dt>
            <dd className="inline">{betaAgreement.operator.name}（聯絡信箱：<span className="break-all">{betaAgreement.operator.email}</span>）</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-slate-900">乙方（封測商家）：</dt>
            <dd className="inline break-words" data-beta-agreement-party>{partyLabel}</dd>
          </div>
        </dl>
        <p className="mt-3">{betaAgreement.preamble}</p>
      </section>
      {betaAgreement.sections.map((section) => (
        <section key={section.number} aria-labelledby={`beta-agreement-section-${section.number}`}>
          <SectionHeading id={`beta-agreement-section-${section.number}`} className="text-base font-semibold text-slate-950">
            {section.number}. {section.heading}
          </SectionHeading>
          <ol className="mt-2 grid list-decimal gap-2 pl-6">
            {section.items.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </section>
      ))}
      <p className="text-xs text-slate-600">協議版本：{betaAgreement.version}</p>
    </div>
  );
}
