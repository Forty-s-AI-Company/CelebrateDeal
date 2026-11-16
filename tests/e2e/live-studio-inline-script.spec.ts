import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { formatZonedDateTimeLocal } from "../../src/lib/zoned-date-time";
import {
  createLiveStudioFixture,
  deleteLiveStudioFixture,
  liveStudioStepButton,
  loginLiveStudioOwner,
  openLiveStudioAdvancedSettings,
  type LiveStudioFixture,
} from "../fixtures/live-studio";

// Synthetic loopback-only tenant without any interaction script, plus a second
// synthetic merchant that owns a published script the first one must never see.
// The script editor is too large for a drawer, so the studio opens it in a new
// tab; the script "created there" is written straight to the disposable
// database. No payment, email or external call is made; nothing is bought.
const db = new PrismaClient({ log: [] });
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(180_000);
test.afterAll(async () => db.$disconnect());

/** What the browser does when the merchant comes back to the studio's tab. */
async function returnToStudioTab(page: import("@playwright/test").Page, kind: "visibility" | "focus") {
  await page.evaluate((eventKind) => {
    if (eventKind === "visibility") document.dispatchEvent(new Event("visibilitychange"));
    else window.dispatchEvent(new Event("focus"));
  }, kind);
}

test("a merchant creates an interaction script in a new tab and the studio's select picks it up on return without losing the draft", async ({ page, context }) => {
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
    fixture = await createLiveStudioFixture(db);
    // The fixture's published script is removed: this merchant starts without any.
    await db.interactionScript.delete({ where: { id: fixture.script.id } });
    const otherId = randomUUID();
    const otherVendor = await db.vendor.create({ data: { name: "合成他家商店", slug: `inline-script-other-${otherId}`, email: `${otherId}@example.test`, passwordHash: "synthetic-only" } });
    otherVendorId = otherVendor.id;
    const foreignName = `他家腳本 ${otherId.slice(0, 6)}`;
    await db.interactionScript.create({ data: { vendorId: otherVendor.id, name: foreignName, status: "published" } });
    const slug = `inline-script-${fixture.id.slice(0, 8)}`;

    await loginLiveStudioOwner(page, fixture);
    await page.goto("/lives/new");
    documentNavigations.length = 0;

    // 內容
    await page.getByRole("button", { name: /商品銷售直播/u }).click();
    const title = page.getByLabel("直播標題");
    await title.fill("新分頁建立腳本的週五直播");
    const titleNode = await title.elementHandle();
    await page.locator("select[name=videoId]").selectOption(fixture.video.id);
    await page.locator("select[name=formId]").selectOption(fixture.form.id);
    await page.getByLabel(/^開播時間/u).fill(formatZonedDateTimeLocal(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), "Asia/Taipei"));
    await openLiveStudioAdvancedSettings(page, "content");
    await page.getByLabel("直播網址").fill(slug);
    await page.getByRole("button", { name: "下一步", exact: true }).click();

    // 成交: no script yet.
    await expect(liveStudioStepButton(page, "sales")).toHaveAttribute("aria-current", "step");
    const salesPanel = page.locator('[data-step-key="sales"]');
    await salesPanel.getByRole("checkbox", { name: /合成原型食物餐盒/u }).check();
    const accent = salesPanel.getByLabel("促銷短句");
    await accent.fill("尚未存檔的促銷短句");
    const scriptSelect = salesPanel.locator("select[name=interactionScriptId]");
    await expect(scriptSelect.locator("option")).toHaveCount(1);
    await expect(salesPanel.getByText("目前沒有已發布的互動腳本。")).toBeVisible();
    await expect(salesPanel.getByText(/在新分頁建立並發布後回到這裡，清單會自動更新/u)).toBeVisible();

    // 建立互動腳本 opens the existing create page in a new tab and leaves the studio alone.
    const createLink = salesPanel.getByRole("link", { name: /建立互動腳本/u });
    await expect(createLink).toHaveAttribute("href", "/interaction-scripts/new");
    await expect(createLink).toHaveAttribute("target", "_blank");
    await expect(createLink).toHaveAttribute("rel", "noopener");
    const [popup] = await Promise.all([context.waitForEvent("page"), createLink.click()]);
    await popup.waitForLoadState("domcontentloaded");
    expect(new URL(popup.url()).pathname).toBe("/interaction-scripts/new");
    await expect(popup.getByRole("heading", { name: "新增互動腳本" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/lives/new");

    // The script is "created and published in the other tab".
    const created = await db.interactionScript.create({ data: { vendorId: fixture.vendor.id, name: `新分頁腳本 ${fixture.id.slice(0, 6)}`, status: "published" } });
    await db.interactionScript.create({ data: { vendorId: fixture.vendor.id, name: "只是草稿的腳本", status: "draft" } });
    await popup.close();

    // Back in the studio's tab: the only new script appears and, with none selected, is selected.
    await returnToStudioTab(page, "focus");
    await expect(scriptSelect).toHaveValue(created.id);
    await expect(scriptSelect.locator("option")).toHaveCount(2);
    await expect(scriptSelect.locator("option", { hasText: foreignName })).toHaveCount(0);
    await expect(scriptSelect.locator("option", { hasText: "只是草稿的腳本" })).toHaveCount(0);
    await expect(page.locator("[data-live-script-status]")).toContainText(`已更新清單，並自動選取新的互動腳本「${created.name}」。`);
    // Nothing else moved: same DOM, same unsaved edits, same step.
    expect(await titleNode!.evaluate((node) => node.isConnected)).toBe(true);
    await expect(title).toHaveValue("新分頁建立腳本的週五直播");
    await expect(accent).toHaveValue("尚未存檔的促銷短句");
    await expect(salesPanel.getByRole("checkbox", { name: /合成原型食物餐盒/u })).toBeChecked();
    await expect(liveStudioStepButton(page, "sales")).toHaveAttribute("aria-current", "step");
    await expect(salesPanel.getByText("已選腳本：")).toContainText(created.name);
    // The autosaved draft carries the auto-selected script.
    await expect.poll(async () => {
      const draft = await db.liveStudioDraft.findFirst({ where: { vendorId: fixture!.vendor.id }, select: { payload: true } });
      return (draft?.payload as { interactionScriptId?: string } | undefined)?.interactionScriptId ?? null;
    }).toBe(created.id);

    // A second script created later is only listed: the merchant's choice stays. The tab-visible
    // event is repeated until the five-second refresh throttle has passed.
    const second = await db.interactionScript.create({ data: { vendorId: fixture.vendor.id, name: `第二份腳本 ${fixture.id.slice(0, 6)}`, status: "published" } });
    await expect(async () => {
      await returnToStudioTab(page, "visibility");
      await expect(scriptSelect.locator(`option[value="${second.id}"]`)).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(scriptSelect).toHaveValue(created.id);
    await expect(scriptSelect.locator("option")).toHaveCount(3);
    await expect(page.locator("[data-live-script-status]")).toContainText("已更新清單");
    await expect(page.locator("[data-live-script-status]")).toContainText("目前選擇不變");

    // The manual button is the keyboard fallback.
    const refresh = salesPanel.getByRole("button", { name: "重新整理清單", exact: true });
    await refresh.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-live-script-status]")).toContainText("已更新清單，沒有新的互動腳本。");
    await expect(scriptSelect.locator("option")).toHaveCount(3);

    // The draft publishes with the script that was picked up.
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(liveStudioStepButton(page, "notifications")).toHaveAttribute("aria-current", "step");
    await page.locator("select[name=messageTemplateId]").selectOption(fixture.template.id);
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(liveStudioStepButton(page, "publish")).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("發布條件已完成")).toBeVisible();
    expect(documentNavigations.filter((pathname) => pathname !== "/lives/new")).toEqual([]);
    await page.getByRole("button", { name: "建立並排程", exact: true }).click();
    await page.getByRole("alertdialog", { name: "確定要建立並排程這場直播嗎？" })
      .getByRole("button", { name: "確認建立並排程", exact: true }).click();
    await expect(page).toHaveURL(/\/lives\/[^/]+\/preview$/u, { timeout: 60_000 });
    const live = await db.live.findFirstOrThrow({ where: { vendorId: fixture.vendor.id }, select: { status: true, interactionScriptId: true } });
    expect(live).toEqual({ status: "scheduled", interactionScriptId: created.id });
    expect(nativeDialogs).toEqual([]);
  } finally {
    await deleteLiveStudioFixture(db, fixture);
    if (otherVendorId) await db.vendor.delete({ where: { id: otherVendorId } });
  }
});
