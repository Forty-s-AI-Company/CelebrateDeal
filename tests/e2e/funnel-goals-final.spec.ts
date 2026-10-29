import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { createLandingPageFixture, type LandingPageFixture } from "../fixtures/landing-page";

/**
 * Browser contract for the systeme-style Funnel journey:
 * create -> goal-filtered template -> 頁面設定 -> 編輯頁面 -> return.
 */
const db = new PrismaClient();
const runKey = randomUUID();
let fixture: LandingPageFixture;

test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(120_000);
test.beforeAll(async () => {
  assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
  fixture = await createLandingPageFixture(db, runKey);
});
test.afterAll(async () => { await db.$disconnect(); });

type Goal = "audience" | "sell" | "custom" | "webinar";
const goals: Array<{ goal: Goal; label: string }> = [
  { goal: "audience", label: "建立名單" },
  { goal: "sell", label: "銷售商品或服務" },
  { goal: "custom", label: "自訂一頁式網站" },
  { goal: "webinar", label: "自動化線上講座" },
];
const operationsTabs = ["頁面設定", "自動化規則", "A/B 測試", "成效統計", "報名名單", "銷售紀錄", "截止設定"];

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.owner.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
}

async function createGoal(page: Page, goal: Goal) {
  const suffix = `${runKey.replaceAll("-", "").slice(-10)}-${goal}`;
  const slug = `test-only-final-${suffix}`;
  await page.goto("/landing-pages");
  await expect(page.getByRole("heading", { name: "一頁式網站", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "建立一頁式網站", exact: true }).first().click();
  await expect(page).toHaveURL(/\/landing-pages\/new$/u);
  await page.getByLabel("名稱 *").fill(`TEST ONLY Final ${goal} ${suffix}`);
  await page.getByLabel("一頁式網站網址 *").fill(slug);
  await page.getByRole("button", { name: new RegExp(`^${goals.find((item) => item.goal === goal)!.label}`, "u") }).click();
  await page.getByRole("button", { name: "建立", exact: true }).click();
  await expect(page).toHaveURL(/\/landing-pages\/[^/?]+\/operations$/u);
  const pageId = new URL(page.url()).pathname.split("/").at(-2)!;

  const management = page.getByRole("region", { name: "一頁式網站管理", exact: true });
  await expect(management).toBeVisible();
  for (const tab of operationsTabs) await expect(management.getByRole("button", { name: tab, exact: true })).toBeVisible();

  if (goal === "custom") {
    await expect(management.getByRole("heading", { name: "尚未建立網站步驟", exact: true })).toBeVisible();
    await management.getByRole("button", { name: "新增步驟", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新增步驟", exact: true });
    await dialog.getByLabel("名稱 *", { exact: true }).fill("TEST ONLY Custom Page");
    await dialog.getByLabel("網址路徑 *", { exact: true }).fill("custom-page");
    await dialog.getByLabel("從空白開始", { exact: true }).check();
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(management.getByRole("status")).toContainText("新步驟已建立");
    await expect(management.getByRole("button", { name: "編輯頁面", exact: true })).toBeEnabled();
  } else if (goal === "audience" || goal === "sell") {
    await expect(management.getByRole("heading", { name: /選擇模板/u })).toBeVisible();
    await management.getByRole("button", { name: "套用模板", exact: true }).first().click();
    await expect(management.getByRole("status")).toContainText("模板已套用");
    await expect(management.getByRole("button", { name: "編輯頁面", exact: true })).toBeEnabled();
  }

  await management.getByRole("button", { name: "編輯頁面", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/landing-pages/${pageId}/edit\\?step=`, "u"));
  await expect(page.getByLabel("編輯器工具列", { exact: true })).toBeVisible();
  return { slug, pageId };
}

for (const { goal } of goals) {
  test(`四 Goal：${goal} 依序經過管理、模板與單頁編輯器`, async ({ page }) => {
    await login(page);
    const { slug, pageId } = await createGoal(page, goal);
    const toolbar = page.getByLabel("編輯器工具列", { exact: true });

    // Nothing to save until the canvas changes (EDT-TB-001).
    await expect(toolbar.getByRole("button", { name: "已儲存", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "區段", exact: true }).click();
    await toolbar.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /草稿已儲存/u }).first()).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "已儲存", exact: true })).toBeDisabled();
    await expect.poll(async () => (await db.landingPage.findUnique({ where: { id: pageId }, select: { slug: true } }))?.slug).toBe(slug);

    await toolbar.getByRole("button", { name: "返回管理頁", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/landing-pages/${pageId}/operations\\?step=`, "u"));
    const management = page.getByRole("region", { name: "一頁式網站管理", exact: true });
    await expect(management.getByRole("button", { name: "頁面設定", exact: true })).toBeVisible();
    await management.getByRole("button", { name: "自動化規則", exact: true }).click();
    await expect(page.getByRole("region", { name: "報名後自動化", exact: true })).toBeVisible();

    await management.getByRole("button", { name: "頁面設定", exact: true }).click();
    // Publishing, duplicating and deleting live on the management page.
    const publish = management.getByRole("button", { name: "發布", exact: true });
    if (goal !== "webinar") {
      await expect(publish).toBeEnabled();
      await publish.click();
      await expect(management.getByRole("button", { name: /^發布狀態：(已發布|公開網址無法開啟)/u })).toBeVisible();
    } else {
      if (await publish.isEnabled()) await publish.click();
      await expect(management.getByRole("button", { name: "發布狀態：草稿", exact: true })).toBeVisible();
    }

    await management.getByRole("button", { name: "更多網站操作", exact: true }).click();
    await management.getByRole("button", { name: "刪除網站", exact: true }).click();
    // Removing a site asks inside the page (no native dialog).
    await page.getByRole("alertdialog", { name: /^確定要移除這個一頁式網站嗎？/u }).getByRole("button", { name: "移除", exact: true }).click();
    await expect(page).toHaveURL(/\/landing-pages$/u);
    if (goal !== "webinar") {
      // F-072 (owner decision D-19): a published Funnel is archived, never
      // deleted, so its visit and lead-source history survives; it is
      // unpublished and its public URL stops resolving.
      await expect.poll(async () => {
        const archived = await db.landingPage.findUnique({ where: { id: pageId }, select: { status: true, publishedVersionId: true, archivedAt: true } });
        return archived && { status: archived.status, publishedVersionId: archived.publishedVersionId, archived: archived.archivedAt instanceof Date };
      }).toEqual({ status: "draft", publishedVersionId: null, archived: true });
      expect((await page.request.get(`/lp/${slug}`)).status()).toBe(404);
    } else {
      // Never published and without traffic: permanently removed.
      await expect.poll(async () => db.landingPage.findUnique({ where: { id: pageId }, select: { id: true } })).toBeNull();
    }
  });
}
