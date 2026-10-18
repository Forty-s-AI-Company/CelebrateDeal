import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PolicyDocument, PolicyScopeNotice, PublicPolicyShell, PublicResourceLinks } from "./public-policy";
import { publicPolicies, resolvePolicyStatus, resolvePublicPolicy } from "@/lib/public-policy-content";

const scheduledNow = new Date("2026-10-18T12:00:00+08:00");
const resolved = (slug: keyof typeof publicPolicies, now = scheduledNow) => resolvePublicPolicy(publicPolicies[slug], now);

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

  it.each(Object.values(publicPolicies).map((policy) => resolvePublicPolicy(policy, scheduledNow)))("publishes $title with version, effective date and complete sections", (policy) => {
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
    const terms = renderToStaticMarkup(<PolicyDocument policy={resolved("terms")} />);
    const privacy = renderToStaticMarkup(<PolicyDocument policy={resolved("privacy")} />);
    const refunds = renderToStaticMarkup(<PolicyDocument policy={resolved("refunds")} />);

    expect(terms).toContain("PayUni 為目前主要付款服務");
    expect(terms).toContain("可能包含 Email、LINE，以及商家啟用時的 SMS、WhatsApp 或裝置推播");
    expect(terms).toContain("畫面上未顯示為可選擇的通道即不提供");
    expect(terms).not.toContain("SMS 尚未開放");
    expect(terms).toContain("目前平台方案不會自動扣款");
    expect(terms).toContain("每月帳單會依所選方案產生");
    expect(terms).toContain("請寄信至客服信箱提出");
    expect(terms).not.toContain("2 個工作日內以 Email 確認");
    expect(terms).toContain("客服不另承諾固定回覆時間");
    expect(terms).toContain("預先錄製、依排程播出");
    expect(terms).toContain("標示為官方的互動，也可能是商家預先設定的腳本");
    expect(privacy).not.toContain("SMS 尚未開放");
    expect(privacy).toContain("蒐集者與聯絡方式");
    expect(privacy).not.toContain("告知者與聯絡方式");
    expect(privacy).toContain("電話號碼");
    expect(privacy).toContain("預約資料");
    expect(privacy).toContain("載具、統一編號、抬頭");
    expect(privacy).toContain("PayUni 回傳的付款方式參照碼，不保存完整卡號");
    expect(privacy).toContain("撥款銀行帳戶，以及報酬所需的稅務與扣繳資料");
    expect(privacy).toContain("IP 位址與裝置資訊");
    expect(privacy).toContain("推薦來源歸因");
    expect(privacy).toContain("SMS、WhatsApp、產品分析（PostHog）、錯誤監控（Sentry）");
    expect(privacy).toContain("Meta Conversions API");
    expect(privacy).toContain("雜湊後的 Email、事件識別碼、瀏覽器資訊、來源頁面與訂單金額");
    expect(privacy).toContain("美國、日本或其他服務商營運地區");
    expect(privacy).toContain("目前沒有依時間自動刪除的機制");
    expect(privacy).toContain("第一方 Cookie 用於維持登入、結帳與觀看狀態");
    expect(privacy).toContain("推薦 Cookie 會記錄訪客來自哪個推薦連結");
    expect(privacy).toContain("Email 中的退訂連結會停止該商家的報名確認、直播提醒與後續銷售 Email");
    expect(privacy).toContain("登入連結、驗證碼等安全必要的 Email 不受影響");
    expect(privacy).toContain("退訂也不影響已購買商品的權益");
    expect(refunds).toContain("已受理、審核中、已拒絕（會說明理由）、已向金流送出、已退款與退款失敗");
    expect(refunds).toContain("自動電子發票功能尚未開放");
    expect(refunds).toContain("該筆交易的開立主體會依法開立並提供發票");
    expect(refunds).toContain("平台會把結帳時填寫的發票資料交給該開立主體");
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
    const scheduled = renderToStaticMarkup(<PolicyDocument policy={resolved("terms")} />);
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

  it("derives the status from the Asia/Taipei calendar date", () => {
    expect(resolvePolicyStatus("2026-11-01", new Date("2026-10-31T15:59:59Z"))).toBe("scheduled");
    expect(resolvePolicyStatus("2026-11-01", new Date("2026-10-31T16:00:00Z"))).toBe("published");
    expect(resolvePolicyStatus("2026-11-01", new Date("2027-01-01T00:00:00Z"))).toBe("published");
    expect(resolved("privacy", new Date("2026-11-01T09:00:00+08:00")).publication.status).toBe("published");
    expect(resolved("privacy").publication.status).toBe("scheduled");
  });
});
