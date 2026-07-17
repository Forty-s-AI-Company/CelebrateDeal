import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PartnerPageEditor } from "./partner-page-editor";

const action = async () => ({ status: "idle" as const, message: "" });

describe("PartnerPageEditor", () => {
  it("renders four slots, A-owned locked content, missing partner fields, preview, and public URL copy", () => {
    const html = renderToStaticMarkup(<PartnerPageEditor csrfToken="csrf-test-token" saveAction={action} publishAction={action} products={[{ id: "product-1", name: "主打課程" }]} page={{
      id: "page-1", teamId: "team-1", slug: "partner-webinar", headline: "A 的主標題", subheadline: null, body: null, ctaLabel: "立即報名", ctaUrl: null,
      source: { name: "夏季模板", ownerName: "A 領隊", version: 2, webinar: "八月 webinar" }, lockedFields: ["HEADLINE", "PRODUCT_SLOTS"], partner: { name: "", email: "" }, isPublished: false,
      slots: ["main_product", "bundle_product", "join_member", "consultation"].map((key) => ({ key, productId: null, overrideUrl: null, available: true })),
    }} />);
    expect(html).toContain("由 A 領隊 的模板版本鎖定");
    expect(html).toContain('disabled=""');
    expect(html).toContain('name="headline"');
    expect(html).toContain("請補齊必要夥伴欄位");
    expect(html).toContain("主打商品");
    expect(html).toContain("組合商品");
    expect(html).toContain("加入會員");
    expect(html).toContain("諮詢預約");
    expect(html).toContain("預覽");
    expect(html).toContain("複製公開 URL");
    expect(html).toContain("發布公開頁");
  });
});
