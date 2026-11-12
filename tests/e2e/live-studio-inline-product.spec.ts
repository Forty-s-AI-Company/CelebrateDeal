import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatZonedDateTimeLocal } from "../../src/lib/zoned-date-time";
import {
  createLiveStudioFixtureWithoutListedProducts,
  deleteLiveStudioFixture,
  liveStudioStepButton,
  loginLiveStudioOwner,
  openLiveStudioAdvancedSettings,
  type LiveStudioFixture,
} from "../fixtures/live-studio";

// Synthetic loopback-only tenant without a listed product, plus a second
// synthetic merchant whose project the first one must not be able to use.
// No payment, email or external call is made; nothing is bought.
const db = new PrismaClient({ log: [] });
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(180_000);
test.afterAll(async () => db.$disconnect());

test("a merchant without a listed product creates one in the studio's drawer, it is ticked and published with the live without leaving /lives/new", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const nativeDialogs: string[] = [];
  page.on("dialog", (dialog) => {
    nativeDialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const documentNavigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) documentNavigations.push(new URL(frame.url()).pathname);
  });
  let fixture: LiveStudioFixture | undefined;
  let otherVendorId: string | undefined;
  try {
    fixture = await createLiveStudioFixtureWithoutListedProducts(db);
    const otherId = randomUUID();
    const otherVendor = await db.vendor.create({ data: { name: "合成他家商店", slug: `inline-product-other-${otherId}`, email: `${otherId}@example.test`, passwordHash: "synthetic-only" } });
    otherVendorId = otherVendor.id;
    const foreignProject = await db.salesProject.create({ data: { vendorId: otherVendor.id, name: "合成他家專案", slug: `other-${otherId}`, mode: "live_course", primaryFlow: "live", status: "draft" } });
    const slug = `inline-product-${fixture.id.slice(0, 8)}`;
    const productName = `直播限定原型食物餐盒 ${fixture.id.slice(0, 6)}`;

    await loginLiveStudioOwner(page, fixture);
    await page.goto("/lives/new");
    documentNavigations.length = 0;

    // 內容: a sales live, which needs at least one product to publish.
    await page.getByRole("button", { name: /商品銷售直播/u }).click();
    const title = page.getByLabel("直播標題");
    await title.fill("就地建立商品的週五直播");
    const titleNode = await title.elementHandle();
    await page.locator("select[name=videoId]").selectOption(fixture.video.id);
    await page.locator("select[name=formId]").selectOption(fixture.form.id);
    // A week from now in the studio's Taipei time, so the schedule never becomes a past time.
    await page.getByLabel(/^開播時間/u).fill(formatZonedDateTimeLocal(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), "Asia/Taipei"));
    await openLiveStudioAdvancedSettings(page, "content");
    await page.getByLabel("直播網址").fill(slug);
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    // 成交
    await expect(liveStudioStepButton(page, "sales")).toHaveAttribute("aria-current", "step");
    const salesPanel = page.locator('[data-step-key="sales"]');
    await expect(salesPanel.getByText(/目前沒有可綁定的啟用商品，可以在這裡直接建立/u)).toBeVisible();
    // The unlisted fixture product is not offered.
    await expect(salesPanel.getByRole("checkbox")).toHaveCount(0);
    await expect(salesPanel.getByRole("link", { name: /用完整編輯器建立/u })).toHaveAttribute("target", "_blank");

    const openProduct = salesPanel.getByRole("button", { name: "新增商品", exact: true });
    await openProduct.click();
    const drawer = page.getByRole("dialog", { name: "新增商品" });
    await expect(drawer).toBeVisible();
    const name = drawer.getByLabel("商品名稱");
    const price = drawer.getByLabel("售價（新台幣整數元）");
    const inventory = drawer.getByLabel("可售庫存");
    await expect(name).toBeFocused();
    await expect(drawer.getByRole("group", { name: "商品類型" })).toContainText("實體商品");
    const moreSettings = drawer.getByRole("link", { name: /更多設定/u });
    await expect(moreSettings).toHaveAttribute("target", "_blank");
    await expect(moreSettings).toHaveAttribute("href", "/products/new");

    // Missing fields keep the drawer open with each field's message.
    await drawer.getByRole("button", { name: "建立並選取" }).click();
    await expect(drawer.getByText("請填寫商品名稱。")).toBeVisible();
    await expect(drawer.getByText("請填寫售價。")).toBeVisible();
    await expect(drawer.getByText("請填寫可售庫存。")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();

    // A decimal price is refused before anything is sent.
    await name.fill(productName);
    await price.fill("1290.5");
    await inventory.fill("30");
    await drawer.getByRole("button", { name: "建立並選取" }).click();
    await expect(drawer.getByText("售價須為新台幣整數元，不含小數點、逗號或符號。")).toBeVisible();
    await expect(price).toBeFocused();

    // A tampered project id of another merchant is refused by the server and nothing is written.
    await price.fill("1290");
    await drawer.locator("form").evaluate((form, projectId) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "projectId";
      input.value = projectId;
      input.dataset.e2eForged = "true";
      form.append(input);
    }, foreignProject.id);
    await drawer.getByRole("button", { name: "建立並選取" }).click();
    await expect(drawer.getByRole("alert")).toContainText("找不到目前商家可用的專案，未儲存本次變更。");
    expect(await db.product.count({ where: { name: productName } })).toBe(0);
    expect(await db.salesProjectProduct.count({ where: { projectId: foreignProject.id } })).toBe(0);
    await drawer.locator('input[data-e2e-forged="true"]').evaluate((input) => input.remove());

    await drawer.getByRole("button", { name: "建立並選取" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByText(`已建立並選取商品「${productName}」，它是這場直播的置頂（主打）商品。`)).toBeVisible();
    const created = await db.product.findFirstOrThrow({ where: { vendorId: fixture.vendor.id, name: productName } });
    expect(created).toMatchObject({
      priceCents: 129_000,
      currency: "TWD",
      inventory: 30,
      isActive: true,
      fulfillmentType: "physical",
      fulfillmentTypeConfirmed: true,
      commerceDomain: "merchant",
      checkoutUrl: null,
      compareAtCents: null,
    });
    const productCheckbox = salesPanel.getByRole("checkbox", { name: new RegExp(productName, "u") });
    await expect(productCheckbox).toBeChecked();
    await expect(productCheckbox).toBeFocused();
    await expect(salesPanel.getByText("庫存 30")).toBeVisible();
    // The create revalidates the page; the studio keeps its DOM and edits.
    expect(await titleNode!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(title).toHaveValue("就地建立商品的週五直播");

    // A second product, created while one is ticked, is only listed first: the pinned product stays.
    const secondName = `直播加購小菜 ${fixture.id.slice(0, 6)}`;
    await openProduct.click();
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("不會自動勾選");
    await name.fill(secondName);
    await price.fill("390");
    await inventory.fill("12");
    await drawer.getByRole("button", { name: "建立並加入清單" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByText(new RegExp(`已建立商品「${secondName}」並加入清單最前面，沒有自動勾選，目前的置頂（主打）商品不變`, "u"))).toBeVisible();
    const secondCheckbox = salesPanel.getByRole("checkbox", { name: new RegExp(secondName, "u") });
    await expect(secondCheckbox).not.toBeChecked();
    await expect(secondCheckbox).toBeFocused();
    await expect(productCheckbox).toBeChecked();
    const second = await db.product.findFirstOrThrow({ where: { vendorId: fixture.vendor.id, name: secondName } });
    expect(second).toMatchObject({ priceCents: 39_000, inventory: 12, isActive: true });

    await page.getByRole("button", { name: "下一步", exact: true }).click();
    // 通知
    await expect(liveStudioStepButton(page, "notifications")).toHaveAttribute("aria-current", "step");
    await page.locator("select[name=messageTemplateId]").selectOption(fixture.template.id);
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    // 發布
    await expect(liveStudioStepButton(page, "publish")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("已完成 · 啟用且已確認履約類型的商品")).toBeVisible();
    await expect(page.getByText("發布條件已完成")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/lives/new");
    expect(documentNavigations.filter((pathname) => pathname !== "/lives/new")).toEqual([]);

    // The autosaved draft carries the new product, and scheduling binds it.
    await expect.poll(async () => {
      const draft = await db.liveStudioDraft.findFirst({ where: { vendorId: fixture!.vendor.id }, select: { payload: true } });
      return (draft?.payload as { productIds?: string[] } | undefined)?.productIds ?? null;
    }).toEqual([created.id]);
    await page.getByRole("button", { name: "建立並排程", exact: true }).click();
    await page.getByRole("alertdialog", { name: "確定要建立並排程這場直播嗎？" })
      .getByRole("button", { name: "確認建立並排程", exact: true }).click();
    await expect(page).toHaveURL(/\/lives\/[^/]+\/preview$/u, { timeout: 60_000 });
    const live = await db.live.findFirstOrThrow({
      where: { vendorId: fixture.vendor.id },
      select: { status: true, products: { select: { productId: true, vendorId: true, isPinned: true } } },
    });
    expect(live).toEqual({ status: "scheduled", products: [{ productId: created.id, vendorId: fixture.vendor.id, isPinned: true }] });
    expect(await db.product.count({ where: { vendorId: otherVendor.id } })).toBe(0);
    expect(nativeDialogs).toEqual([]);
  } finally {
    await deleteLiveStudioFixture(db, fixture);
    if (otherVendorId) await db.vendor.delete({ where: { id: otherVendorId } });
  }
});
