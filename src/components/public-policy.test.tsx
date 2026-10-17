import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicyDocument, PolicyScopeNotice, PublicPolicyShell, PublicResourceLinks } from "./public-policy";
import { publicPolicies } from "@/lib/public-policy-content";

const internalLabels = ["DRAFT", "HUMAN OWNER", "P0", "P1", "P2", "release sign-off"];

describe("public policy and operations entrypoints", () => {
  it("exposes every public resource, contact and active policy version", () => {
    const html = renderToStaticMarkup(<PublicPolicyShell><PublicResourceLinks /></PublicPolicyShell>);

    expect(html).toContain('aria-label="公開資訊"');
    for (const href of ["/policies/terms", "/policies/privacy", "/policies/refunds", "/support", "/merchant-onboarding"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("Carry Digital Nomad 凱瑞數位");
    expect(html).toContain('href="mailto:a88221144@gmail.com"');
    expect(html).toContain("各政策頁會顯示其版本與生效狀態");
    expect(html).not.toContain("support@celebratedeal.com");
  });

  it.each(Object.values(publicPolicies))("publishes $title with version, effective date and complete sections", (policy) => {
    const html = renderToStaticMarkup(<PolicyDocument policy={policy} />);

    expect(html).toContain(policy.title);
    expect(html).toContain(policy.summary);
    expect(html).toContain(`data-policy-publication="${policy.publication.status}"`);
    expect(html).toContain(policy.publication.version);
    expect(html).toContain(`<time dateTime="${policy.publication.effectiveDate}">`);
    expect(html).toContain("本版本尚未生效");
    expect(html).toContain("生效日前的帳號使用與資料處理");
    expect(html).toContain("已成立交易依交易當時顯示的條件與訂單紀錄處理");
    for (const section of policy.sections) {
      expect(html).toContain(section.heading);
      expect(section.paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) expect(html).toContain(renderToStaticMarkup(<p>{paragraph}</p>));
    }
    expect(html).toContain('href="/support/orders"');
    expect(html).toContain('href="/support/requests"');
    for (const internal of internalLabels) expect(html).not.toContain(internal);
  });

  it("states the approved product boundaries without inventing unavailable channels", () => {
    const terms = renderToStaticMarkup(<PolicyDocument policy={publicPolicies.terms} />);
    const privacy = renderToStaticMarkup(<PolicyDocument policy={publicPolicies.privacy} />);
    const refunds = renderToStaticMarkup(<PolicyDocument policy={publicPolicies.refunds} />);

    expect(terms).toContain("PayUni 為目前主要付款服務");
    expect(terms).toContain("Email 與 LINE 依使用者選擇");
    expect(terms).toContain("台灣時間（UTC+8）");
    expect(terms).toContain("下次扣款日前第 3 日 23:59 前");
    expect(terms).toContain("收到 Email 即為及時");
    expect(terms).toContain("2 個工作日內以 Email 確認");
    expect(terms).toContain("以較早者為準）起 15 日內全額退回原付款方式");
    expect(terms).toContain("逾時申請自再下一期起停止");
    expect(privacy).toContain("SMS 尚未開放");
    expect(refunds).toContain("自動電子發票功能尚未開放");
    expect(refunds).toContain("不會免除實際開立義務人依法應開立");
    expect(refunds).toContain("不會自動產生國外商用 Invoice");
  });

  it("does not expose internal capability governance passed by legacy callers", () => {
    const html = renderToStaticMarkup(<PolicyScopeNotice />);

    expect(html).toContain("目前功能範圍");
    expect(html).not.toContain("DRAFT");
    expect(html).not.toContain("HUMAN OWNER");
    expect(html).not.toContain("release owner");
  });

  it("uses the publication status to distinguish scheduled and effective policy dates", () => {
    const scheduled = renderToStaticMarkup(<PolicyDocument policy={publicPolicies.terms} />);
    const published = renderToStaticMarkup(<PolicyDocument policy={{
      ...publicPolicies.terms,
      publication: { version: "2026.12.01", effectiveDate: "2026-12-01", effectiveDateLabel: "2026 年 12 月 1 日", status: "published" },
    }} />);

    expect(scheduled).toContain("預定生效日期");
    expect(scheduled).toContain("本版本尚未生效");
    expect(published).toContain("生效日期");
    expect(published).not.toContain("預定生效日期");
    expect(published).not.toContain("本版本尚未生效");
  });
});
