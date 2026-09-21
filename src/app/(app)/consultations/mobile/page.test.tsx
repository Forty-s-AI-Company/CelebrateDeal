import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("mobile consultation page contract", () => {
  it("offers touch-sized call, meeting, note, tag and won actions", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    for (const copy of ["今日諮詢", "立即撥打", "開啟視訊", "快速備註", "預算足夠", "需再跟進", "標記成交"]) expect(source).toContain(copy);
    expect(source).toContain("CsrfField");
    expect(source).toContain("min-h-12");
    expect(source).toContain("listTodayConsultations");
  });

  it("loads the selected scope and makes aggregate overview visibly read-only", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain("requireVendorManagerContext()");
    expect(source).toContain("getSalesProjectScope(auth.user.id, vendor.id)");
    expect(source).toContain("scope.projectId");
    expect(source).toContain("全部專案總覽為唯讀模式");
    expect(source).toContain("!scope.isAggregate ? <form action={saveMobileConsultationAction}");
  });
});
