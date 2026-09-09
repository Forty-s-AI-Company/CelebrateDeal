import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/affiliate-portal-actions", () => ({ requestAffiliatePayoutAction: vi.fn() }));
// Client 元件若重新引入服務端 CSRF 模組，測試應在載入階段失敗。
vi.mock("@/components/csrf-field", () => { throw new Error("Client dialog must receive its CSRF field from the server"); });
vi.mock("@/lib/csrf", () => { throw new Error("Client dialog must not import server CSRF signing"); });

import { AffiliateRemunerationDialog } from "./affiliate-remuneration-dialog";

describe("affiliate remuneration dialog", () => {
  it("renders the server-provided CSRF field inside the signed payout form", () => {
    const html = renderToStaticMarkup(<AffiliateRemunerationDialog
      payoutId="payout-a"
      monthKey="2026-09"
      bankLabel="812 / ****7890 / 王＊＊"
      taxIdentityLabel="A1*****789"
      amounts={{ grossAmountCents: 100_000, withholdingTaxCents: 10_000, nhiSupplementaryTaxCents: 0, bankFeeCents: 1_000, netPayoutAmountCents: 89_000 }}
      csrfField={<input type="hidden" name="_csrf" value="synthetic-csrf" />}
    />);
    const payoutForm = html.match(/<form(?:(?!<\/form>)[\s\S])*name="payoutId"(?:(?!<\/form>)[\s\S])*<\/form>/u)?.[0];
    expect(payoutForm).toContain('name="_csrf" value="synthetic-csrf"');
    expect(payoutForm).toContain('name="payoutId" value="payout-a"');
    const consent = payoutForm?.match(/<input[^>]*name="remunerationConsent"[^>]*>/u)?.[0];
    expect(consent).toContain('required=""');
    expect(consent).toContain('value="accepted"');
  });
});
