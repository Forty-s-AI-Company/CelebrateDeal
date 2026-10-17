import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const paths = ["/policies", "/policies/terms", "/policies/privacy", "/policies/refunds", "/support"] as const;
for (const path of paths) {
  test(`public presentation ${path} is readable and truthful on desktop and mobile`, async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const main = page.getByRole("main");
    for (const text of ["DRAFT", "HUMAN OWNER", "P0", "P1", "P2", "acceptance receipt", "rollback", "owner", "webhook exhausted"]) {
      await expect(main).not.toContainText(text);
    }
    if (path === "/support") {
      await expect(main).toContainText("服務時段尚未公告");
      await expect(main.getByRole("link", { name: "客服信箱：a88221144@gmail.com" })).toHaveAttribute("href", "mailto:a88221144@gmail.com");
      await expect(main).toContainText("Carry Digital Nomad 凱瑞數位");
      for (const promise of ["15 分鐘", "1 小時", "1 個工作日"]) await expect(main).not.toContainText(promise);
      await expect(page.getByRole("link", { name: "查看我的訂單與履約進度", exact: false })).toHaveAttribute("href", "/support/orders");
    } else if (path === "/policies") {
      await expect(main).toContainText("預定政策版本 2026.10.16");
      await expect(main).toContainText("預定生效日為 2026 年 11 月 1 日");
    } else {
      await expect(page.locator('[data-policy-publication="scheduled"]')).toContainText("2026.10.16");
      await expect(page.locator('[data-policy-publication="scheduled"]')).toContainText("2026 年 11 月 1 日");
      await expect(page.locator("article time")).toHaveAttribute("datetime", "2026-11-01");
      await expect(main).toContainText("本版本尚未生效");
      if (path === "/policies/terms") await expect(main).toContainText("PayUni 為目前主要付款服務");
      if (path === "/policies/privacy") await expect(main).toContainText("SMS 尚未開放");
      if (path === "/policies/refunds") await expect(main).toContainText("自動電子發票功能尚未開放");
    }
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(result.violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => ({ id: v.id, impact: v.impact }))).toEqual([]);
      expect(await main.evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`public-${width}.png`), fullPage: true });
    }
  });
}
test("unknown inherited policy names return a real 404",async({page,baseURL})=>{
  const origin=new URL(baseURL!).origin;
  await page.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  for(const slug of ["constructor","toString","__proto__"])expect((await page.goto(`/policies/${slug}`))?.status()).toBe(404);
});
