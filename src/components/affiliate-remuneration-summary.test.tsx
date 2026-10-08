import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AffiliateRemunerationSummary } from "./affiliate-remuneration-summary";
import { formatAffiliateRemuneration } from "@/lib/affiliate-remuneration-format";

describe("exact remuneration amounts", () => {
  it("keeps fractional fees and net amounts visible in the signing summary", () => {
    const html = renderToStaticMarkup(<AffiliateRemunerationSummary quote={{ grossAmountCents: 3_000_000, withholdingTaxCents: 300_000, nhiSupplementaryTaxCents: 63_300, bankFeeCents: 1501, netPayoutAmountCents: 2_635_199, ruleVersion: "synthetic" }} />);
    expect(html).toContain("15.01");
    expect(html).toContain("26,351.99");
    expect(html).not.toContain("26,352.00");
  });
  it("rejects amounts that are not integer cents", () => {
    expect(() => formatAffiliateRemuneration(1.1)).toThrow(RangeError);
    expect(() => formatAffiliateRemuneration(Number.NaN)).toThrow(RangeError);
    expect(formatAffiliateRemuneration(1)).toContain("0.01");
  });
});
