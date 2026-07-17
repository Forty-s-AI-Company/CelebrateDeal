import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamTemplateForm } from "./team-template-form";

const action = async () => ({ status: "idle" as const, message: "" });

describe("TeamTemplateForm", () => {
  it("renders the selected locked fields and product-slot controls", () => {
    const html = renderToStaticMarkup(
      <TeamTemplateForm
        template={{ id: "template-1", teamId: "team-1", name: "A 的模板", slug: "leader-page", headline: "活動標題", ctaLabel: "立即報名", lockedFields: ["HEADLINE", "PRODUCT_SLOTS"] }}
        teams={[{ id: "team-1", name: "北區團隊" }]}
        products={[{ id: "product-1", name: "主打課程" }]}
        webinars={[{ id: "live-1", title: "七月 webinar", scheduledAt: "2026/07/17" }]}
        csrfToken="csrf-test-token"
        action={action}
      />,
    );

    expect(html).toContain('name="lockedFields"');
    expect(html).toMatch(/name="lockedFields" checked="" value="HEADLINE"/);
    expect(html).toMatch(/name="lockedFields" checked="" value="PRODUCT_SLOTS"/);
    expect(html).toContain("鎖定區塊");
    expect(html).toContain("商品槽選擇");
    expect(html).toContain('name="webinarId"');
  });

  it("shows the allowed dynamic fields without adding a second page builder", () => {
    const html = renderToStaticMarkup(
      <TeamTemplateForm teams={[{ id: "team-1", name: "北區團隊" }]} products={[]} webinars={[]} csrfToken="csrf-test-token" action={action} />,
    );

    expect(html).toContain("{{partner.displayName}}");
    expect(html).toContain("{{webinar.title}}");
    expect(html).toContain("建立原始頁");
  });
});
