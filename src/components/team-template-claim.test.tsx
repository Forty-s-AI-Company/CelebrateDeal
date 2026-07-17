import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamTemplateClaim, TeamTemplateClaimError } from "./team-template-claim";

const action = async () => ({ status: "idle" as const, message: "" });

describe("TeamTemplateClaim", () => {
  it("shows source metadata, locked scope, all three modes, and an explicit confirmation", () => {
    const html = renderToStaticMarkup(<TeamTemplateClaim csrfToken="csrf-test-token" action={action} template={{ teamId: "team-1", shareCode: "tf1.claim.test", sourceOwnerName: "A 領隊", templateName: "A 的研討會模板", version: 4, webinar: "七月 webinar", lockedFields: ["HEADLINE", "PRODUCT_SLOTS"] }} />);
    expect(html).toContain("來源 A");
    expect(html).toContain("A 領隊");
    expect(html).toContain("A 的研討會模板");
    expect(html).toContain("v4");
    expect(html).toContain("七月 webinar");
    expect(html).toContain("快速套用");
    expect(html).toContain("複製後編輯");
    expect(html).toContain("空白頁綁定研討會");
    expect(html).toContain("確認並建立夥伴頁");
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
  });

  it("uses one non-disclosing security state for expired, disabled, and foreign-team shares", () => {
    expect(renderToStaticMarkup(<TeamTemplateClaimError state="expired" />)).toContain("已過期");
    expect(renderToStaticMarkup(<TeamTemplateClaimError state="disabled" />)).toContain("已停用");
    expect(renderToStaticMarkup(<TeamTemplateClaimError state="not_team" />)).toContain("不屬於你的團隊");
  });
});
