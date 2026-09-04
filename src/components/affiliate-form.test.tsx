import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));

import { AffiliateForm } from "@/components/affiliate-form";

describe("AffiliateForm commission controls", () => {
  it("renders an existing rate as an editable validated field", () => {
    const html = renderToStaticMarkup(
      <AffiliateForm affiliate={{ id: "affiliate-1", commissionRateBps: 1_250 } as never} />,
    );

    expect(html).toContain('type="number" required="" min="0" max="10000" step="1" name="commissionRateBps" value="1250"');
    expect(html).not.toContain("readOnly");
    expect(html).not.toContain("首發期間固定");
  });
});
