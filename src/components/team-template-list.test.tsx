import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamTemplateList } from "./team-template-list";

const action = async () => ({ status: "idle" as const, message: "" });

describe("TeamTemplateList", () => {
  it("guides a leader when no template exists", () => {
    const html = renderToStaticMarkup(<TeamTemplateList templates={[]} csrfToken="csrf-test-token" action={action} />);

    expect(html).toContain("還沒有團隊模板");
    expect(html).toContain("建立第一個模板");
  });

  it("shows share status, copied partners, and a destructive confirmation path", () => {
    const html = renderToStaticMarkup(
      <TeamTemplateList
        csrfToken="csrf-test-token"
        action={action}
        templates={[{
          id: "template-1", name: "A 的 webinar 模板", teamId: "team-1", teamName: "北區團隊", status: "ACTIVE", latestVersion: 3, copiedPartnerCount: 8,
          sourcePage: { id: "page-1", slug: "leader-webinar", shareEnabled: true },
        }]}
      />,
    );

    expect(html).toContain("已複製給 8 位夥伴");
    expect(html).toContain("分享啟用中");
    expect(html).toContain("停用分享");
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
  });
});
