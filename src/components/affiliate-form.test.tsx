import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));

import { AffiliateForm } from "@/components/affiliate-form";

describe("AffiliateForm MVP controls", () => {
  it("renders an existing rate as read-only while posting its unchanged value", () => {
    const html = renderToStaticMarkup(
      <AffiliateForm affiliate={{ id: "affiliate-1", commissionRateBps: 1_250 } as never} />,
    );

    expect(html).toContain('type="hidden" name="commissionRateBps" value="1250"');
    expect(html).toContain('type="number"');
    expect(html).toContain('name="commissionRateBps_display"');
    expect(html).toContain("readOnly");
    expect(html).toContain("首發期間固定");
  });
});
