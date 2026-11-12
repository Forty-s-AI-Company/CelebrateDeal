import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createLandingPageFixture } from "../fixtures/landing-page";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createGoalFunnelStepPages } from "../../src/lib/funnel-goal-step-pages";
import { parseFunnelStepPages } from "../../src/lib/funnel-step-pages";
import type { FunnelNode } from "../../src/lib/funnel-page-document";

test.use({ trace: "off", screenshot: "off", video: "off" });

function leaf(id: string, type: FunnelNode["type"]): FunnelNode {
  return { schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}

/**
 * TEST ONLY synthetic journey on the local loopback database: autosave, the
 * in-editor publish check refusing a sold-out product, an in-place rebind,
 * publishing from the drawer and the server-priced public page.
 */
test("編輯器自動儲存、發布檢查失敗後就地改綁商品、在抽屜發布，公開頁顯示伺服器價格", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  const db = new PrismaClient();
  const fixture = await createLandingPageFixture(db, randomUUID());
  const foreign = await createLandingPageFixture(db, randomUUID());
  const product = async (vendorId: string, projectId: string | null, name: string, priceCents: number) => {
    const created = await db.product.create({ data: {
      vendorId, name, slug: `test-only-editor-publish-${randomUUID()}`, priceCents, inventory: 20,
      fulfillmentType: "physical", fulfillmentTypeConfirmed: true, isActive: true,
    } });
    if (projectId) await db.salesProjectProduct.create({ data: { vendorId, projectId, productId: created.id } });
    return created;
  };
  const main = await product(fixture.vendor.id, fixture.project.id, "TEST ONLY 主商品", 123_400);
  const replacement = await product(fixture.vendor.id, fixture.project.id, "TEST ONLY 替代商品", 56_700);
  const unlinked = await product(fixture.vendor.id, null, "TEST ONLY 未連結專案商品", 88_800);
  const foreignProduct = await product(foreign.vendor.id, foreign.project.id, "TEST ONLY 其他商家商品", 99_900);
  const slug = `test-only-editor-publish-${randomUUID().replaceAll("-", "").slice(-12)}`;
  const content = createGoalFunnelStepPages({ id: "flow_editor_publish", name: "TEST ONLY 編輯器發布", goal: "sell", domain: slug })!;
  content.pages.order_form!.root = [{ ...leaf("section_main", "section"), children: [{ ...leaf("row_main", "row"), children: [{ ...leaf("column_main", "columns_2"), children: [leaf("offer_main", "offer_price"), leaf("pay_main", "payment_button")] }] }] }];
  const row = await db.landingPage.create({ data: { vendorId: fixture.vendor.id, projectId: fixture.project.id, name: "TEST ONLY 編輯器發布", slug, draftContent: content as unknown as Prisma.InputJsonValue } });
  const boundProduct = async () => parseFunnelStepPages((await db.landingPage.findUniqueOrThrow({ where: { id: row.id }, select: { draftContent: true } })).draftContent)?.pages.order_form?.commerce?.productId ?? null;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  await page.context().route((url) => url.origin !== new URL(baseURL!).origin, (route) => route.abort());
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(fixture.owner.email);
    await page.getByLabel("密碼").fill(fixture.password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await page.goto(`/landing-pages/${row.id}/edit?step=order_form`);
    const toolbar = page.getByLabel("編輯器工具列", { exact: true });
    await expect(toolbar.getByRole("button", { name: "已儲存", exact: true })).toBeDisabled();
    await expect(toolbar.getByRole("button", { name: "發布狀態：草稿" })).toBeVisible();

    // 就地綁定：選取結帳元件，屬性面板只列出本商家、本專案可販售的商品。
    await page.locator('[data-funnel-node-id="offer_main"]').click();
    const picker = page.locator("[data-funnel-commerce-quick-bind]");
    await expect(picker).toHaveAttribute("data-funnel-commerce-quick-bind", "unbound");
    const select = picker.getByRole("combobox");
    await expect(select.locator("option")).toHaveText(["請選擇商品", /^TEST ONLY 主商品 — .*1,234/u, /^TEST ONLY 替代商品 — .*567/u]);
    await expect(select.locator(`option[value="${foreignProduct.id}"]`)).toHaveCount(0);
    await expect(select.locator(`option[value="${unlinked.id}"]`)).toHaveCount(0);
    await select.selectOption(main.id);
    await expect(picker).toHaveAttribute("data-funnel-commerce-quick-bind", "bound");

    // 自動儲存：不按「儲存」，停止編輯後自動寫入草稿。
    await expect(toolbar.getByRole("button", { name: "已儲存", exact: true })).toBeDisabled({ timeout: 15_000 });
    await expect.poll(boundProduct).toBe(main.id);

    // 商品在編輯期間售完：發布檢查與正式發布一樣拒絕，網站不變。
    await db.product.update({ where: { id: main.id }, data: { inventory: 0 } });
    await toolbar.getByRole("button", { name: "發布", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "發布網站" });
    await expect(drawer.getByText("發布檢查未通過，網站沒有變更。", { exact: true })).toBeVisible();
    await expect(drawer).toContainText("已綁定的商品必須屬於目前銷售專案");
    await expect(drawer.getByRole("button", { name: "確認發布", exact: true })).toBeDisabled();
    expect(await db.landingPageVersion.count({ where: { pageId: row.id } })).toBe(0);

    // 修正：抽屜帶回結帳元件的商品選擇，改選仍可販售的商品。
    await drawer.getByRole("button", { name: "重新選擇結帳商品", exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(picker).toHaveAttribute("data-funnel-commerce-quick-bind", "unavailable");
    await expect(select).toBeFocused();
    await select.selectOption(replacement.id);
    await expect.poll(boundProduct, { timeout: 15_000 }).toBe(replacement.id);
    await expect(toolbar.getByRole("button", { name: "已儲存", exact: true })).toBeDisabled();

    // 發布成功：檢查通過後在抽屜內確認，Toast 附公開網址。
    await toolbar.getByRole("button", { name: "發布", exact: true }).click();
    await expect(drawer.getByText("檢查通過，可以發布。", { exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "確認發布", exact: true }).click();
    await expect(drawer).toBeHidden();
    const toast = page.locator("[data-ui-toast]");
    await expect(toast).toContainText("已發布版本 v1");
    await expect(toast).toContainText(`/lp/${slug}`);
    await expect(toast.getByRole("link", { name: "開啟公開頁", exact: true })).toHaveAttribute("href", `/lp/${slug}`);
    await expect(toolbar.getByRole("button", { name: "更新發布", exact: true })).toBeVisible();
    const published = await db.landingPage.findUniqueOrThrow({ where: { id: row.id }, select: { status: true, publishedVersion: { select: { version: true, content: true } } } });
    expect(published.status).toBe("published");
    expect(published.publishedVersion?.version).toBe(1);
    expect(parseFunnelStepPages(published.publishedVersion?.content)?.pages.order_form?.commerce).toEqual({ schemaVersion: 1, productId: replacement.id, formMode: "single" });

    // 公開頁：價格只來自伺服器商品紀錄。
    await page.goto(`/lp/${slug}`);
    const price = page.locator('[data-funnel-node-type="offer_price"]:visible');
    await expect(price).toContainText("TEST ONLY 替代商品");
    await expect(price).toContainText("567");
    await expect(price).not.toContainText("1,234");
    await expect(page.getByRole("link", { name: "前往安全結帳", exact: true })).toHaveAttribute("href", `/lp/${slug}/order_form/checkout`);
    expect(pageErrors).toEqual([]);
  } finally {
    const vendorIds = [fixture.vendor.id, foreign.vendor.id];
    await db.funnelVisit.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await db.landingPage.updateMany({ where: { vendorId: { in: vendorIds } }, data: { status: "draft", publishedVersionId: null } });
    await db.landingPage.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await db.user.deleteMany({ where: { id: { in: [fixture.owner.id, foreign.owner.id] } } });
    await db.$disconnect();
  }
});
