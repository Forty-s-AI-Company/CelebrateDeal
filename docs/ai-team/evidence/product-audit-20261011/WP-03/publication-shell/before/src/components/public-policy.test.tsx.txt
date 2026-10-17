import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicyDocument, PublicPolicyShell, PublicResourceLinks } from "./public-policy";
import { policyDrafts } from "@/lib/public-policy-content";

describe("public policy and operations entrypoints", () => {
  it("exposes every public resource through accessible links", () => {
    const html = renderToStaticMarkup(<PublicPolicyShell><PublicResourceLinks /></PublicPolicyShell>);

    expect(html).toContain('aria-label="公開資訊"');
    expect(html).toContain('href="/policies/terms"');
    expect(html).toContain('href="/policies/privacy"');
    expect(html).toContain('href="/policies/refunds"');
    expect(html).toContain('href="/support"');
    expect(html).toContain('href="/merchant-onboarding"');
    expect(html).toContain('class="mt-4 text-center text-xs leading-5 text-slate-700"');
    expect(html).not.toContain('class="mt-4 text-center text-xs leading-5 text-slate-500"');
    expect(html).toContain("正式條款、隱私、退款、客服與商家 onboarding 仍需真人 owner 核准");
  });

  it.each(Object.values(policyDrafts))("renders the %s draft with an explicit human review boundary", (draft) => {
    const html = renderToStaticMarkup(<PolicyDocument draft={draft} />);

    expect(html).toContain(draft.title);
    expect(html).toContain(draft.status);
    expect(html).toContain(draft.owner);
    for (const section of draft.sections) {
      expect(html).toContain(section.heading);
    }
    expect(html).toContain("不構成法律意見、正式政策或 release sign-off");
  });
});
