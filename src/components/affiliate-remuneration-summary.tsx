import { formatAffiliateRemuneration } from "@/lib/affiliate-remuneration-format";
type Quote = { grossAmountCents: number; withholdingTaxCents: number; nhiSupplementaryTaxCents: number; bankFeeCents: number; netPayoutAmountCents: number; ruleVersion: string };
export function AffiliateRemunerationSummary({ quote }: { quote: Quote }) {
  return <dl className="my-4 grid grid-cols-2 gap-2" aria-label="提領報價明細">{[
    ["佣金毛額", quote.grossAmountCents], ["所得稅扣繳", quote.withholdingTaxCents], ["健保補充保費", quote.nhiSupplementaryTaxCents], ["轉帳費用", quote.bankFeeCents], ["實領金額", quote.netPayoutAmountCents],
  ].map(([label, amount]) => <div key={String(label)} className="contents"><dt>{label}</dt><dd>{formatAffiliateRemuneration(Number(amount))}</dd></div>)}<dt>計算版本</dt><dd>{quote.ruleVersion}</dd></dl>;
}
